import "dotenv/config";
import path from "node:path";
import { ethers, network } from "hardhat";
import { parseCliArgs, readJson, writeJson } from "./deployment-helpers";

type RawParams = {
  CrapsGameModule?: {
    tokenAddress?: string;
    vrfCoordinator?: string;
    subscriptionId?: string | number | bigint;
    keyHash?: string;
    initialBankrollAmount?: string | number | bigint;
  };
};

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
] as const;
const VRF_COORDINATOR_ABI = [
  "function addConsumer(uint256 subId, address consumer) external",
] as const;

function defaultParamsFile() {
  if (network.name === "baseSepolia") {
    return path.join("deployments", "generated", "sepolia-params.generated.json");
  }
  if (network.name === "base") {
    return path.join("deployments", "generated", "mainnet-params.generated.json");
  }
  return path.join("deployments", `${network.name}-params.generated.json`);
}

function defaultOutputFile() {
  if (network.name === "baseSepolia") {
    return path.join("deployments", "sepolia-deployment-v2.json");
  }
  if (network.name === "base") {
    return path.join("deployments", "mainnet-deployment-v2.json");
  }
  return path.join("deployments", `${network.name}-deployment-v2.json`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const paramsFile = args.params ?? process.env.CRAPS_V2_PARAMS_FILE ?? defaultParamsFile();
  const outFile = args.out ?? process.env.CRAPS_V2_EXPORT_OUT ?? defaultOutputFile();

  const raw = readJson<RawParams>(paramsFile);
  const params = raw.CrapsGameModule ?? raw;

  const tokenAddress = params.tokenAddress?.toString() ?? "";
  const vrfCoordinatorAddress = params.vrfCoordinator?.toString() ?? "";
  const subscriptionId = BigInt(params.subscriptionId?.toString() ?? "0");
  const keyHash = params.keyHash?.toString() ?? ZERO_HASH;
  const initialBankrollAmount = BigInt(params.initialBankrollAmount?.toString() ?? "0");

  if (!ethers.isAddress(tokenAddress)) {
    throw new Error(`Invalid tokenAddress in ${paramsFile}`);
  }
  if (!ethers.isAddress(vrfCoordinatorAddress)) {
    throw new Error(`Invalid vrfCoordinator in ${paramsFile}`);
  }
  if (subscriptionId === 0n) {
    throw new Error(`subscriptionId must be non-zero in ${paramsFile}`);
  }

  const [deployer] = await ethers.getSigners();
  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, deployer);
  const vrfCoordinator = new ethers.Contract(vrfCoordinatorAddress, VRF_COORDINATOR_ABI, deployer);

  const nativeBalance = await ethers.provider.getBalance(deployer.address);
  const tokenBalance = await token.balanceOf(deployer.address);
  const symbol = await token.symbol().catch(() => "TOKEN");
  const decimals = await token.decimals().catch(() => 6);

  console.log(`Deploying V2 with ${deployer.address} on ${network.name} (${chainId})`);
  console.log(`- native balance: ${ethers.formatEther(nativeBalance)} ETH`);
  console.log(`- token: ${tokenAddress} (${symbol}, decimals ${decimals})`);
  console.log(`- token balance: ${tokenBalance.toString()}`);
  console.log(`- coordinator: ${vrfCoordinatorAddress}`);
  console.log(`- subscriptionId: ${subscriptionId.toString()}`);
  console.log(`- keyHash: ${keyHash}`);
  console.log(`- initial bankroll: ${initialBankrollAmount.toString()}`);

  if (tokenBalance < initialBankrollAmount) {
    throw new Error(`Deployer token balance ${tokenBalance.toString()} is below initial bankroll ${initialBankrollAmount.toString()}`);
  }

  const pendingNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  let nextNonce = pendingNonce;
  const feeData = await ethers.provider.getFeeData();
  const feeOverrides = feeData.maxFeePerGas !== null && feeData.maxPriorityFeePerGas !== null
    ? {
        maxFeePerGas: (feeData.maxFeePerGas * 12n) / 10n,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * 12n) / 10n,
      }
    : {};

  const resolverFactory = await ethers.getContractFactory("RollResolutionV2");
  const resolver = await resolverFactory.deploy({ ...feeOverrides, nonce: nextNonce++ });
  await resolver.waitForDeployment();
  const resolverAddress = await resolver.getAddress();
  console.log(`- RollResolutionV2: ${resolverAddress}`);

  const gameFactory = await ethers.getContractFactory("CrapsGameV2", {
    libraries: {
      RollResolutionV2: resolverAddress,
    },
  });
  const game = await gameFactory.deploy(tokenAddress, vrfCoordinatorAddress, subscriptionId, keyHash, {
    ...feeOverrides,
    nonce: nextNonce++,
  });
  await game.waitForDeployment();
  const gameAddress = await game.getAddress();
  console.log(`- CrapsGameV2: ${gameAddress}`);

  const addConsumerTx = await vrfCoordinator.addConsumer(subscriptionId, gameAddress, {
    ...feeOverrides,
    nonce: nextNonce++,
  });
  await addConsumerTx.wait();
  console.log(`- addConsumer tx: ${addConsumerTx.hash}`);

  const approveTx = await token.approve(gameAddress, initialBankrollAmount, {
    ...feeOverrides,
    nonce: nextNonce++,
  });
  await approveTx.wait();
  console.log(`- approve tx: ${approveTx.hash}`);

  const fundTx = await game.connect(deployer).fundBankroll(initialBankrollAmount, {
    ...feeOverrides,
    nonce: nextNonce++,
  });
  await fundTx.wait();
  console.log(`- fundBankroll tx: ${fundTx.hash}`);

  const artifact = {
    contractName: "CrapsGameV2",
    contractAddress: gameAddress,
    rollResolutionLibrary: resolverAddress,
    network: network.name,
    chainId,
    deployer: deployer.address,
    tokenAddress,
    vrfCoordinator: vrfCoordinatorAddress,
    vrfSubscriptionId: subscriptionId.toString(),
    keyHash,
    initialBankrollAmount: initialBankrollAmount.toString(),
    paramsFile: path.resolve(paramsFile),
    generatedAt: new Date().toISOString(),
    transactions: {
      addConsumer: addConsumerTx.hash,
      approve: approveTx.hash,
      fundBankroll: fundTx.hash,
    },
  } as const;

  writeJson(outFile, artifact);
  console.log(`Wrote V2 deployment artifact to ${path.resolve(outFile)}`);
  console.log(`Set frontend env: VITE_BASE_SEPOLIA_GAME_ADDRESS_V2=${gameAddress}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
