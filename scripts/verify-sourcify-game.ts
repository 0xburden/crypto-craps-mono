import path from "node:path";
import { network, run } from "hardhat";
import {
  CrapsGameDeploymentArtifact,
  getDefaultDeploymentArtifactPath,
  parseCliArgs,
  readJson
} from "./deployment-helpers";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const deploymentPath = args.deployment ?? process.env.CRAPS_VERIFY_DEPLOYMENT ?? getDefaultDeploymentArtifactPath(network.name);
  const deployment = readJson<CrapsGameDeploymentArtifact>(deploymentPath);

  if (deployment.network !== network.name) {
    throw new Error(`Deployment artifact network mismatch: expected ${network.name}, received ${deployment.network}`);
  }

  await run("verify:sourcify", {
    address: deployment.contractAddress,
    contract: "contracts/CrapsGame.sol:CrapsGame"
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Verification input: ${path.resolve(process.argv[process.argv.length - 1] ?? "")}`);
  process.exitCode = 1;
});
