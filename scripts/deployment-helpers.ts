import fs from "node:fs";
import path from "node:path";

export const CRAPS_GAME_MODULE_ID = "CrapsGameModule";
export const CRAPS_GAME_FUTURE_KEY = `${CRAPS_GAME_MODULE_ID}#CrapsGame`;
export const DEFAULT_INITIAL_BANKROLL_AMOUNT = "50000000000";
export const DEFAULT_KEY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface CrapsGameModuleParams {
  tokenAddress?: string;
  vrfCoordinator?: string;
  linkToken?: string;
  subscriptionId?: string | number | bigint;
  keyHash?: string;
  tokenDecimals?: number;
  initialBankrollAmount?: string | number | bigint;
  debug?: boolean;
}

export interface CrapsGameDeploymentArtifact {
  contractName: "CrapsGame";
  contractAddress: string;
  network: string;
  chainId: number;
  deploymentId: string;
  moduleId: typeof CRAPS_GAME_MODULE_ID;
  tokenAddress: string;
  vrfCoordinator: string;
  linkToken?: string;
  vrfSubscriptionId: string;
  keyHash: string;
  tokenDecimals: number;
  initialBankrollAmount: string;
  debug: boolean;
  usesMocks: boolean;
  generatedAt: string;
  paramsFile?: string;
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8")) as T;
}

export function writeJson(filePath: string, value: unknown) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function getDefaultDeploymentArtifactPath(networkName: string): string {
  switch (networkName) {
    case "baseSepolia":
      return path.join("deployments", "sepolia-deployment.json");
    case "base":
      return path.join("deployments", "mainnet-deployment.json");
    default:
      return path.join("deployments", `${networkName}-deployment.json`);
  }
}

export function getDefaultDeploymentId(chainId: bigint | number | string): string {
  return `chain-${chainId.toString()}`;
}

export function findDeploymentAddress(
  deployedAddresses: Record<string, string>,
  expectedKey: string,
  suffix: string
): string {
  if (deployedAddresses[expectedKey] !== undefined) {
    return deployedAddresses[expectedKey];
  }

  const matches = Object.entries(deployedAddresses).filter(([key]) => key.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(`Could not uniquely resolve deployment address for ${suffix}`);
  }

  return matches[0][1];
}

export function normalizeModuleParams(raw: unknown): CrapsGameModuleParams {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Deployment parameters JSON must be an object");
  }

  const params = (raw as Record<string, unknown>)[CRAPS_GAME_MODULE_ID] ?? raw;
  if (params === null || typeof params !== "object") {
    throw new Error(`Deployment parameters for ${CRAPS_GAME_MODULE_ID} must be an object`);
  }

  return params as CrapsGameModuleParams;
}

export function toStringValue(value: string | number | bigint | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }

  return value.toString();
}

export function parseCliArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}
