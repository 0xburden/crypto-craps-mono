import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import {
  CRAPS_GAME_MODULE_ID,
  DEFAULT_INITIAL_BANKROLL_AMOUNT,
  normalizeModuleParams,
  parseCliArgs,
  readJson,
  writeJson
} from "./deployment-helpers";

type Target = "sepolia" | "mainnet";

const TARGET_CONFIG: Record<Target, {
  paramsFile: string;
  outputFile: string;
  subscriptionEnv: string;
  bankrollEnv: string;
  tokenEnv: string;
  fallbackTokenArtifact?: string;
  rpcEnv: string;
  networkName: string;
}> = {
  sepolia: {
    paramsFile: path.join("deployments", "sepolia-params.json"),
    outputFile: path.join("deployments", "generated", "sepolia-params.generated.json"),
    subscriptionEnv: "VRF_SUBSCRIPTION_ID",
    bankrollEnv: "SEPOLIA_INITIAL_BANKROLL_AMOUNT",
    tokenEnv: "SEPOLIA_TOKEN_ADDRESS",
    fallbackTokenArtifact: path.join("deployments", "baseSepolia-rehearsal-token.json"),
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    networkName: "baseSepolia"
  },
  mainnet: {
    paramsFile: path.join("deployments", "mainnet-params.json"),
    outputFile: path.join("deployments", "generated", "mainnet-params.generated.json"),
    subscriptionEnv: "VRF_SUBSCRIPTION_ID_MAINNET",
    bankrollEnv: "MAINNET_INITIAL_BANKROLL_AMOUNT",
    tokenEnv: "MAINNET_TOKEN_ADDRESS",
    rpcEnv: "BASE_MAINNET_RPC_URL",
    networkName: "base"
  }
};

function resolveTarget(value: string | undefined): Target {
  if (value === undefined || value === "sepolia") {
    return "sepolia";
  }

  if (value === "mainnet") {
    return "mainnet";
  }

  throw new Error(`Unsupported deployment target: ${value}`);
}

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) > 0n;
}

function resolveTokenAddress(
  targetConfig: (typeof TARGET_CONFIG)[Target],
  explicitTokenAddress: string,
  fallbackTokenAddress: string | undefined
): { tokenAddress: string; tokenSource: string } {
  if (explicitTokenAddress !== "") {
    return {
      tokenAddress: explicitTokenAddress,
      tokenSource: `${targetConfig.tokenEnv} override`
    };
  }

  if (targetConfig.fallbackTokenArtifact !== undefined) {
    const fallbackArtifactPath = path.resolve(targetConfig.fallbackTokenArtifact);
    if (fs.existsSync(fallbackArtifactPath)) {
      const artifact = readJson<{ tokenAddress?: string }>(fallbackArtifactPath);
      if (typeof artifact.tokenAddress === "string" && artifact.tokenAddress !== "") {
        return {
          tokenAddress: artifact.tokenAddress,
          tokenSource: `rehearsal token artifact (${fallbackArtifactPath})`
        };
      }
    }
  }

  return {
    tokenAddress: fallbackTokenAddress ?? "",
    tokenSource: "source params file"
  };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const target = resolveTarget(args.target ?? process.env.CRAPS_DEPLOY_TARGET);
  const targetConfig = TARGET_CONFIG[target];
  const sourceFile = args.source ?? targetConfig.paramsFile;
  const outputFile = args.out ?? targetConfig.outputFile;

  const currentParams = normalizeModuleParams(readJson<Record<string, unknown>>(sourceFile));
  const subscriptionId = (process.env[targetConfig.subscriptionEnv] ?? currentParams.subscriptionId?.toString() ?? "").trim();
  const initialBankrollAmount = (
    process.env[targetConfig.bankrollEnv]
    ?? process.env.INITIAL_BANKROLL_AMOUNT
    ?? currentParams.initialBankrollAmount?.toString()
    ?? DEFAULT_INITIAL_BANKROLL_AMOUNT
  ).trim();
  const { tokenAddress, tokenSource } = resolveTokenAddress(
    targetConfig,
    (process.env[targetConfig.tokenEnv] ?? "").trim(),
    typeof currentParams.tokenAddress === "string" ? currentParams.tokenAddress.trim() : undefined
  );

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("DEPLOYER_PRIVATE_KEY must be set before preparing deployment parameters");
  }

  if (!isPositiveInteger(subscriptionId)) {
    throw new Error(
      `${targetConfig.subscriptionEnv} must be set to a non-zero integer before deploying to ${targetConfig.networkName}`
    );
  }

  if (!isPositiveInteger(initialBankrollAmount)) {
    throw new Error("INITIAL_BANKROLL_AMOUNT must be a positive integer amount in token base units");
  }

  if (!ethers.isAddress(tokenAddress)) {
    throw new Error(`${targetConfig.tokenEnv} or the source params file must provide a valid token address`);
  }

  const renderedParams = {
    [CRAPS_GAME_MODULE_ID]: {
      ...currentParams,
      tokenAddress,
      subscriptionId,
      initialBankrollAmount
    }
  };

  writeJson(outputFile, renderedParams);

  console.log(`Prepared ${targetConfig.networkName} deployment params:`);
  console.log(`- source: ${path.resolve(sourceFile)}`);
  console.log(`- output: ${path.resolve(outputFile)}`);
  console.log(`- subscription env: ${targetConfig.subscriptionEnv}`);
  console.log(`- subscription id: ${subscriptionId}`);
  console.log(`- token env: ${targetConfig.tokenEnv}`);
  console.log(`- token source: ${tokenSource}`);
  console.log(`- token address: ${tokenAddress}`);
  console.log(`- bankroll env: ${targetConfig.bankrollEnv}${process.env[targetConfig.bankrollEnv] ? " (target-specific override)" : process.env.INITIAL_BANKROLL_AMOUNT ? " (generic override)" : " (params/default)"}`);
  console.log(`- initial bankroll: ${initialBankrollAmount}`);
  console.log(`- rpc env present: ${process.env[targetConfig.rpcEnv] ? "yes" : "no (Hardhat fallback/default will be used)"}`);
  console.log(`- explorer API key present: ${process.env.BASESCAN_API_KEY ? "yes" : "no"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
