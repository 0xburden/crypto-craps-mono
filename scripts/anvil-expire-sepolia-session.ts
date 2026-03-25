import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import {
  CrapsGameDeploymentArtifact,
  parseCliArgs,
  readJson,
  writeJson
} from "./deployment-helpers";

const SESSION_PHASE_INACTIVE = 0;
const SESSION_PHASE_ROLL_PENDING = 3;
const SESSION_TIMEOUT_SECONDS = 24 * 60 * 60;
const DEFAULT_WITHDRAW_AMOUNT = 1_000_000n;
const DEFAULT_ANVIL_RPC_URL = "http://127.0.0.1:8555";
const DEFAULT_ANVIL_EXECUTOR_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

interface RehearsalTokenArtifact {
  deployer?: string;
}

function bigintArg(value: string | undefined, fallback: bigint): bigint {
  if (value === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected an integer argument, received: ${value}`);
  }

  return BigInt(value);
}

function formatUsd6(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}

function resolvePlayerAddress(explicitPlayer: string | undefined): string {
  if (explicitPlayer !== undefined) {
    if (!ethers.isAddress(explicitPlayer)) {
      throw new Error(`Invalid player address: ${explicitPlayer}`);
    }

    return explicitPlayer;
  }

  const rehearsalTokenArtifactPath = path.join("deployments", "baseSepolia-rehearsal-token.json");
  if (fs.existsSync(rehearsalTokenArtifactPath)) {
    const rehearsalArtifact = readJson<RehearsalTokenArtifact>(rehearsalTokenArtifactPath);
    if (typeof rehearsalArtifact.deployer === "string" && ethers.isAddress(rehearsalArtifact.deployer)) {
      return rehearsalArtifact.deployer;
    }
  }

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("Unable to resolve player address. Pass --player or set DEPLOYER_PRIVATE_KEY.");
  }

  return new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY).address;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const deploymentPath = args.deployment ?? path.join("deployments", "sepolia-deployment.json");
  const reportPath = args.report ?? path.join("deployments", "sepolia-expiry-fork-findings.md");
  const withdrawAmount = bigintArg(args.withdraw ?? process.env.SEPOLIA_SMOKE_WITHDRAW_AMOUNT, DEFAULT_WITHDRAW_AMOUNT);
  const player = resolvePlayerAddress(args.player ?? process.env.SEPOLIA_EXPIRY_PLAYER);
  const rpcUrl = args.rpc ?? process.env.ANVIL_RPC_URL ?? DEFAULT_ANVIL_RPC_URL;
  const executorPrivateKey = process.env.ANVIL_EXECUTOR_PRIVATE_KEY ?? DEFAULT_ANVIL_EXECUTOR_PRIVATE_KEY;

  const deployment = readJson<CrapsGameDeploymentArtifact>(deploymentPath);
  if (deployment.network !== "baseSepolia") {
    throw new Error(`Expected a baseSepolia deployment artifact, received ${deployment.network}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, {
    chainId: deployment.chainId,
    name: deployment.network
  });
  const executor = new ethers.Wallet(executorPrivateKey, provider);
  const gameArtifact = readJson<{ abi: unknown[] }>(path.join("artifacts", "contracts", "CrapsGame.sol", "CrapsGame.json"));
  const game = new ethers.Contract(deployment.contractAddress, gameArtifact.abi, executor);
  const token = new ethers.Contract(
    deployment.tokenAddress,
    ["function balanceOf(address owner) view returns (uint256)"],
    executor
  );

  const before = await game.getPlayerState(player);
  if (Number(before.phase) === SESSION_PHASE_INACTIVE) {
    throw new Error(`Player ${player} does not currently have an active session on the forked deployment.`);
  }

  const playerWalletBefore = await token.balanceOf(player);
  const expectedAvailableIncrease = Number(before.phase) === SESSION_PHASE_ROLL_PENDING
    ? before.inPlay + before.reserved
    : before.inPlay;

  await provider.send("evm_increaseTime", [SESSION_TIMEOUT_SECONDS + 1]);
  await provider.send("evm_mine", []);

  const expireReceipt = await (await game.expireSession(player)).wait();
  const after = await game.getPlayerState(player);

  if (Number(after.phase) !== SESSION_PHASE_INACTIVE) {
    throw new Error(`Session expiry failed: expected phase ${SESSION_PHASE_INACTIVE}, received ${after.phase.toString()}`);
  }
  if (after.inPlay !== 0n) {
    throw new Error(`Session expiry failed to clear inPlay: ${after.inPlay.toString()}`);
  }
  if (after.reserved !== 0n) {
    throw new Error(`Session expiry failed to clear reserved funds: ${after.reserved.toString()}`);
  }
  if (after.pendingRequestId !== 0n) {
    throw new Error(`Session expiry failed to clear pendingRequestId: ${after.pendingRequestId.toString()}`);
  }

  const availableIncrease = after.available - before.available;
  if (availableIncrease !== expectedAvailableIncrease) {
    throw new Error(
      `Unexpected available balance delta after expiry: expected ${expectedAvailableIncrease.toString()}, received ${availableIncrease.toString()}`
    );
  }

  await provider.send("anvil_impersonateAccount", [player]);
  await provider.send("anvil_setBalance", [player, "0x3635C9ADC5DEA00000"]);

  const playerSigner = await provider.getSigner(player);
  const playerGame = new ethers.Contract(deployment.contractAddress, gameArtifact.abi, playerSigner);
  const playerToken = new ethers.Contract(
    deployment.tokenAddress,
    ["function balanceOf(address owner) view returns (uint256)"],
    playerSigner
  );

  const walletBeforeWithdraw = await playerToken.balanceOf(player);
  const withdrawReceipt = await (await playerGame.withdraw(withdrawAmount)).wait();
  const walletAfterWithdraw = await playerToken.balanceOf(player);

  if (walletAfterWithdraw - walletBeforeWithdraw !== withdrawAmount) {
    throw new Error(
      `Withdraw after expiry did not return the expected amount: expected ${withdrawAmount.toString()}, received ${(walletAfterWithdraw - walletBeforeWithdraw).toString()}`
    );
  }

  await provider.send("anvil_stopImpersonatingAccount", [player]);

  const lines = [
    "# BASE Sepolia Anvil fork expiry findings",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Anvil RPC: ${rpcUrl}`,
    `- Deployment artifact: ${path.resolve(deploymentPath)}`,
    `- Game contract: ${deployment.contractAddress}`,
    `- Player: ${player}`,
    `- Pre-expiry phase: ${before.phase.toString()}`,
    `- Pre-expiry available: ${before.available.toString()} (${formatUsd6(before.available)} token units)`,
    `- Pre-expiry inPlay: ${before.inPlay.toString()} (${formatUsd6(before.inPlay)} token units)`,
    `- Pre-expiry reserved: ${before.reserved.toString()} (${formatUsd6(before.reserved)} token units)`,
    `- Post-expiry available: ${after.available.toString()} (${formatUsd6(after.available)} token units)`,
    `- Post-expiry inPlay: ${after.inPlay.toString()} (${formatUsd6(after.inPlay)} token units)`,
    `- Post-expiry reserved: ${after.reserved.toString()} (${formatUsd6(after.reserved)} token units)`,
    `- Expected available increase: ${expectedAvailableIncrease.toString()} (${formatUsd6(expectedAvailableIncrease)} token units)`,
    `- Actual available increase: ${availableIncrease.toString()} (${formatUsd6(availableIncrease)} token units)`,
    `- Wallet before withdraw: ${playerWalletBefore.toString()} (${formatUsd6(playerWalletBefore)} token units)`,
    `- Wallet after withdraw: ${walletAfterWithdraw.toString()} (${formatUsd6(walletAfterWithdraw)} token units)`,
    "",
    "## Transactions (fork only)",
    "",
    `- expireSession: ${expireReceipt?.hash ?? "unknown"}`,
    `- withdraw: ${withdrawReceipt?.hash ?? "unknown"}`,
    "",
    "## Result",
    "",
    "- [x] Anvil fork-based 24h session expiry path succeeded",
    "- [x] Session moved to INACTIVE",
    "- [x] In-play / reserved funds were released as expected",
    "- [x] Player withdrawal still worked after expiry",
    ""
  ];

  fs.writeFileSync(path.resolve(reportPath), `${lines.join("\n")}\n`);
  writeJson(path.join("deployments", "sepolia-expiry-fork-summary.json"), {
    generatedAt: new Date().toISOString(),
    deploymentPath: path.resolve(deploymentPath),
    reportPath: path.resolve(reportPath),
    gameContract: deployment.contractAddress,
    player,
    before: {
      phase: before.phase.toString(),
      available: before.available.toString(),
      inPlay: before.inPlay.toString(),
      reserved: before.reserved.toString(),
      pendingRequestId: before.pendingRequestId.toString()
    },
    after: {
      phase: after.phase.toString(),
      available: after.available.toString(),
      inPlay: after.inPlay.toString(),
      reserved: after.reserved.toString(),
      pendingRequestId: after.pendingRequestId.toString()
    },
    expectedAvailableIncrease: expectedAvailableIncrease.toString(),
    actualAvailableIncrease: availableIncrease.toString(),
    expireTxHash: expireReceipt?.hash,
    withdrawTxHash: withdrawReceipt?.hash
  });

  console.log(`Anvil fork-based expiry check passed for ${player}`);
  console.log(`Wrote report to ${path.resolve(reportPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
