import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import { DEFAULT_INITIAL_BANKROLL_AMOUNT, parseCliArgs, readJson } from "./deployment-helpers";

interface RehearsalTokenArtifact {
  tokenAddress: string;
}

const DEFAULT_SEPOLIA_BANKROLL = DEFAULT_INITIAL_BANKROLL_AMOUNT;
const DEFAULT_SEPOLIA_SMOKE_DEPOSIT = "100000000";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCode(address: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = await ethers.provider.getCode(address);
    if (code !== "0x") {
      return;
    }

    await sleep(3_000);
  }

  throw new Error(`Timed out waiting for token code at ${address}`);
}

function parseUnitsLike(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a positive integer amount in token base units`);
  }

  return BigInt(trimmed);
}

function formatUsd6(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}

function resolveTokenAddress(explicitAddress: string | undefined, artifactPath: string): string {
  if (explicitAddress !== undefined && explicitAddress !== "") {
    if (!ethers.isAddress(explicitAddress)) {
      throw new Error(`Invalid rehearsal token address: ${explicitAddress}`);
    }

    return explicitAddress;
  }

  if (!fs.existsSync(path.resolve(artifactPath))) {
    throw new Error(
      `Rehearsal token artifact not found at ${path.resolve(artifactPath)}. Deploy the token first or set SEPOLIA_REHEARSAL_TOKEN_ADDRESS.`
    );
  }

  const artifact = readJson<RehearsalTokenArtifact>(artifactPath);
  if (!ethers.isAddress(artifact.tokenAddress)) {
    throw new Error(`Invalid token address in rehearsal token artifact: ${artifact.tokenAddress}`);
  }

  return artifact.tokenAddress;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const artifactPath = args.deployment
    ?? process.env.CRAPS_REHEARSAL_TOKEN_DEPLOYMENT
    ?? path.join("deployments", `${network.name}-rehearsal-token.json`);
  const tokenAddress = resolveTokenAddress(
    args.token ?? process.env.SEPOLIA_REHEARSAL_TOKEN_ADDRESS ?? process.env.SEPOLIA_TOKEN_ADDRESS,
    artifactPath
  );

  const [signer] = await ethers.getSigners();
  if (signer === undefined) {
    throw new Error("No signer available. Set DEPLOYER_PRIVATE_KEY before minting rehearsal funds.");
  }

  const recipient = args.to ?? process.env.SEPOLIA_REHEARSAL_MINT_RECIPIENT ?? await signer.getAddress();
  if (!ethers.isAddress(recipient)) {
    throw new Error(`Invalid mint recipient address: ${recipient}`);
  }

  const initialBankrollAmount = parseUnitsLike(
    process.env.SEPOLIA_INITIAL_BANKROLL_AMOUNT
      ?? process.env.INITIAL_BANKROLL_AMOUNT
      ?? DEFAULT_SEPOLIA_BANKROLL
      ?? DEFAULT_INITIAL_BANKROLL_AMOUNT,
    "SEPOLIA_INITIAL_BANKROLL_AMOUNT"
  );
  const smokeDepositAmount = parseUnitsLike(
    process.env.SEPOLIA_SMOKE_DEPOSIT_AMOUNT ?? DEFAULT_SEPOLIA_SMOKE_DEPOSIT,
    "SEPOLIA_SMOKE_DEPOSIT_AMOUNT"
  );
  const extraMintAmount = parseUnitsLike(
    process.env.SEPOLIA_REHEARSAL_EXTRA_MINT_AMOUNT ?? "0",
    "SEPOLIA_REHEARSAL_EXTRA_MINT_AMOUNT"
  );

  const requiredAmount = initialBankrollAmount + smokeDepositAmount + extraMintAmount;
  await waitForCode(tokenAddress);

  const token = await ethers.getContractAt("MockERC20", tokenAddress, signer);
  const currentBalance = await token.balanceOf(recipient);
  const mintAmount = currentBalance >= requiredAmount ? 0n : requiredAmount - currentBalance;

  console.log(`Rehearsal token: ${tokenAddress}`);
  console.log(`Recipient: ${recipient}`);
  console.log(`Required bankroll target: ${initialBankrollAmount} (${formatUsd6(initialBankrollAmount)} tokens)`);
  console.log(`Required smoke deposit: ${smokeDepositAmount} (${formatUsd6(smokeDepositAmount)} tokens)`);
  console.log(`Extra mint buffer: ${extraMintAmount} (${formatUsd6(extraMintAmount)} tokens)`);
  console.log(`Required total balance: ${requiredAmount} (${formatUsd6(requiredAmount)} tokens)`);
  console.log(`Current balance: ${currentBalance} (${formatUsd6(currentBalance)} tokens)`);

  if (mintAmount === 0n) {
    console.log("Recipient already holds enough rehearsal funds; no mint was needed.");
    return;
  }

  const receipt = await (await token.mint(recipient, mintAmount)).wait();

  let newBalance = await token.balanceOf(recipient);
  for (let attempt = 0; attempt < 20 && newBalance < requiredAmount; attempt += 1) {
    await sleep(3_000);
    newBalance = await token.balanceOf(recipient);
  }

  console.log(`Minted: ${mintAmount} (${formatUsd6(mintAmount)} tokens)`);
  console.log(`New balance: ${newBalance} (${formatUsd6(newBalance)} tokens)`);
  console.log(`Transaction hash: ${receipt?.hash ?? "unknown"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
