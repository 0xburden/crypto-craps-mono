import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Abi, Address, Hex } from 'viem';
import { maxUint256 } from 'viem';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import crapsGameAbiJson from '../abi/CrapsGame.json';
import { DEFAULT_CHAIN_ID, NETWORK_CONFIG } from '../config/contracts';
import {
  BET_TYPES,
  SESSION_PHASE,
  type BetTypeId,
  type NormalizedPlayerState,
  type RollHistoryEntry,
} from '../lib/craps';
import { erc20Abi } from '../lib/erc20Abi';

const crapsGameAbi = crapsGameAbiJson as Abi;

const EMPTY_BETS = {
  passLine: { amount: 0n, oddsAmount: 0n, point: 0 },
  dontPass: { amount: 0n, oddsAmount: 0n, point: 0 },
  come: Array.from({ length: 4 }, () => ({ amount: 0n, oddsAmount: 0n, point: 0 })),
  dontCome: Array.from({ length: 4 }, () => ({ amount: 0n, oddsAmount: 0n, point: 0 })),
  place4: { amount: 0n, working: false },
  place5: { amount: 0n, working: false },
  place6: { amount: 0n, working: false },
  place8: { amount: 0n, working: false },
  place9: { amount: 0n, working: false },
  place10: { amount: 0n, working: false },
  hard4: { amount: 0n },
  hard6: { amount: 0n },
  hard8: { amount: 0n },
  hard10: { amount: 0n },
  oneRolls: {
    field: 0n,
    any7: 0n,
    anyCraps: 0n,
    craps2: 0n,
    craps3: 0n,
    yo: 0n,
    twelve: 0n,
    horn: 0n,
  },
};

const EMPTY_PLAYER_STATE: NormalizedPlayerState = {
  phase: SESSION_PHASE.INACTIVE,
  puckState: 0,
  point: 0,
  lastActivityTime: 0,
  pendingRequestId: 0n,
  available: 0n,
  inPlay: 0n,
  reserved: 0n,
  bankroll: 0n,
  totalBankroll: 0n,
  initialBankroll: 0n,
  accruedFees: 0n,
  paused: false,
  selfExcluded: false,
  operatorExcluded: false,
  reinstatementEligibleAt: 0n,
  bets: EMPTY_BETS,
};

const normalizePlayerState = (raw: any): NormalizedPlayerState => ({
  phase: Number(raw?.phase ?? SESSION_PHASE.INACTIVE),
  puckState: Number(raw?.puckState ?? 0),
  point: Number(raw?.point ?? 0),
  lastActivityTime: Number(raw?.lastActivityTime ?? 0),
  pendingRequestId: BigInt(raw?.pendingRequestId ?? 0),
  available: BigInt(raw?.available ?? 0),
  inPlay: BigInt(raw?.inPlay ?? 0),
  reserved: BigInt(raw?.reserved ?? 0),
  bankroll: BigInt(raw?.bankroll ?? 0),
  totalBankroll: BigInt(raw?.totalBankroll ?? 0),
  initialBankroll: BigInt(raw?.initialBankroll ?? 0),
  accruedFees: BigInt(raw?.accruedFees ?? 0),
  paused: Boolean(raw?.paused),
  selfExcluded: Boolean(raw?.selfExcluded),
  operatorExcluded: Boolean(raw?.operatorExcluded),
  reinstatementEligibleAt: BigInt(raw?.reinstatementEligibleAt ?? 0),
  bets: raw?.bets ?? EMPTY_BETS,
});

const mapContractError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (/User rejected|User denied|rejected the request/i.test(message)) {
    return 'Transaction cancelled.';
  }
  if (/PlayerExcluded/i.test(message)) {
    return 'Your account is currently excluded from play.';
  }
  if (/InsufficientBankroll/i.test(message)) {
    return 'Table is at capacity. Try again shortly.';
  }
  if (/InsufficientBalance/i.test(message)) {
    return 'Not enough balance for this action.';
  }
  if (/SessionAlreadyActive/i.test(message)) {
    return 'You already have an active session.';
  }
  if (/SessionNotActive/i.test(message)) {
    return 'Open a session to continue.';
  }
  if (/SessionRollPending/i.test(message)) {
    return 'A roll is already pending.';
  }
  if (/BetUnavailable/i.test(message)) {
    return "That bet isn't available right now.";
  }
  if (/InvalidMultiple/i.test(message)) {
    return 'That amount does not satisfy the required increment.';
  }
  if (/InvalidAmount|ZeroAmount/i.test(message)) {
    return 'Enter a valid amount.';
  }
  if (/NotEligibleForReinstatement/i.test(message)) {
    return 'Reinstatement is not available yet.';
  }
  if (/Connector not found|switch network/i.test(message)) {
    return 'Please connect or switch to a supported BASE network.';
  }

  return 'Transaction failed. Please retry.';
};

