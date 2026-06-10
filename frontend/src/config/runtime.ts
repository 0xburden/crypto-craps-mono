export interface RuntimeConfig {
  baseSepoliaGameAddressV3?: string;
  baseSepoliaGameAddressV2?: string;
  baseSepoliaGameAddress?: string;
  baseMainnetGameAddressV3?: string;
  baseMainnetGameAddressV2?: string;
  baseMainnetGameAddress?: string;
  baseSepoliaTokenAddress?: string;
  baseMainnetTokenAddress?: string;
  baseSepoliaRpcUrl?: string;
  baseMainnetRpcUrl?: string;
  walletConnectProjectId?: string;
  defaultChainId?: number | string;
}

declare global {
  interface Window {
    __CRAPS_CONFIG__?: RuntimeConfig;
  }
}

export const runtimeConfig: RuntimeConfig =
  typeof window === 'undefined' ? {} : window.__CRAPS_CONFIG__ ?? {};

export const runtimeValue = (key: keyof RuntimeConfig) => {
  const value = runtimeConfig[key];

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

export const runtimeChainId = () => {
  const value = runtimeValue('defaultChainId');
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

export const firstRuntimeValue = (...values: Array<string | undefined>) =>
  values.find((value) => typeof value === 'string' && value.trim().length > 0);
