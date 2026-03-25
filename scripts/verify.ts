import path from "node:path";
import { network, run } from "hardhat";
import {
  CrapsGameDeploymentArtifact,
  getDefaultDeploymentArtifactPath,
  parseCliArgs,
  readJson
} from "./deployment-helpers";

const VERIFY_RETRY_ATTEMPTS = 8;
const VERIFY_RETRY_DELAY_MS = 15_000;

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

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const deploymentPath = args.deployment ?? process.env.CRAPS_VERIFY_DEPLOYMENT ?? getDefaultDeploymentArtifactPath(network.name);
  const deployment = readJson<CrapsGameDeploymentArtifact>(deploymentPath);

  if (deployment.usesMocks) {
    throw new Error("Mock deployments cannot be verified on Basescan/Etherscan");
  }

  if (deployment.network !== network.name) {
    throw new Error(
      `Deployment artifact network mismatch: expected ${network.name}, received ${deployment.network}`
    );
  }

  for (let attempt = 1; attempt <= VERIFY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await run("verify:verify", {
        address: deployment.contractAddress,
        constructorArguments: [
          deployment.tokenAddress,
          deployment.vrfCoordinator,
          BigInt(deployment.vrfSubscriptionId),
          deployment.keyHash,
          deployment.debug
        ]
      });

      console.log(`Verified ${deployment.contractName} at ${deployment.contractAddress}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already verified")) {
        console.log(`Already verified: ${deployment.contractAddress}`);
        return;
      }

      if (attempt < VERIFY_RETRY_ATTEMPTS && isRetryableVerificationError(message)) {
        console.warn(`Verification attempt ${attempt} failed, retrying in ${VERIFY_RETRY_DELAY_MS / 1000}s: ${message}`);
        await sleep(VERIFY_RETRY_DELAY_MS);
        continue;
      }

      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  console.error(`Verification input: ${path.resolve(process.argv[process.argv.length - 1] ?? "")}`);
  process.exitCode = 1;
});
