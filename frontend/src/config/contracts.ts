import { getAddress, isAddress } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { runtimeChainId, runtimeValue } from './runtime';

const parseOptionalAddress = (value: string | undefined) => {
  if (!value || !isAddress(value)) {
    return undefined;
  }

  return getAddress(value);
};

const TOKEN_DECIMALS = 1_000_000n;

const configuredDefaultChainId = runtimeChainId() ?? Number(import.meta.env.VITE_DEFAULT_CHAIN_ID ?? baseSepolia.id);

export const DEFAULT_CHAIN_ID = configuredDefaultChainId === base.id ? base.id : baseSepolia.id;
export const SESSION_TIMEOUT_SECONDS = 24 * 60 * 60;
export const SELF_EXCLUSION_DELAY_SECONDS = 7 * 24 * 60 * 60;
export const DEPOSIT_FEE_BPS = 50;
export const SRUSDC_FAUCET_MAX_REQUEST_AMOUNT = 1_000n * TOKEN_DECIMALS;

export const NETWORK_CONFIG = {
  [baseSepolia.id]: {
    chainId: baseSepolia.id,
    label: 'BASE Sepolia',
    gameAddress: parseOptionalAddress(
      runtimeValue('baseSepoliaGameAddressV3') ??
        import.meta.env.VITE_BASE_SEPOLIA_GAME_ADDRESS_V3 ??
        runtimeValue('baseSepoliaGameAddressV2') ??
        import.meta.env.VITE_BASE_SEPOLIA_GAME_ADDRESS_V2 ??
        runtimeValue('baseSepoliaGameAddress') ??
        import.meta.env.VITE_BASE_SEPOLIA_GAME_ADDRESS ??
        '0xf031019A2A1DcEee8dAc3a7B9bf3066ced493292',
    ),
    tokenAddress: parseOptionalAddress(
      runtimeValue('baseSepoliaTokenAddress') ??
        import.meta.env.VITE_BASE_SEPOLIA_TOKEN_ADDRESS ??
        '0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA',
    ),
    rpcUrl: runtimeValue('baseSepoliaRpcUrl') ?? import.meta.env.VITE_BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    supportsFaucet: true,
    faucetMaxRequestAmount: SRUSDC_FAUCET_MAX_REQUEST_AMOUNT,
  },
  [base.id]: {
    chainId: base.id,
    label: 'BASE Mainnet',
    gameAddress: parseOptionalAddress(
      runtimeValue('baseMainnetGameAddressV3') ??
        import.meta.env.VITE_BASE_MAINNET_GAME_ADDRESS_V3 ??
        runtimeValue('baseMainnetGameAddressV2') ??
        import.meta.env.VITE_BASE_MAINNET_GAME_ADDRESS_V2 ??
        runtimeValue('baseMainnetGameAddress') ??
        import.meta.env.VITE_BASE_MAINNET_GAME_ADDRESS,
    ),
    tokenAddress: parseOptionalAddress(
      runtimeValue('baseMainnetTokenAddress') ??
        import.meta.env.VITE_BASE_MAINNET_TOKEN_ADDRESS ??
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    ),
    rpcUrl: runtimeValue('baseMainnetRpcUrl') ?? import.meta.env.VITE_BASE_MAINNET_RPC_URL ?? 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    supportsFaucet: false,
    faucetMaxRequestAmount: 0n,
  },
} as const;

export type SupportedChainId = keyof typeof NETWORK_CONFIG;
