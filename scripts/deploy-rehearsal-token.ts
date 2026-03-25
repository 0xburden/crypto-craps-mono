import "dotenv/config";
import path from "node:path";
import { ethers, network } from "hardhat";
import { parseCliArgs, writeJson } from "./deployment-helpers";

interface RehearsalTokenArtifact {
  contractName: "MockERC20";
  tokenAddress: string;
  network: string;
  chainId: number;
  deployer: string;
  name: string;
  symbol: string;
  decimals: number;
  generatedAt: string;
}

const KNOWN_DECIMALS = 6;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCode(address: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = await ethers.provider.getCode(address);
    if (code !== "0x") {
      return;
    }

    await sleep(3_000);
  }

  throw new Error(`Timed out waiting for deployed code at ${address}`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const outputFile = args.out
    ?? process.env.CRAPS_REHEARSAL_TOKEN_OUT
    ?? path.join("deployments", `${network.name}-rehearsal-token.json`);
  const tokenName = args.name ?? process.env.SEPOLIA_REHEARSAL_TOKEN_NAME ?? "Sepolia Rehearsal USD";
  const tokenSymbol = args.symbol ?? process.env.SEPOLIA_REHEARSAL_TOKEN_SYMBOL ?? "srUSDC";

  const [signer] = await ethers.getSigners();
  if (signer === undefined) {
    throw new Error("No signer available. Set DEPLOYER_PRIVATE_KEY before deploying the rehearsal token.");
  }

  const factory = await ethers.getContractFactory("MockERC20", signer);
  const token = await factory.deploy(tokenName, tokenSymbol);
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  await waitForCode(tokenAddress);

  const providerNetwork = await ethers.provider.getNetwork();
  const artifact: RehearsalTokenArtifact = {
    contractName: "MockERC20",
    tokenAddress,
    network: network.name,
    chainId: Number(providerNetwork.chainId),
    deployer: await signer.getAddress(),
    name: tokenName,
    symbol: tokenSymbol,
    decimals: KNOWN_DECIMALS,
    generatedAt: new Date().toISOString()
  };

  writeJson(outputFile, artifact);

  console.log(`Deployed rehearsal token at ${tokenAddress}`);
  console.log(`Artifact written to ${path.resolve(outputFile)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
