import path from "node:path";
import { network, run } from "hardhat";
import { parseCliArgs, readJson } from "./deployment-helpers";

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

interface RehearsalTokenArtifact {
  contractName: "MockERC20";
  tokenAddress: string;
  network: string;
  name: string;
  symbol: string;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const artifactPath = args.deployment
    ?? process.env.CRAPS_VERIFY_REHEARSAL_TOKEN
    ?? path.join("deployments", `${network.name}-rehearsal-token.json`);
  const artifact = readJson<RehearsalTokenArtifact>(artifactPath);

  if (artifact.network !== network.name) {
    throw new Error(
      `Rehearsal token artifact network mismatch: expected ${network.name}, received ${artifact.network}`
    );
  }

  for (let attempt = 1; attempt <= VERIFY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await run("verify:verify", {
        address: artifact.tokenAddress,
        constructorArguments: [artifact.name, artifact.symbol]
      });

      console.log(`Verified ${artifact.contractName} at ${artifact.tokenAddress}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already verified")) {
        console.log(`Already verified: ${artifact.tokenAddress}`);
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
