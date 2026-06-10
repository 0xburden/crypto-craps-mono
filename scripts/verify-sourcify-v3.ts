import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import { parseCliArgs, readJson } from "./deployment-helpers";

interface CrapsGameV3DeploymentArtifact {
  contractName: "CrapsGameV3";
  contractAddress: string;
  payoutMathLibrary: string;
  rollResolutionLibrary: string;
  network: string;
}

interface HardhatDebugArtifact {
  buildInfo: string;
}

interface HardhatBuildInfo {
  input: {
    sources: Record<string, { content: string }>;
  };
  output: {
    contracts: Record<string, Record<string, { metadata: string }>>;
  };
}

const SOURCIFY_API_URL = "https://sourcify.dev/server";
const SOURCIFY_BROWSER_URL = "https://repo.sourcify.dev";

function defaultDeploymentPath(): string {
  if (network.name === "baseSepolia") {
    return path.join("deployments", "sepolia-deployment-v3.json");
  }
  if (network.name === "base") {
    return path.join("deployments", "mainnet-deployment-v3.json");
  }
  return path.join("deployments", `${network.name}-deployment-v3.json`);
}

function loadBuildInfoFor(contractArtifactDbgPath: string): HardhatBuildInfo {
  const dbg = readJson<HardhatDebugArtifact>(contractArtifactDbgPath);
  const buildInfoPath = path.resolve(path.dirname(contractArtifactDbgPath), dbg.buildInfo);
  return readJson<HardhatBuildInfo>(buildInfoPath);
}

function loadVerificationFiles(
  contractArtifactDbgPath: string,
  sourceName: string,
  contractName: string
): Record<string, string> {
  const buildInfo = loadBuildInfoFor(contractArtifactDbgPath);
  const contract = buildInfo.output.contracts[sourceName]?.[contractName];
  if (contract === undefined) {
    throw new Error(`Could not find ${sourceName}:${contractName} in build info`);
  }

  const files: Record<string, string> = {
    "metadata.json": contract.metadata,
  };

  for (const [fileName, source] of Object.entries(buildInfo.input.sources)) {
    files[fileName] = source.content;
  }

  return files;
}

async function postVerify(address: string, chainId: number, files: Record<string, string>) {
  const response = await fetch(SOURCIFY_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      address,
      chain: chainId.toString(),
      files,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 409 && text.includes("already partially verified")) {
      console.log(`${address} already partially verified on Sourcify`);
      return;
    }

    throw new Error(`Sourcify verify failed (${response.status}): ${text}`);
  }

  const json = JSON.parse(text) as {
    result?: Array<{ status?: string }>;
  };
  const status = json.result?.[0]?.status ?? "unknown";
  const matchType = status === "perfect" ? "full_match" : "partial_match";
  console.log(`${address} -> ${status}`);
  console.log(`${SOURCIFY_BROWSER_URL}/contracts/${matchType}/${chainId}/${address}/`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const deploymentPath = args.deployment ?? process.env.CRAPS_VERIFY_DEPLOYMENT_V3 ?? defaultDeploymentPath();
  const deployment = readJson<CrapsGameV3DeploymentArtifact>(deploymentPath);

  if (deployment.network !== network.name) {
    throw new Error(`Deployment artifact network mismatch: expected ${network.name}, received ${deployment.network}`);
  }

  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);

  const payoutFiles = loadVerificationFiles(
    path.join("artifacts", "contracts", "libraries", "PayoutMathV3.sol", "PayoutMathV3.dbg.json"),
    "contracts/libraries/PayoutMathV3.sol",
    "PayoutMathV3",
  );
  await postVerify(deployment.payoutMathLibrary, chainId, payoutFiles);

  const resolverFiles = loadVerificationFiles(
    path.join("artifacts", "contracts", "libraries", "RollResolutionV3.sol", "RollResolutionV3.dbg.json"),
    "contracts/libraries/RollResolutionV3.sol",
    "RollResolutionV3",
  );
  await postVerify(deployment.rollResolutionLibrary, chainId, resolverFiles);

  const gameFiles = loadVerificationFiles(
    path.join("artifacts", "contracts", "CrapsGameV3.sol", "CrapsGameV3.dbg.json"),
    "contracts/CrapsGameV3.sol",
    "CrapsGameV3",
  );
  await postVerify(deployment.contractAddress, chainId, gameFiles);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
