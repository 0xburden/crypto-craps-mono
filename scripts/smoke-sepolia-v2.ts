import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import { parseCliArgs, readJson, writeJson } from "./deployment-helpers";

interface CrapsGameV2DeploymentArtifact {
  contractName: "CrapsGameV2";
  contractAddress: string;
  network: string;
  tokenAddress: string;
}

const PASS_LINE = 0;
const PLACE_BET = 0;
const SESSION_PHASE_INACTIVE = 0;
const SESSION_PHASE_ROLL_PENDING = 3;

const DEFAULT_DEPOSIT_AMOUNT = 100_000_000n;
const DEFAULT_PASS_LINE_BET = 10_000_000n;
const DEFAULT_WITHDRAW_AMOUNT = 1_000_000n;
const DEFAULT_TIMEOUT_MS = 6 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;

function bigintArg(value: string | undefined, fallback: bigint): bigint {
  if (value === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected an integer argument, received: ${value}`);
  }

  return BigInt(value);
}

function numberArg(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive numeric argument, received: ${value}`);
  }

  return parsed;
}

function formatUsd6(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  pollIntervalMs: number,
  label: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await load();

  while (!predicate(value)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }

    await sleep(pollIntervalMs);
    value = await load();
  }

  return value;
}

function defaultDeploymentPath(): string {
  return path.join("deployments", "sepolia-deployment-v2.json");
}