export interface UseCrapsGameResult {
  account?: Address;
  chainId: number;
  isConnected: boolean;
  isSupportedChain: boolean;
  wrongNetwork: boolean;
  needsMainnetDeployment: boolean;
  networkLabel: string;
  contractAddress?: Address;
  tokenAddress?: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  walletTokenBalance: bigint;
  allowance: bigint;
  playerState: NormalizedPlayerState | null;
  rollHistory: RollHistoryEntry[];
  lastResolvedRoll: RollHistoryEntry | null;
  refresh: () => Promise<void>;
  isRolling: boolean;
  isBusy: boolean;
  txLabel?: string;
  txHash?: Hex;
  error?: string;
  clearError: () => void;
  switchToBaseSepolia: () => Promise<void>;
  deposit: (amount: bigint) => Promise<void>;
  withdraw: (amount: bigint) => Promise<void>;
  approveMax: () => Promise<void>;
  openSession: () => Promise<void>;
  closeSession: () => Promise<void>;
  placeBet: (betType: BetTypeId, amount: bigint) => Promise<void>;
  placeIndexedBet: (betType: BetTypeId, index: number, amount: bigint) => Promise<void>;
  removeBet: (betType: BetTypeId) => Promise<void>;
  removeIndexedBet: (betType: BetTypeId, index: number) => Promise<void>;
  setPlaceWorking: (placeNumber: number, working: boolean) => Promise<void>;
  rollDice: () => Promise<void>;
  selfExclude: () => Promise<void>;
  requestSelfReinstatement: () => Promise<void>;
  completeSelfReinstatement: () => Promise<void>;
}

