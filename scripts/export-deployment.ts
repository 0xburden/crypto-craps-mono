import path from "node:path";
import { ethers, network } from "hardhat";
import {
  CRAPS_GAME_FUTURE_KEY,
  CRAPS_GAME_MODULE_ID,
  DEFAULT_INITIAL_BANKROLL_AMOUNT,
  DEFAULT_KEY_HASH,
  findDeploymentAddress,
  getDefaultDeploymentArtifactPath,
  getDefaultDeploymentId,
  normalizeModuleParams,
  parseCliArgs,
  readJson,
  toStringValue,
  writeJson
} from "./deployment-helpers";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);
  const deploymentId = args["deployment-id"] ?? process.env.CRAPS_DEPLOYMENT_ID ?? getDefaultDeploymentId(chainId);
  const paramsFile = args.params ?? process.env.CRAPS_EXPORT_PARAMS;
  const outputFile = args.out ?? process.env.CRAPS_EXPORT_OUT ?? getDefaultDeploymentArtifactPath(network.name);
  const deployedAddressesPath = path.join("ignition", "deployments", deploymentId, "deployed_addresses.json");
  const deployedAddresses = readJson<Record<string, string>>(deployedAddressesPath);
  const contractAddress = findDeploymentAddress(deployedAddresses, CRAPS_GAME_FUTURE_KEY, "#CrapsGame");

  const params = paramsFile !== undefined
    ? normalizeModuleParams(readJson<Record<string, unknown>>(paramsFile))
    : undefined;

  const usesMocks = paramsFile === undefined;
  const tokenAddress = params?.tokenAddress
    ?? deployedAddresses[`${CRAPS_GAME_MODULE_ID}#MockUSDC`]
    ?? deployedAddresses[`${CRAPS_GAME_MODULE_ID}#ConfiguredToken`];
  const vrfCoordinator = params?.vrfCoordinator
    ?? deployedAddresses[`${CRAPS_GAME_MODULE_ID}#MockVRFCoordinator`]
    ?? deployedAddresses[`${CRAPS_GAME_MODULE_ID}#ConfiguredCoordinator`];

  if (tokenAddress === undefined || vrfCoordinator === undefined) {
    throw new Error("Unable to resolve token/coordinator addresses for deployment artifact");
  }

  const artifact = {
    contractName: "CrapsGame",
    contractAddress,
    network: network.name,
    chainId,
    deploymentId,
    moduleId: CRAPS_GAME_MODULE_ID,
    tokenAddress,
    vrfCoordinator,
    linkToken: params?.linkToken,
    vrfSubscriptionId: toStringValue(params?.subscriptionId, "1"),
    keyHash: params?.keyHash ?? DEFAULT_KEY_HASH,
    tokenDecimals: params?.tokenDecimals ?? 6,
    initialBankrollAmount: toStringValue(params?.initialBankrollAmount, DEFAULT_INITIAL_BANKROLL_AMOUNT),
    debug: params?.debug ?? true,
    usesMocks,
    generatedAt: new Date().toISOString(),
    paramsFile: paramsFile !== undefined ? path.resolve(paramsFile) : undefined
  } as const;

  writeJson(outputFile, artifact);
  console.log(`Wrote deployment artifact to ${path.resolve(outputFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
