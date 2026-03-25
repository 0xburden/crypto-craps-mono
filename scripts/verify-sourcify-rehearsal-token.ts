import path from "node:path";
import { network, run } from "hardhat";
import { parseCliArgs, readJson } from "./deployment-helpers";

interface RehearsalTokenArtifact {
  contractName: "MockERC20";
  tokenAddress: string;
  network: string;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const artifactPath = args.deployment
    ?? process.env.CRAPS_VERIFY_REHEARSAL_TOKEN
    ?? path.join("deployments", `${network.name}-rehearsal-token.json`);
  const artifact = readJson<RehearsalTokenArtifact>(artifactPath);

  if (artifact.network !== network.name) {
    throw new Error(`Rehearsal token artifact network mismatch: expected ${network.name}, received ${artifact.network}`);
  }

  await run("verify:sourcify", {
    address: artifact.tokenAddress,
    contract: "contracts/mocks/MockERC20.sol:MockERC20"
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