export const useCrapsGame = (): UseCrapsGameResult => {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const activeChainId = NETWORK_CONFIG[walletChainId as keyof typeof NETWORK_CONFIG]
    ? walletChainId
    : DEFAULT_CHAIN_ID;
  const network = NETWORK_CONFIG[activeChainId as keyof typeof NETWORK_CONFIG];
  const contractAddress = network.gameAddress;
  const tokenAddress = network.tokenAddress;
  const publicClient = usePublicClient({ chainId: activeChainId });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [rollHistory, setRollHistory] = useState<RollHistoryEntry[]>([]);
  const [lastResolvedRoll, setLastResolvedRoll] = useState<RollHistoryEntry | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [txState, setTxState] = useState<{
    busy: boolean;
    label?: string;
    hash?: Hex;
    error?: string;
  }>({ busy: false });

  const playerStateQuery = useReadContract({
    address: contractAddress,
    abi: crapsGameAbi,
    functionName: 'getPlayerState',
    args: address && contractAddress ? [address] : undefined,
    query: {
      enabled: Boolean(address && contractAddress),
    },
  });

  const walletBalanceQuery = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address && tokenAddress ? [address] : undefined,
    query: {
      enabled: Boolean(address && tokenAddress),
    },
  });

  const allowanceQuery = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && tokenAddress && contractAddress ? [address, contractAddress] : undefined,
    query: {
      enabled: Boolean(address && tokenAddress && contractAddress),
    },
  });

  const symbolQuery = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'symbol',
    query: {
      enabled: Boolean(tokenAddress),
    },
  });

  const decimalsQuery = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
    query: {
      enabled: Boolean(tokenAddress),
    },
  });

  const playerState = useMemo(() => {
    if (!address || !playerStateQuery.data) {
      return null;
    }

    return normalizePlayerState(playerStateQuery.data);
  }, [address, playerStateQuery.data]);

  const refresh = useCallback(async () => {
    await Promise.allSettled([
      playerStateQuery.refetch(),
      walletBalanceQuery.refetch(),
      allowanceQuery.refetch(),
      symbolQuery.refetch(),
      decimalsQuery.refetch(),
    ]);
  }, [allowanceQuery, decimalsQuery, playerStateQuery, symbolQuery, walletBalanceQuery]);

  const runWrite = useCallback(
    async (label: string, writer: () => Promise<Hex>) => {
      setTxState({ busy: true, label });
      try {
        const hash = await writer();
        setTxState({ busy: true, label, hash });

        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        }

        await refresh();
        setTxState({ busy: false, label, hash });
      } catch (error) {
        setTxState({ busy: false, label, error: mapContractError(error) });
        throw error;
      }
    },
    [publicClient, refresh],
  );

  const writeGame = useCallback(
    async (label: string, functionName: string, args: readonly unknown[] = []) => {
      if (!contractAddress) {
        throw new Error('Missing game contract configuration.');
      }

      await runWrite(label, () =>
        writeContractAsync({
          address: contractAddress,
          abi: crapsGameAbi,
          functionName: functionName as never,
          args: args as never,
        }),
      );
    },
    [contractAddress, runWrite, writeContractAsync],
  );

  const approveMax = useCallback(async () => {
    if (!tokenAddress || !contractAddress) {
      throw new Error('Missing token or game contract configuration.');
    }

    await runWrite('Approve token', () =>
      writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contractAddress, maxUint256],
      }),
    );
  }, [contractAddress, runWrite, tokenAddress, writeContractAsync]);

  const deposit = useCallback(
    async (amount: bigint) => {
      const allowance = (allowanceQuery.data as bigint | undefined) ?? 0n;
      if (allowance < amount) {
        await approveMax();
      }
      await writeGame('Deposit', 'deposit', [amount]);
    },
    [allowanceQuery.data, approveMax, writeGame],
  );

  const withdraw = useCallback((amount: bigint) => writeGame('Withdraw', 'withdraw', [amount]), [writeGame]);
  const openSession = useCallback(() => writeGame('Open session', 'openSession'), [writeGame]);
  const closeSession = useCallback(() => writeGame('Close session', 'closeSession'), [writeGame]);
  const rollDice = useCallback(async () => {
    setIsRolling(true);
    try {
      await writeGame('Roll dice', 'rollDice');
    } catch (error) {
      setIsRolling(false);
      throw error;
    }
  }, [writeGame]);
  const selfExclude = useCallback(() => writeGame('Self-exclude', 'selfExclude'), [writeGame]);
  const requestSelfReinstatement = useCallback(
    () => writeGame('Request reinstatement', 'requestSelfReinstatement'),
    [writeGame],
  );
  const completeSelfReinstatement = useCallback(
    () => writeGame('Complete reinstatement', 'completeSelfReinstatement'),
    [writeGame],
  );

  const placeBet = useCallback(
    (betType: BetTypeId, amount: bigint) => writeGame('Place bet', 'placeBet', [betType, amount]),
    [writeGame],
  );
  const placeIndexedBet = useCallback(
    (betType: BetTypeId, index: number, amount: bigint) =>
      writeGame('Place indexed bet', 'placeIndexedBet', [betType, index, amount]),
    [writeGame],
  );
  const removeBet = useCallback(
    (betType: BetTypeId) => writeGame('Remove bet', 'removeBet', [betType]),
    [writeGame],
  );
  const removeIndexedBet = useCallback(
    (betType: BetTypeId, index: number) => writeGame('Remove indexed bet', 'removeIndexedBet', [betType, index]),
    [writeGame],
  );
  const setPlaceWorking = useCallback(
    (placeNumber: number, working: boolean) =>
      writeGame(working ? 'Turn place bet on' : 'Turn place bet off', 'setPlaceWorking', [placeNumber, working]),
    [writeGame],
  );

  useEffect(() => {
    if (!publicClient || !contractAddress || !address) {
      return;
    }

    const unwatch = publicClient.watchContractEvent({
      address: contractAddress,
      abi: crapsGameAbi,
      poll: true,
      pollingInterval: 4_000,
      onLogs: (logs) => {
        let shouldRefresh = false;

        logs.forEach((log: any) => {
          const player = log.args?.player as Address | undefined;
          if (!player || player.toLowerCase() !== address.toLowerCase()) {
            return;
          }

          shouldRefresh = true;

          if (log.eventName === 'RollRequested') {
            setIsRolling(true);
          }

          if (log.eventName === 'RollResolved') {
            const entry: RollHistoryEntry = {
              id: `${String(log.args?.requestId ?? 0)}-${String(log.blockNumber ?? Date.now())}`,
              requestId: BigInt(log.args?.requestId ?? 0),
              die1: Number(log.args?.die1 ?? 0),
              die2: Number(log.args?.die2 ?? 0),
              payout: BigInt(log.args?.payout ?? 0),
              at: Date.now(),
            };

            setLastResolvedRoll(entry);
            setRollHistory((previous) => [entry, ...previous].slice(0, 20));
            setIsRolling(false);
          }

          if (log.eventName === 'SessionExpired') {
            setIsRolling(false);
          }
        });

        if (shouldRefresh) {
          void refresh();
        }
      },
    });

    return () => unwatch();
  }, [address, contractAddress, publicClient, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!address || !contractAddress) {
        return;
      }

      void refresh();
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [address, contractAddress, refresh]);

  useEffect(() => {
    if (!playerState) {
      return;
    }

    if (playerState.phase === SESSION_PHASE.INACTIVE) {
      setRollHistory([]);
      setLastResolvedRoll(null);
      setIsRolling(false);
    }

    if (playerState.phase !== SESSION_PHASE.ROLL_PENDING) {
      setIsRolling(false);
    }
  }, [playerState]);

  const switchToBaseSepolia = useCallback(async () => {
    await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
  }, [switchChainAsync]);

  return {
    account: address,
    chainId: activeChainId,
    isConnected,
    isSupportedChain: Boolean(NETWORK_CONFIG[walletChainId as keyof typeof NETWORK_CONFIG]),
    wrongNetwork: Boolean(isConnected && !NETWORK_CONFIG[walletChainId as keyof typeof NETWORK_CONFIG]),
    needsMainnetDeployment: Boolean(activeChainId !== DEFAULT_CHAIN_ID && !contractAddress),
    networkLabel: network.label,
    contractAddress,
    tokenAddress,
    tokenSymbol: (symbolQuery.data as string | undefined) ?? 'USDC',
    tokenDecimals: Number(decimalsQuery.data ?? 6),
    walletTokenBalance: (walletBalanceQuery.data as bigint | undefined) ?? 0n,
    allowance: (allowanceQuery.data as bigint | undefined) ?? 0n,
    playerState,
    rollHistory,
    lastResolvedRoll,
    refresh,
    isRolling: isRolling || playerState?.phase === SESSION_PHASE.ROLL_PENDING,
    isBusy:
      txState.busy ||
      playerStateQuery.isFetching ||
      walletBalanceQuery.isFetching ||
      allowanceQuery.isFetching,
    txLabel: txState.label,
    txHash: txState.hash,
    error: txState.error,
    clearError: () => setTxState((previous) => ({ ...previous, error: undefined })),
    switchToBaseSepolia,
    deposit,
    withdraw,
    approveMax,
    openSession,
    closeSession,
    placeBet,
    placeIndexedBet,
    removeBet,
    removeIndexedBet,
    setPlaceWorking,
    rollDice,
    selfExclude,
    requestSelfReinstatement,
    completeSelfReinstatement,
  };
};

export const getPlaceToggleMeta = (betType: BetTypeId) => {
  switch (betType) {
    case BET_TYPES.PLACE_4:
      return { key: 'place4', number: 4 };
    case BET_TYPES.PLACE_5:
      return { key: 'place5', number: 5 };
    case BET_TYPES.PLACE_6:
      return { key: 'place6', number: 6 };
    case BET_TYPES.PLACE_8:
      return { key: 'place8', number: 8 };
    case BET_TYPES.PLACE_9:
      return { key: 'place9', number: 9 };
    case BET_TYPES.PLACE_10:
      return { key: 'place10', number: 10 };
    default:
      return null;
  }
};
