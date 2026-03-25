import "dotenv/config";
import path from "node:path";
import { ethers, network } from "hardhat";
import {
  DEFAULT_INITIAL_BANKROLL_AMOUNT,
  normalizeModuleParams,
  parseCliArgs,
  readJson
} from "./deployment-helpers";

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const DEFAULT_SMOKE_DEPOSIT = "100000000";
const DEFAULT_MIN_NATIVE_BALANCE_WEI = ethers.parseEther("0.02");
const DEFAULT_MIN_LINK_BALANCE_JUELS = ethers.parseEther("5");

function requirePositiveInteger(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a positive integer amount in base units`);
  }

  const parsed = BigInt(trimmed);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero`);
  }

  return parsed;
}

function formatUsd6(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

function formatLink18(amount: bigint): string {
  return ethers.formatUnits(amount, 18);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const paramsPath = args.params ?? path.join("deployments", "sepolia-params.json");
  const minNativeBalance = requirePositiveInteger(
    args.minNativeWei ?? process.env.SEPOLIA_MIN_NATIVE_BALANCE_WEI ?? DEFAULT_MIN_NATIVE_BALANCE_WEI.toString(),
    "SEPOLIA_MIN_NATIVE_BALANCE_WEI"
  );
  const minLinkBalance = requirePositiveInteger(
    args.minLinkJuels ?? process.env.SEPOLIA_MIN_LINK_BALANCE_JUELS ?? DEFAULT_MIN_LINK_BALANCE_JUELS.toString(),
    "SEPOLIA_MIN_LINK_BALANCE_JUELS"
  );

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("DEPLOYER_PRIVATE_KEY is missing");
  }
  if (!process.env.VRF_SUBSCRIPTION_ID) {
    throw new Error("VRF_SUBSCRIPTION_ID is missing");
  }

  const params = normalizeModuleParams(readJson<Record<string, unknown>>(paramsPath));
  const subscriptionId = requirePositiveInteger(process.env.VRF_SUBSCRIPTION_ID, "VRF_SUBSCRIPTION_ID");
  const initialBankrollAmount = requirePositiveInteger(
    process.env.SEPOLIA_INITIAL_BANKROLL_AMOUNT
      ?? process.env.INITIAL_BANKROLL_AMOUNT
      ?? params.initialBankrollAmount?.toString()
      ?? DEFAULT_INITIAL_BANKROLL_AMOUNT,
    "SEPOLIA_INITIAL_BANKROLL_AMOUNT"
  );
  const smokeDepositAmount = requirePositiveInteger(
    process.env.SEPOLIA_SMOKE_DEPOSIT_AMOUNT ?? DEFAULT_SMOKE_DEPOSIT,
    "SEPOLIA_SMOKE_DEPOSIT_AMOUNT"
  );
  const requiredTokenBalance = initialBankrollAmount + smokeDepositAmount;

  const [signer] = await ethers.getSigners();
  if (signer === undefined) {
    throw new Error("No signer available from DEPLOYER_PRIVATE_KEY");
  }

  const providerNetwork = await ethers.provider.getNetwork();
  if (providerNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Connected chainId ${providerNetwork.chainId.toString()} does not match BASE Sepolia (${BASE_SEPOLIA_CHAIN_ID.toString()})`);
  }

  const deployer = await signer.getAddress();
  const nativeBalance = await ethers.provider.getBalance(deployer);
  if (nativeBalance < minNativeBalance) {
    throw new Error(
      `Deployer BASE Sepolia ETH balance is too low: have ${ethers.formatEther(nativeBalance)}, require at least ${ethers.formatEther(minNativeBalance)}`
    );
  }

  const coordinatorAddress = typeof params.vrfCoordinator === "string" ? params.vrfCoordinator : "";
  if (!ethers.isAddress(coordinatorAddress)) {
    throw new Error(`Invalid VRF coordinator in ${path.resolve(paramsPath)}`);
  }

  const coordinator = await ethers.getContractAt(
    [
      "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)"
    ],
    coordinatorAddress,
    signer
  );

  let subscription:
    | { balance: bigint; nativeBalance: bigint; reqCount: bigint; owner: string; consumers: string[] }
    | undefined;
  try {
    const result = await coordinator.getSubscription(subscriptionId);
    subscription = {
      balance: result[0],
      nativeBalance: result[1],
      reqCount: result[2],
      owner: result[3],
      consumers: result[4]
    };
  } catch (error) {
    throw new Error(
      `Unable to read VRF subscription ${subscriptionId.toString()} from ${coordinatorAddress}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (subscription.owner.toLowerCase() !== deployer.toLowerCase()) {
    throw new Error(
      `VRF subscription owner mismatch: deployer is ${deployer}, subscription owner is ${subscription.owner}. Automated consumer registration will fail.`
    );
  }

  if (subscription.balance < minLinkBalance) {
    throw new Error(
      `VRF subscription LINK balance is too low: have ${formatLink18(subscription.balance)}, require at least ${formatLink18(minLinkBalance)}`
    );
  }

  console.log("Sepolia rehearsal preflight passed");
  console.log(`- network: ${network.name} (${providerNetwork.chainId.toString()})`);
  console.log(`- deployer: ${deployer}`);
  console.log(`- native balance: ${ethers.formatEther(nativeBalance)} ETH`);
  console.log(`- subscription id: ${subscriptionId.toString()}`);
  console.log(`- subscription owner: ${subscription.owner}`);
  console.log(`- subscription LINK balance: ${formatLink18(subscription.balance)} LINK`);
  console.log(`- planned bankroll: ${initialBankrollAmount.toString()} (${formatUsd6(initialBankrollAmount)} tokens)`);
  console.log(`- planned smoke deposit: ${smokeDepositAmount.toString()} (${formatUsd6(smokeDepositAmount)} tokens)`);
  console.log(`- planned minted total: ${requiredTokenBalance.toString()} (${formatUsd6(requiredTokenBalance)} tokens)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
