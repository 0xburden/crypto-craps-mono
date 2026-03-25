import path from "node:path";
import { ethers, network } from "hardhat";
import { CrapsGameDeploymentArtifact, parseCliArgs, readJson } from "./deployment-helpers";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConsumer(
  coordinator: Awaited<ReturnType<typeof ethers.getContractAt>>,
  subscriptionId: bigint,
  consumerAddress: string
): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await coordinator.getSubscription(subscriptionId);
    const consumers = snapshot[4] as string[];
    if (consumers.some((consumer) => consumer.toLowerCase() === consumerAddress.toLowerCase())) {
      return true;
    }

    await sleep(3_000);
  }

  return false;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const deploymentPath = args.deployment
    ?? process.env.CRAPS_ADD_CONSUMER_DEPLOYMENT
    ?? path.join("deployments", "sepolia-deployment.json");
  const deployment = readJson<CrapsGameDeploymentArtifact>(deploymentPath);

  if (deployment.network !== network.name) {
    throw new Error(`Deployment artifact network mismatch: expected ${network.name}, received ${deployment.network}`);
  }

  const [signer] = await ethers.getSigners();
  if (signer === undefined) {
    throw new Error("No signer available. Set DEPLOYER_PRIVATE_KEY before adding the consumer.");
  }

  const coordinator = await ethers.getContractAt(
    [
      "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)",
      "function addConsumer(uint256 subId, address consumer) external"
    ],
    deployment.vrfCoordinator,
    signer
  );

  const subscriptionId = BigInt(deployment.vrfSubscriptionId);
  const before = await coordinator.getSubscription(subscriptionId);
  const owner = before[3] as string;
  const consumers = before[4] as string[];
  const signerAddress = await signer.getAddress();

  if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(
      `Subscription owner mismatch: signer ${signerAddress}, subscription owner ${owner}. Cannot add consumer automatically.`
    );
  }

  if (consumers.some((consumer) => consumer.toLowerCase() === deployment.contractAddress.toLowerCase())) {
    console.log(`Consumer already registered for subscription ${subscriptionId.toString()}: ${deployment.contractAddress}`);
    return;
  }

  const receipt = await (await coordinator.addConsumer(subscriptionId, deployment.contractAddress)).wait();
  const found = await waitForConsumer(coordinator, subscriptionId, deployment.contractAddress);

  if (!found) {
    throw new Error(`Consumer registration transaction succeeded but ${deployment.contractAddress} was not found in the consumer list after waiting`);
  }

  console.log(`Added consumer ${deployment.contractAddress} to subscription ${subscriptionId.toString()}`);
  console.log(`Transaction hash: ${receipt?.hash ?? "unknown"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