function resolveReportPath(explicitPath: string | undefined): string | undefined {
  if (explicitPath !== undefined) {
    return explicitPath;
  }

  if (network.name === "baseSepolia") {
    return path.join("deployments", "sepolia-findings-v2.md");
  }

  return undefined;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const deploymentPath = args.deployment ?? process.env.CRAPS_SMOKE_DEPLOYMENT_V2 ?? defaultDeploymentPath();
  const reportPath = resolveReportPath(args.report ?? process.env.CRAPS_SMOKE_REPORT_V2);
  const depositAmount = bigintArg(args.deposit ?? process.env.SEPOLIA_SMOKE_DEPOSIT_AMOUNT, DEFAULT_DEPOSIT_AMOUNT);
  const passLineBet = bigintArg(args.bet ?? process.env.SEPOLIA_SMOKE_PASS_LINE_BET, DEFAULT_PASS_LINE_BET);
  const withdrawAmount = bigintArg(args.withdraw ?? process.env.SEPOLIA_SMOKE_WITHDRAW_AMOUNT, DEFAULT_WITHDRAW_AMOUNT);
  const timeoutMs = numberArg(args.timeoutMs, DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = numberArg(args.pollMs, DEFAULT_POLL_INTERVAL_MS);

  if (passLineBet > depositAmount) {
    throw new Error("Pass Line bet cannot exceed the deposit amount");
  }

  const deployment = readJson<CrapsGameV2DeploymentArtifact>(deploymentPath);
  if (deployment.network !== network.name) {
    throw new Error(`Deployment artifact network mismatch: expected ${network.name}, received ${deployment.network}`);
  }

  const [baseSigner] = await ethers.getSigners();
  if (baseSigner === undefined) {
    throw new Error("No signer available. Set DEPLOYER_PRIVATE_KEY before running the smoke test.");
  }

  const signer = new ethers.NonceManager(baseSigner);
  const player = await signer.getAddress();
  const game = await ethers.getContractAt("CrapsGameV2", deployment.contractAddress, signer);
  const token = await ethers.getContractAt("MockERC20", deployment.tokenAddress, signer);

  const walletBalanceBefore = await token.balanceOf(player);
  const initialState = await game.getPlayerState(player);
  if (initialState.paused) {
    throw new Error("CrapsGameV2 is paused; smoke test cannot proceed");
  }
  if (initialState.selfExcluded || initialState.operatorExcluded) {
    throw new Error("Player is excluded; use a non-excluded wallet for the smoke test");
  }
  if (Number(initialState.phase) === SESSION_PHASE_ROLL_PENDING) {
    throw new Error("Player already has a pending roll; wait for fulfillment or expire/close the session before smoke testing");
  }

  const txHashes: Record<string, string> = {};
  const requestInfo: { requestId?: string; rollRequestedBlock?: number; rollResolvedTxHash?: string } = {};
  const expectedFee = (depositAmount * 50n) / 10_000n;
  const expectedAvailableDelta = depositAmount - expectedFee;
  let walletFundingNote = `Wallet held enough testnet token balance before the run (${walletBalanceBefore} base units)`;
  let depositNote = `deposit(${depositAmount}) updated available balance by ${expectedAvailableDelta} and accrued fees by ${expectedFee}`;

  let workingState = initialState;

  if (Number(workingState.phase) !== SESSION_PHASE_INACTIVE) {
    const closeReceipt = await (await game.closeSession()).wait();
    txHashes.closeSession = closeReceipt!.hash;
    workingState = await waitForCondition(
      () => game.getPlayerState(player),
      (state) => Number(state.phase) === SESSION_PHASE_INACTIVE,
      timeoutMs,
      pollIntervalMs,
      "session close"
    );
  }

  const depositAlreadySatisfied = workingState.available + workingState.inPlay + workingState.reserved >= passLineBet + withdrawAmount;
  if (depositAlreadySatisfied) {
    walletFundingNote = `Wallet resumed from an earlier funded/deposit state (${walletBalanceBefore} wallet units, ${workingState.available + workingState.inPlay + workingState.reserved} on-contract units)`;
    depositNote = "deposit step was already satisfied by existing on-contract player funds from an earlier run";
  } else {
    if (walletBalanceBefore < depositAmount) {
      throw new Error(
        `Insufficient testnet token balance for smoke test. Need ${depositAmount} base units, have ${walletBalanceBefore}. Fund or remint the wallet first.`
      );
    }

    const allowance = await token.allowance(player, deployment.contractAddress);
    if (allowance < depositAmount) {
      const approvalReceipt = await (await token.approve(deployment.contractAddress, depositAmount)).wait();
      txHashes.approve = approvalReceipt!.hash;
    }

    const depositStateBefore = workingState;
    const depositReceipt = await (await game.deposit(depositAmount)).wait();
    txHashes.deposit = depositReceipt!.hash;

    const depositStateAfter = await waitForCondition(
      () => game.getPlayerState(player),
      (state) => state.available >= depositStateBefore.available + expectedAvailableDelta,
      timeoutMs,
      pollIntervalMs,
      "deposit accounting update"
    );
    const availableDelta = depositStateAfter.available - depositStateBefore.available;
    const accruedFeesDelta = depositStateAfter.accruedFees - depositStateBefore.accruedFees;

    if (availableDelta !== expectedAvailableDelta) {
      throw new Error(`Deposit available delta mismatch: expected ${expectedAvailableDelta}, received ${availableDelta}`);
    }
    if (accruedFeesDelta !== expectedFee) {
      throw new Error(`Deposit fee delta mismatch: expected ${expectedFee}, received ${accruedFeesDelta}`);
    }

    workingState = depositStateAfter;
  }

  const turnActions = [[PLACE_BET, PASS_LINE, 0, passLineBet, false]] as const;
  const rollRequestedBlock = await ethers.provider.getBlockNumber();
  const turnReceipt = await (await game.executeTurn(turnActions, true)).wait();
  txHashes.executeTurn = turnReceipt!.hash;
  requestInfo.rollRequestedBlock = rollRequestedBlock;

  const parsedLogs = (turnReceipt?.logs ?? [])
    .map((log) => {
      try {
        return game.interface.parseLog(log);
      } catch {
        return undefined;
      }
    })
    .filter((parsed): parsed is NonNullable<typeof parsed> => parsed != null);

  const rollRequestedEvent = parsedLogs.find((parsed) => parsed.name === "RollRequested");
  if (rollRequestedEvent !== undefined) {
    requestInfo.requestId = rollRequestedEvent.args.requestId.toString();
  }

  let resolvedState = await game.getPlayerState(player);
  const deadline = Date.now() + timeoutMs;

  while (Number(resolvedState.phase) === SESSION_PHASE_ROLL_PENDING && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    resolvedState = await game.getPlayerState(player);
  }

  if (Number(resolvedState.phase) === SESSION_PHASE_ROLL_PENDING) {
    throw new Error(
      `Timed out waiting for VRF fulfillment after ${timeoutMs}ms${requestInfo.requestId ? ` (requestId ${requestInfo.requestId})` : ""}`
    );
  }

  if (requestInfo.requestId !== undefined && requestInfo.rollRequestedBlock !== undefined) {
    const resolvedEvents = await game.queryFilter(
      game.filters.RollResolved(player, BigInt(requestInfo.requestId)),
      requestInfo.rollRequestedBlock,
      "latest"
    );
    const latestResolvedEvent = resolvedEvents[resolvedEvents.length - 1];
    if (latestResolvedEvent !== undefined) {
      requestInfo.rollResolvedTxHash = latestResolvedEvent.transactionHash;
    }
  }

  if (resolvedState.pendingRequestId !== 0n) {
    throw new Error(`Resolved player state still has a pending request id: ${resolvedState.pendingRequestId}`);
  }

  const walletBalanceMid = await token.balanceOf(player);
  const withdrawReceipt = await (await game.withdraw(withdrawAmount)).wait();
  txHashes.withdraw = withdrawReceipt!.hash;
  const walletBalanceAfter = await waitForCondition(
    () => token.balanceOf(player),
    (balance) => balance >= walletBalanceMid + withdrawAmount,
    timeoutMs,
    pollIntervalMs,
    "wallet balance after withdraw"
  );

  if (walletBalanceAfter - walletBalanceMid !== withdrawAmount) {
    throw new Error(`Withdraw did not increase wallet balance by ${withdrawAmount}`);
  }

  const lines = [
    "# BASE Sepolia V2 smoke test findings",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Network: ${network.name}`,
    `- Deployer/player: ${player}`,
    `- Contract: ${deployment.contractAddress}`,
    `- Token: ${deployment.tokenAddress}`,
    `- Deployment artifact: ${path.resolve(deploymentPath)}`,
    `- Deposit amount: ${depositAmount} (${formatUsd6(depositAmount)} USDC)`,
    `- Pass Line bet: ${passLineBet} (${formatUsd6(passLineBet)} USDC)`,
    `- Withdraw amount: ${withdrawAmount} (${formatUsd6(withdrawAmount)} USDC)`,
    "",
    "## Smoke test checklist",
    "",
    `- [x] Wallet funding ready: ${walletFundingNote}`,
    `- [x] Deposit accounting correct: ${depositNote}`,
    `- [x] executeTurn([PLACE_BET PASS_LINE], true) auto-opened the session and queued a roll${requestInfo.requestId ? ` with requestId ${requestInfo.requestId}` : ""}`,
    "- [x] Chainlink VRF fulfillment completed before timeout",
    `- [x] Session advanced to phase ${resolvedState.phase.toString()} and pendingRequestId cleared`,
    `- [x] withdraw(${withdrawAmount}) returned tokens to the wallet`,
    "- [ ] Live session expiry still requires a 24h wait (or a fork-based follow-up against the deployed V2 address)",
    "",
    "## Transactions",
    "",
    ...Object.entries(txHashes).map(([label, hash]) => `- ${label}: ${hash}`),
    ...(requestInfo.rollResolvedTxHash ? [`- rollResolved: ${requestInfo.rollResolvedTxHash}`] : []),
    "",
    "## Final on-chain state snapshot",
    "",
    `- phase: ${resolvedState.phase.toString()}`,
    `- puckState: ${resolvedState.puckState.toString()}`,
    `- point: ${resolvedState.point.toString()}`,
    `- available: ${resolvedState.available.toString()}`,
    `- inPlay: ${resolvedState.inPlay.toString()}`,
    `- reserved: ${resolvedState.reserved.toString()}`,
    `- bankroll: ${resolvedState.bankroll.toString()}`,
    `- accruedFees: ${resolvedState.accruedFees.toString()}`,
    ""
  ];

  if (reportPath !== undefined) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportPath), `${lines.join("\n")}\n`);
  }

  writeJson(path.join("deployments", "last-smoke-summary-v2.json"), {
    generatedAt: new Date().toISOString(),
    network: network.name,
    player,
    deploymentPath: path.resolve(deploymentPath),
    contractAddress: deployment.contractAddress,
    tokenAddress: deployment.tokenAddress,
    depositAmount: depositAmount.toString(),
    passLineBet: passLineBet.toString(),
    withdrawAmount: withdrawAmount.toString(),
    requestId: requestInfo.requestId,
    txHashes,
    rollResolvedTxHash: requestInfo.rollResolvedTxHash,
    finalState: {
      phase: resolvedState.phase.toString(),
      puckState: resolvedState.puckState.toString(),
      point: resolvedState.point.toString(),
      available: resolvedState.available.toString(),
      inPlay: resolvedState.inPlay.toString(),
      reserved: resolvedState.reserved.toString(),
      bankroll: resolvedState.bankroll.toString(),
      accruedFees: resolvedState.accruedFees.toString()
    }
  });

  console.log(`V2 smoke test completed for ${deployment.contractAddress}`);
  if (reportPath !== undefined) {
    console.log(`Wrote findings to ${path.resolve(reportPath)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
