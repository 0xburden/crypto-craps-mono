import "dotenv/config";
import path from "node:path";
import { ethers, network, run } from "hardhat";
import { parseCliArgs, readJson } from "./deployment-helpers";

interface CrapsGameV2DeploymentArtifact {
  contractName: "CrapsGameV2";
  contractAddress: string;
  rollResolutionLibrary: string;
  network: string;
  tokenAddress: string;
  vrfCoordinator: string;
  vrfSubscriptionId: string;
  keyHash: string;
}

interface HardhatDebugArtifact {
  buildInfo: string;
}

interface HardhatBuildInfo {
  solcLongVersion: string;
  input: {
    language: string;
    sources: Record<string, { content: string }>;
    settings: Record<string, unknown>;
  };
}

const VERIFY_RETRY_ATTEMPTS = 8;
const VERIFY_RETRY_DELAY_MS = 15_000;
const BASESCAN_V2_API_URL = "https://api.etherscan.io/v2/api";
const BASESCAN_STATUS_POLL_INTERVAL_MS = 5_000;
const BASESCAN_STATUS_MAX_POLLS = 60;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableVerificationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "does not have bytecode",
    "unable to locate contractcode",
    "contract verification failed due to limited api",
    "please wait",
    "not yet available",
    "try again"
  ].some((needle) => normalized.includes(needle));
}

function defaultDeploymentPath(): string {
  if (network.name === "baseSepolia") {
    return path.join("deployments", "sepolia-deployment-v2.json");
  }
  if (network.name === "base") {
    return path.join("deployments", "mainnet-deployment-v2.json");
  }
  return path.join("deployments", `${network.name}-deployment-v2.json`);
}

function loadBuildInfo(contractArtifactDbgPath: string): HardhatBuildInfo {
  const dbg = readJson<HardhatDebugArtifact>(contractArtifactDbgPath);
  const buildInfoPath = path.resolve(path.dirname(contractArtifactDbgPath), dbg.buildInfo);
  return readJson<HardhatBuildInfo>(buildInfoPath);
}

async function verifyWithRetry(
  label: string,
  taskArgs: {
    address: string;
    contract: string;
    constructorArguments?: unknown[];
    libraries?: Record<string, string>;
  }
) {
  for (let attempt = 1; attempt <= VERIFY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await run("verify:verify", taskArgs);
      console.log(`Verified ${label} at ${taskArgs.address}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already verified")) {
        console.log(`Already verified ${label}: ${taskArgs.address}`);
        return;
      }

      if (attempt < VERIFY_RETRY_ATTEMPTS && isRetryableVerificationError(message)) {
        console.warn(`Verification attempt ${attempt} failed for ${label}, retrying in ${VERIFY_RETRY_DELAY_MS / 1000}s: ${message}`);
        await sleep(VERIFY_RETRY_DELAY_MS);
        continue;
      }

      throw error;
    }
  }
}

async function postForm(url: URL, body: URLSearchParams) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { response, text, json };
}

async function getJson(url: URL) {
  const response = await fetch(url);
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { response, text, json };
}

async function verifyCrapsGameV2OnBasescan(deployment: CrapsGameV2DeploymentArtifact) {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) {
    throw new Error("BASESCAN_API_KEY must be set to verify CrapsGameV2 on Basescan");
  }

  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);
  const buildInfo = loadBuildInfo(path.join("artifacts", "contracts", "CrapsGameV2.sol", "CrapsGameV2.dbg.json"));

  const fullInput = structuredClone(buildInfo.input);
  fullInput.settings = {
    ...fullInput.settings,
    libraries: {
      "contracts/libraries/RollResolutionV2.sol": {
        RollResolutionV2: deployment.rollResolutionLibrary,
      },
    },
  };

  const factory = await ethers.getContractFactory("CrapsGameV2", {
    libraries: {
      RollResolutionV2: deployment.rollResolutionLibrary,
    },
  });
  const constructorArguments = factory.interface
    .encodeDeploy([
      deployment.tokenAddress,
      deployment.vrfCoordinator,
      BigInt(deployment.vrfSubscriptionId),
      deployment.keyHash,
    ])
    .replace("0x", "");

  const submitUrl = new URL(BASESCAN_V2_API_URL);
  submitUrl.searchParams.set("chainid", String(chainId));

  const submitBody = new URLSearchParams({
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: deployment.contractAddress,
    sourceCode: JSON.stringify(fullInput),
    codeformat: "solidity-standard-json-input",
    contractname: "contracts/CrapsGameV2.sol:CrapsGameV2",
    compilerversion: `v${buildInfo.solcLongVersion}`,
    constructorArguements: constructorArguments,
  });

  const submit = await postForm(submitUrl, submitBody);
  const submitJson = submit.json as { status?: string; result?: string; message?: string };

  if (!submit.response.ok) {
    throw new Error(`Basescan verify submit failed (${submit.response.status}): ${submit.text}`);
  }

  if (submitJson.status !== "1") {
    const submitText = submit.text.toLowerCase();
    if (submitText.includes("already verified")) {
      console.log(`Already verified CrapsGameV2: ${deployment.contractAddress}`);
      return;
    }

    throw new Error(`Basescan verify submit failed: ${submit.text}`);
  }

  const guid = submitJson.result;
  if (!guid) {
    throw new Error(`Missing Basescan verification GUID: ${submit.text}`);
  }

  for (let attempt = 1; attempt <= BASESCAN_STATUS_MAX_POLLS; attempt += 1) {
    await sleep(BASESCAN_STATUS_POLL_INTERVAL_MS);

    const statusUrl = new URL(BASESCAN_V2_API_URL);
    statusUrl.searchParams.set("chainid", String(chainId));
    statusUrl.searchParams.set("apikey", apiKey);
    statusUrl.searchParams.set("module", "contract");
    statusUrl.searchParams.set("action", "checkverifystatus");
    statusUrl.searchParams.set("guid", guid);

    const status = await getJson(statusUrl);
    const statusJson = status.json as { status?: string; result?: string; message?: string };
    const result = statusJson.result ?? "";

    if (statusJson.status === "1") {
      console.log(`Verified CrapsGameV2 at ${deployment.contractAddress}`);
      console.log(`https://sepolia.basescan.org/address/${deployment.contractAddress}#code`);
      return;
    }

    if (!result.toLowerCase().includes("pending")) {
      throw new Error(`Basescan verify status failed: ${status.text}`);
    }
  }

  throw new Error(`Timed out waiting for Basescan verification for ${deployment.contractAddress}`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const deploymentPath = args.deployment ?? process.env.CRAPS_VERIFY_DEPLOYMENT_V2 ?? defaultDeploymentPath();
  const deployment = readJson<CrapsGameV2DeploymentArtifact>(deploymentPath);

  if (deployment.network !== network.name) {
    throw new Error(`Deployment artifact network mismatch: expected ${network.name}, received ${deployment.network}`);
  }

  await verifyWithRetry("RollResolutionV2", {
    address: deployment.rollResolutionLibrary,
    contract: "contracts/libraries/RollResolutionV2.sol:RollResolutionV2",
    constructorArguments: [],
  });

  await verifyCrapsGameV2OnBasescan(deployment);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Verification input: ${path.resolve(process.argv[process.argv.length - 1] ?? "")}`);
  process.exitCode = 1;
});
