import { getAddress, isAddress } from 'viem';
import { base, baseSepolia } from 'viem/chains';

const parseOptionalAddress = (value: string | undefined) => {
  if (!value || !isAddress(value)) {
    return undefined;
  }

  return getAddress(value);
};

export const DEFAULT_CHAIN_ID = baseSepolia.id;
export const SESSION_TIMEOUT_SECONDS = 24 * 60 * 60;
export const SELF_EXCLUSION_DELAY_SECONDS = 7 * 24 * 60 * 60;
export const DEPOSIT_FEE_BPS = 50;

export const NETWORK_CONFIG = {
  [baseSepolia.id]: {
    chainId: baseSepolia.id,
    label: 'BASE Sepolia',
    gameAddress: parseOptionalAddress(
      import.meta.env.VITE_BASE_SEPOLIA_GAME_ADDRESS ?? '0x6cBA1d9071c6900fE55a0aBf93dAaD363Da8919A',
    ),
    tokenAddress: parseOptionalAddress(
      import.meta.env.VITE_BASE_SEPOLIA_TOKEN_ADDRESS ?? '0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA',
    ),
    rpcUrl: import.meta.env.VITE_BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  [base.id]: {
    chainId: base.id,
    label: 'BASE Mainnet',
    gameAddress: parseOptionalAddress(import.meta.env.VITE_BASE_MAINNET_GAME_ADDRESS),
    tokenAddress: parseOptionalAddress(
      import.meta.env.VITE_BASE_MAINNET_TOKEN_ADDRESS ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    ),
    rpcUrl: import.meta.env.VITE_BASE_MAINNET_RPC_URL ?? 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
  },
} as const;

export type SupportedChainId = keyof typeof NETWORK_CONFIG;
