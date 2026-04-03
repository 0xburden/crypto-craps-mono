import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { NETWORK_CONFIG } from './contracts';

const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'demo';

export const wagmiConfig = getDefaultConfig({
  appName: 'Crypto Craps',
  projectId: walletConnectProjectId,
  chains: [baseSepolia, base],
  transports: {
    [baseSepolia.id]: http(NETWORK_CONFIG[baseSepolia.id].rpcUrl),
    [base.id]: http(NETWORK_CONFIG[base.id].rpcUrl),
  },
  ssr: false,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
