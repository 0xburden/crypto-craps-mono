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

  if (deployment.usesMocks) {
    throw new Error("Mock deployments cannot be verified on Basescan/Etherscan");
  }

  if (deployment.network !== network.name) {
    throw new Error(
      `Deployment artifact network mismatch: expected ${network.name}, received ${deployment.network}`
    );
  }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log(`Already verified: ${deployment.contractAddress}`);
      return;
    }

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  console.error(`Verification input: ${path.resolve(process.argv[process.argv.length - 1] ?? "")}`);
  process.exitCode = 1;
});
