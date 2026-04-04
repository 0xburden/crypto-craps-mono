import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Abi, Address, Hex } from 'viem';
import { decodeEventLog, maxUint256, parseAbiItem } from 'viem';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract,
} from 'wagmi';
import { crapsGameV2Abi } from '../abi/crapsGameV2Abi';
import { srUsdcAbi } from '../abi/srUsdcAbi';
import { DEFAULT_CHAIN_ID, NETWORK_CONFIG } from '../config/contracts';
import {
  BET_TYPES,
  SESSION_PHASE,
  getLayToggleMeta,
  getPlaceToggleMeta,
  type BetTypeId,
  type NormalizedPlayerState,
  type RollHistoryEntry,
  type TurnAction,
  type TurnActionKind,
} from '../lib/craps';
import { erc20Abi } from '../lib/erc20Abi';

const crapsGameAbi = crapsGameV2Abi as Abi;
const rollRequestedEvent = parseAbiItem(
  'event RollRequested(address indexed player, uint256 indexed requestId, uint256 reservedAmount)'
);
const rollResolvedEvent = parseAbiItem(
  'event RollResolved(address indexed player, uint256 indexed requestId, uint8 die1, uint8 die2, uint256 payout)'
);
const LOG_BLOCK_CHUNK = 9_000n;
const ROLL_HISTORY_LOOKBACK_BLOCKS = 50_000n;

const TURN_ACTION_KIND_IDS: Record<TurnActionKind, number> = {
  PLACE_BET: 0,
  PLACE_INDEXED_BET: 1,
  REMOVE_BET: 2,
  REMOVE_INDEXED_BET: 3,
  SET_BOX_WORKING: 4,
};

type RefreshTarget = 'playerState' | 'walletBalance' | 'allowance' | 'tokenMeta';

type PendingTxMeta = {
  hash: Hex;
  label: string;
  refreshTargets: RefreshTarget[];
  preservePendingOnSync?: boolean;
  onConfirmed?: () => void | Promise<void>;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const shouldPreserveLocalPending = (
  previous: NormalizedPlayerState | null,
  next: NormalizedPlayerState,
  preservePending: boolean,
) => preservePending && previous?.phase === SESSION_PHASE.ROLL_PENDING && next.phase !== SESSION_PHASE.ROLL_PENDING;

const serializeTurnAction = (action: TurnAction) => ({
  kind: TURN_ACTION_KIND_IDS[action.kind],
  betType: action.betType,
  index: action.index,
  amount: action.amount,
  working: action.working,
});

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
  lay4: { amount: 0n, working: false },
  lay5: { amount: 0n, working: false },
  lay6: { amount: 0n, working: false },
  lay8: { amount: 0n, working: false },
  lay9: { amount: 0n, working: false },
  lay10: { amount: 0n, working: false },
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

const cloneBets = (bets: any = EMPTY_BETS): any => ({
  passLine: { ...(bets?.passLine ?? EMPTY_BETS.passLine) },
  dontPass: { ...(bets?.dontPass ?? EMPTY_BETS.dontPass) },
  come: ((bets?.come ?? EMPTY_BETS.come) as Array<any>).slice(0, 4).map((slot) => ({ ...(slot ?? {}) })),
  dontCome: ((bets?.dontCome ?? EMPTY_BETS.dontCome) as Array<any>).slice(0, 4).map((slot) => ({ ...(slot ?? {}) })),
  place4: { ...(bets?.place4 ?? EMPTY_BETS.place4) },
  place5: { ...(bets?.place5 ?? EMPTY_BETS.place5) },
  place6: { ...(bets?.place6 ?? EMPTY_BETS.place6) },
  place8: { ...(bets?.place8 ?? EMPTY_BETS.place8) },
  place9: { ...(bets?.place9 ?? EMPTY_BETS.place9) },
  place10: { ...(bets?.place10 ?? EMPTY_BETS.place10) },
  hard4: { ...(bets?.hard4 ?? EMPTY_BETS.hard4) },
  hard6: { ...(bets?.hard6 ?? EMPTY_BETS.hard6) },
  hard8: { ...(bets?.hard8 ?? EMPTY_BETS.hard8) },
  hard10: { ...(bets?.hard10 ?? EMPTY_BETS.hard10) },
  lay4: { ...(bets?.lay4 ?? EMPTY_BETS.lay4) },
  lay5: { ...(bets?.lay5 ?? EMPTY_BETS.lay5) },
  lay6: { ...(bets?.lay6 ?? EMPTY_BETS.lay6) },
  lay8: { ...(bets?.lay8 ?? EMPTY_BETS.lay8) },
  lay9: { ...(bets?.lay9 ?? EMPTY_BETS.lay9) },
  lay10: { ...(bets?.lay10 ?? EMPTY_BETS.lay10) },
  oneRolls: { ...(bets?.oneRolls ?? EMPTY_BETS.oneRolls) },
});

const applyLocalBetsUpdate = (
  previous: NormalizedPlayerState | null,
  updater: (bets: any) => { availableDelta?: bigint; inPlayDelta?: bigint } | void,
) => {
  if (!previous) {
    return previous;
  }

  const bets = cloneBets(previous.bets);
  const result = updater(bets) ?? {};

  return {
    ...previous,
    available: previous.available + (result.availableDelta ?? 0n),
    inPlay: previous.inPlay + (result.inPlayDelta ?? 0n),
    lastActivityTime: Math.floor(Date.now() / 1000),
    bets,
  };
};

const applySessionOpenDraft = (previous: NormalizedPlayerState | null) => {
  if (!previous) {
    return previous;
  }

  return {
    ...previous,
    phase: SESSION_PHASE.COME_OUT,
    point: 0,
    pendingRequestId: 0n,
    lastActivityTime: Math.floor(Date.now() / 1000),
  };
};

const applyTurnActionToState = (previous: NormalizedPlayerState | null, action: TurnAction) => {
  const baseState =
    action.kind === 'PLACE_BET' && previous?.phase === SESSION_PHASE.INACTIVE
      ? applySessionOpenDraft(previous)
      : previous;

  switch (action.kind) {
    case 'REMOVE_BET':
      return applyLocalBetsUpdate(baseState, (bets) => {
        if (action.betType === BET_TYPES.DONT_PASS) {
          const delta = BigInt(bets.dontPass.amount ?? 0) + BigInt(bets.dontPass.oddsAmount ?? 0);
          bets.dontPass = { amount: 0n, oddsAmount: 0n, point: 0 };
          return { availableDelta: delta, inPlayDelta: -delta };
        }

        if (action.betType === BET_TYPES.PASS_LINE_ODDS) {
          const delta = BigInt(bets.passLine.oddsAmount ?? 0);
          bets.passLine.oddsAmount = 0n;
          return { availableDelta: delta, inPlayDelta: -delta };
        }

        if (action.betType === BET_TYPES.DONT_PASS_ODDS) {
          const delta = BigInt(bets.dontPass.oddsAmount ?? 0);
          bets.dontPass.oddsAmount = 0n;
          return { availableDelta: delta, inPlayDelta: -delta };
        }

        const placeMeta = getPlaceToggleMeta(action.betType);
        if (placeMeta) {
          const delta = BigInt(bets[placeMeta.key]?.amount ?? 0);
          bets[placeMeta.key] = { amount: 0n, working: false };
          return { availableDelta: delta, inPlayDelta: -delta };
        }

        const layMeta = getLayToggleMeta(action.betType);
        if (layMeta) {
          const delta = BigInt(bets[layMeta.key]?.amount ?? 0);
          bets[layMeta.key] = { amount: 0n, working: false };
          return { availableDelta: delta, inPlayDelta: -delta };
        }

        const hardwayKey = getHardwayKey(action.betType);
        if (hardwayKey) {
          const delta = BigInt(bets[hardwayKey].amount ?? 0);
          bets[hardwayKey].amount = 0n;
          return { availableDelta: delta, inPlayDelta: -delta };
        }

        const oneRollKey = getOneRollKey(action.betType);
        if (oneRollKey) {
          const delta = BigInt(bets.oneRolls[oneRollKey] ?? 0);
          bets.oneRolls[oneRollKey] = 0n;
          return { availableDelta: delta, inPlayDelta: -delta };
        }
      });
    case 'REMOVE_INDEXED_BET':
      return applyLocalBetsUpdate(baseState, (bets) => {
        if (action.betType === BET_TYPES.DONT_COME) {
          const slot = bets.dontCome[action.index];
          const delta = BigInt(slot?.amount ?? 0) + BigInt(slot?.oddsAmount ?? 0);
          bets.dontCome[action.index] = { amount: 0n, oddsAmount: 0n, point: 0 };
          return { availableDelta: delta, inPlayDelta: -delta };
        }

        if (action.betType === BET_TYPES.COME_ODDS) {
          const slot = bets.come[action.index];
          const delta = BigInt(slot?.oddsAmount ?? 0);
          if (slot) {
            slot.oddsAmount = 0n;
          }
          return { availableDelta: delta, inPlayDelta: -delta };
        }

        if (action.betType === BET_TYPES.DONT_COME_ODDS) {
          const slot = bets.dontCome[action.index];
          const delta = BigInt(slot?.oddsAmount ?? 0);
          if (slot) {
            slot.oddsAmount = 0n;
          }
          return { availableDelta: delta, inPlayDelta: -delta };
        }
      });
    case 'SET_BOX_WORKING':
      return applyLocalBetsUpdate(baseState, (bets) => {
        const placeMeta = getPlaceToggleMeta(action.betType);
        if (placeMeta) {
          bets[placeMeta.key] = {
            ...(bets[placeMeta.key] ?? { amount: 0n, working: false }),
            working: action.working,
          };
          return;
        }

        const layMeta = getLayToggleMeta(action.betType);
        if (layMeta) {
          bets[layMeta.key] = {
            ...(bets[layMeta.key] ?? { amount: 0n, working: false }),
            working: action.working,
          };
        }
      });
    case 'PLACE_BET':
      return applyLocalBetsUpdate(baseState, (bets) => {
        if (action.betType === BET_TYPES.PASS_LINE) {
          bets.passLine.amount = BigInt(bets.passLine.amount ?? 0) + action.amount;
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        if (action.betType === BET_TYPES.PASS_LINE_ODDS) {
          bets.passLine.oddsAmount = BigInt(bets.passLine.oddsAmount ?? 0) + action.amount;
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        if (action.betType === BET_TYPES.DONT_PASS) {
          bets.dontPass.amount = BigInt(bets.dontPass.amount ?? 0) + action.amount;
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        if (action.betType === BET_TYPES.DONT_PASS_ODDS) {
          bets.dontPass.oddsAmount = BigInt(bets.dontPass.oddsAmount ?? 0) + action.amount;
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        if (action.betType === BET_TYPES.COME || action.betType === BET_TYPES.DONT_COME) {
          const slots = action.betType === BET_TYPES.COME ? bets.come : bets.dontCome;
          const targetIndex = slots.findIndex((slot: any) => BigInt(slot?.amount ?? 0) === 0n);
          if (targetIndex >= 0) {
            slots[targetIndex] = {
              amount: BigInt(slots[targetIndex]?.amount ?? 0) + action.amount,
              oddsAmount: BigInt(slots[targetIndex]?.oddsAmount ?? 0),
              point: Number(slots[targetIndex]?.point ?? 0),
            };
          }
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        const placeMeta = getPlaceToggleMeta(action.betType);
        if (placeMeta) {
          const current = bets[placeMeta.key] ?? { amount: 0n, working: false };
          bets[placeMeta.key] = {
            amount: BigInt(current.amount ?? 0) + action.amount,
            working: BigInt(current.amount ?? 0) === 0n ? true : Boolean(current.working),
          };
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        const layMeta = getLayToggleMeta(action.betType);
        if (layMeta) {
          const current = bets[layMeta.key] ?? { amount: 0n, working: false };
          bets[layMeta.key] = {
            amount: BigInt(current.amount ?? 0) + action.amount,
            working: BigInt(current.amount ?? 0) === 0n ? true : Boolean(current.working),
          };
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        const hardwayKey = getHardwayKey(action.betType);
        if (hardwayKey) {
          bets[hardwayKey].amount = BigInt(bets[hardwayKey].amount ?? 0) + action.amount;
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        const oneRollKey = getOneRollKey(action.betType);
        if (oneRollKey) {
          bets.oneRolls[oneRollKey] = BigInt(bets.oneRolls[oneRollKey] ?? 0) + action.amount;
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }
      });
    case 'PLACE_INDEXED_BET':
      return applyLocalBetsUpdate(baseState, (bets) => {
        if (action.betType === BET_TYPES.COME_ODDS) {
          const slot = bets.come[action.index];
          if (slot) {
            slot.oddsAmount = BigInt(slot.oddsAmount ?? 0) + action.amount;
          }
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }

        if (action.betType === BET_TYPES.DONT_COME_ODDS) {
          const slot = bets.dontCome[action.index];
          if (slot) {
            slot.oddsAmount = BigInt(slot.oddsAmount ?? 0) + action.amount;
          }
          return { availableDelta: -action.amount, inPlayDelta: action.amount };
        }
      });
    default:
      return previous;
  }
};

const applyTurnActionsToState = (previous: NormalizedPlayerState | null, actions: TurnAction[]) =>
  actions.reduce((state, action) => applyTurnActionToState(state, action), previous);

const getOneRollKey = (betType: BetTypeId) => {
  switch (betType) {
    case BET_TYPES.FIELD:
      return 'field';
    case BET_TYPES.ANY_7:
      return 'any7';
    case BET_TYPES.ANY_CRAPS:
      return 'anyCraps';
    case BET_TYPES.CRAPS_2:
      return 'craps2';
    case BET_TYPES.CRAPS_3:
      return 'craps3';
    case BET_TYPES.YO:
      return 'yo';
    case BET_TYPES.TWELVE:
      return 'twelve';
    case BET_TYPES.HORN:
      return 'horn';
    default:
      return null;
  }
};

const getHardwayKey = (betType: BetTypeId) => {
  switch (betType) {
    case BET_TYPES.HARD_4:
      return 'hard4';
    case BET_TYPES.HARD_6:
      return 'hard6';
    case BET_TYPES.HARD_8:
      return 'hard8';
    case BET_TYPES.HARD_10:
      return 'hard10';
    default:
      return null;
  }
};

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
  if (/InsufficientBalance|ERC20InsufficientBalance|0xe450d38c/i.test(message)) {
    return 'Not enough token balance for this action.';
  }
  if (/ERC20InsufficientAllowance|0xfb8f41b2/i.test(message)) {
    return 'Token allowance is too low. Approve the token and try again.';
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
  if (/EmptyTurn|TooManyTurnActions/i.test(message)) {
    return 'Build a valid turn before confirming it.';
  }
  if (/InvalidWorkingBetType/i.test(message)) {
    return 'That bet cannot be toggled from here.';
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
  faucetMaxRequestAmount: bigint;
  canRequestFaucet: boolean;
  requestFaucet: (amount: bigint) => Promise<void>;
  playerState: NormalizedPlayerState | null;
  rollHistory: RollHistoryEntry[];
  lastResolvedRoll: RollHistoryEntry | null;
  refresh: () => Promise<void>;
  isRolling: boolean;
  isBusy: boolean;
  isTxPending: boolean;
  txLabel?: string;
  txHash?: Hex;
  error?: string;
  clearError: () => void;
  switchToBaseSepolia: () => Promise<void>;
  deposit: (amount: bigint) => Promise<void>;
  withdraw: (amount: bigint) => Promise<void>;
  approveMax: () => Promise<void>;
  closeSession: () => Promise<void>;
  placeBet: (betType: BetTypeId, amount: bigint) => Promise<void>;
  placeIndexedBet: (betType: BetTypeId, index: number, amount: bigint) => Promise<void>;
  removeBet: (betType: BetTypeId) => Promise<void>;
  removeIndexedBet: (betType: BetTypeId, index: number) => Promise<void>;
  setPlaceWorking: (placeNumber: number, working: boolean) => Promise<void>;
  setLayWorking: (layNumber: number, working: boolean) => Promise<void>;
  setTurnModeEnabled: (enabled: boolean) => void;
  clearQueuedTurn: () => void;
  turnModeEnabled: boolean;
  queuedTurnActions: TurnAction[];
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
  const canRequestFaucet = Boolean(isConnected && address && walletChainId === DEFAULT_CHAIN_ID && network.supportsFaucet);
  const publicClient = usePublicClient({ chainId: activeChainId });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [rollHistory, setRollHistory] = useState<RollHistoryEntry[]>([]);
  const [lastResolvedRoll, setLastResolvedRoll] = useState<RollHistoryEntry | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [optimisticRollPending, setOptimisticRollPending] = useState(false);
  const [suppressPendingSync, setSuppressPendingSync] = useState(false);
  const [turnModeEnabled, setTurnModeEnabled] = useState(true);
  const [queuedTurnActions, setQueuedTurnActions] = useState<TurnAction[]>([]);
  const [pendingRollActions, setPendingRollActions] = useState<TurnAction[]>([]);
  const [txState, setTxState] = useState<{
    busy: boolean;
    label?: string;
    hash?: Hex;
    error?: string;
  }>({ busy: false });
  const [pendingTxMeta, setPendingTxMeta] = useState<PendingTxMeta | null>(null);
  const pendingTxPromiseRef = useRef<{
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null>(null);
  const observedPendingRequestIdRef = useRef<bigint | null>(null);

  const txReceiptQuery = useWaitForTransactionReceipt({
    chainId: activeChainId,
    hash: pendingTxMeta?.hash,
    query: {
      enabled: Boolean(pendingTxMeta?.hash),
    },
  });

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

  const queriedPlayerState = useMemo(() => {
    if (!address || !playerStateQuery.data) {
      return null;
    }

    return normalizePlayerState(playerStateQuery.data);
  }, [address, playerStateQuery.data]);

  const [playerState, setPlayerState] = useState<NormalizedPlayerState | null>(null);

  useEffect(() => {
    setPlayerState((previous) => {
      if (!queriedPlayerState) {
        return null;
      }

      if (shouldPreserveLocalPending(previous, queriedPlayerState, optimisticRollPending)) {
        return previous;
      }

      if (
        suppressPendingSync &&
        previous?.phase !== SESSION_PHASE.ROLL_PENDING &&
        queriedPlayerState.phase === SESSION_PHASE.ROLL_PENDING
      ) {
        return previous;
      }


      if (queriedPlayerState.phase !== SESSION_PHASE.ROLL_PENDING) {
        setIsRolling(false);
        setOptimisticRollPending(false);
      }

      return queriedPlayerState;
    });

    if (suppressPendingSync && queriedPlayerState && queriedPlayerState.phase !== SESSION_PHASE.ROLL_PENDING) {
      setSuppressPendingSync(false);
    }
  }, [optimisticRollPending, queriedPlayerState, suppressPendingSync]);

  const displayPlayerState = useMemo(() => {
    const overlayActions = queuedTurnActions.length > 0
      ? queuedTurnActions
      : playerState?.phase === SESSION_PHASE.ROLL_PENDING
        ? pendingRollActions
        : [];

    return applyTurnActionsToState(playerState, overlayActions);
  }, [pendingRollActions, playerState, queuedTurnActions]);

  const queueTurnAction = useCallback((action: TurnAction) => {
    setQueuedTurnActions((previous) => [...previous, action]);
  }, []);

  const refetchRelevantData = useCallback(
    async (
      targets: Array<'playerState' | 'walletBalance' | 'allowance' | 'tokenMeta'>,
    ) => {
      const uniqueTargets = Array.from(new Set(targets));
      const tasks: Array<Promise<unknown>> = [];

      if (uniqueTargets.includes('playerState')) {
        tasks.push(playerStateQuery.refetch());
      }

      if (uniqueTargets.includes('walletBalance')) {
        tasks.push(walletBalanceQuery.refetch());
      }

      if (uniqueTargets.includes('allowance')) {
        tasks.push(allowanceQuery.refetch());
      }

      if (uniqueTargets.includes('tokenMeta')) {
        tasks.push(symbolQuery.refetch(), decimalsQuery.refetch());
      }

      await Promise.allSettled(tasks);
    },
    [allowanceQuery, decimalsQuery, playerStateQuery, symbolQuery, walletBalanceQuery],
  );

  const refresh = useCallback(async () => {
    await refetchRelevantData(['playerState', 'walletBalance', 'allowance', 'tokenMeta']);
  }, [refetchRelevantData]);

  const applyPlayerStateSnapshot = useCallback(
    (normalized: NormalizedPlayerState, options?: { preservePending?: boolean }) => {
      const preservePending = options?.preservePending ?? optimisticRollPending;

      setPlayerState((previous) => {
        if (shouldPreserveLocalPending(previous, normalized, preservePending)) {
          return previous;
        }

        if (
          suppressPendingSync &&
          previous?.phase !== SESSION_PHASE.ROLL_PENDING &&
          normalized.phase === SESSION_PHASE.ROLL_PENDING
        ) {
          return previous;
        }


        if (normalized.phase !== SESSION_PHASE.ROLL_PENDING) {
          setIsRolling(false);
          setOptimisticRollPending(false);
        }

        return normalized;
      });

      if (suppressPendingSync && normalized.phase !== SESSION_PHASE.ROLL_PENDING) {
        setSuppressPendingSync(false);
      }

      return normalized;
    },
    [optimisticRollPending, suppressPendingSync],
  );

  const readPlayerStateFromChain = useCallback(async () => {
    if (!publicClient || !contractAddress || !address) {
      return null;
    }

    try {
      const raw = await publicClient.readContract({
        address: contractAddress,
        abi: crapsGameAbi,
        functionName: 'getPlayerState',
        args: [address],
      });

      return normalizePlayerState(raw);
    } catch {
      return null;
    }
  }, [address, contractAddress, publicClient]);

  const syncPlayerStateFromChain = useCallback(
    async (options?: { preservePending?: boolean }) => {
      const normalized = await readPlayerStateFromChain();
      if (!normalized) {
        return null;
      }

      return applyPlayerStateSnapshot(normalized, options);
    },
    [applyPlayerStateSnapshot, readPlayerStateFromChain],
  );

  const appendResolvedRoll = useCallback((entry: RollHistoryEntry) => {
    setLastResolvedRoll((previous) => {
      if (previous?.requestId === entry.requestId) {
        return previous;
      }

      return entry;
    });

    setRollHistory((previous) => {
      if (previous.some((item) => item.requestId === entry.requestId)) {
        return previous;
      }

      return [entry, ...previous].slice(0, 20);
    });
  }, []);

  const syncRollHistoryFromChain = useCallback(async () => {
    if (!publicClient || !contractAddress || !address) {
      return [] as RollHistoryEntry[];
    }

    try {
      const latestBlock = await publicClient.getBlockNumber();
      const floorBlock = latestBlock > ROLL_HISTORY_LOOKBACK_BLOCKS ? latestBlock - ROLL_HISTORY_LOOKBACK_BLOCKS : 0n;
      const collected: Array<{
        args: {
          requestId?: bigint;
          die1?: number;
          die2?: number;
          payout?: bigint;
        };
        blockNumber?: bigint;
      }> = [];

      for (let toBlock = latestBlock; toBlock >= floorBlock && collected.length < 20; ) {
        const fromBlock = toBlock > LOG_BLOCK_CHUNK ? toBlock - LOG_BLOCK_CHUNK + 1n : 0n;
        const chunkFloor = fromBlock < floorBlock ? floorBlock : fromBlock;
        const logs = await publicClient.getLogs({
          address: contractAddress,
          event: rollResolvedEvent,
          args: { player: address },
          fromBlock: chunkFloor,
          toBlock,
        });

        collected.push(...(logs as typeof collected));

        if (chunkFloor === 0n || chunkFloor === floorBlock) {
          break;
        }

        toBlock = chunkFloor - 1n;
      }

      const entries = collected
        .sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)))
        .slice(0, 20)
        .map((log) => ({
          id: `${String(log.args.requestId ?? 0)}-${String(log.blockNumber ?? Date.now())}`,
          requestId: BigInt(log.args.requestId ?? 0),
          die1: Number(log.args.die1 ?? 0),
          die2: Number(log.args.die2 ?? 0),
          payout: BigInt(log.args.payout ?? 0),
          at: Number(log.blockNumber ?? 0),
        }));


      setRollHistory(entries);
      setLastResolvedRoll(entries[0] ?? null);

      return entries;
    } catch {
      return [] as RollHistoryEntry[];
    }
  }, [address, contractAddress, publicClient]);

  const syncPendingRequestFromReceipt = useCallback(
    (receipt: { logs?: Array<{ address: Address; data: Hex; topics: readonly Hex[] }> } | undefined) => {
      if (!receipt?.logs || !contractAddress || !address) {
        return null;
      }

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
          continue;
        }

        try {
          const decoded = decodeEventLog({
            abi: [rollRequestedEvent],
            data: log.data,
            topics: log.topics as [Hex, ...Hex[]],
          });

          if (decoded.eventName !== 'RollRequested') {
            continue;
          }

          const player = decoded.args.player as Address | undefined;
          if (!player || player.toLowerCase() !== address.toLowerCase()) {
            continue;
          }

          const requestId = BigInt(decoded.args.requestId ?? 0);
          if (requestId === 0n) {
            continue;
          }

          observedPendingRequestIdRef.current = requestId;
          setPlayerState((previous) =>
            previous
              ? {
                  ...previous,
                  phase: SESSION_PHASE.ROLL_PENDING,
                  pendingRequestId: requestId,
                  lastActivityTime: Math.floor(Date.now() / 1000),
                }
              : previous,
          );
          return requestId;
        } catch {
          // ignore unrelated logs
        }
      }

      return null;
    },
    [address, contractAddress],
  );

  const syncRollHistoryAfterSettlement = useCallback(async () => {
    const previousLatestRequestId = lastResolvedRoll?.requestId ?? null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const entries = await syncRollHistoryFromChain();
      const latestRequestId = entries[0]?.requestId ?? null;


      if (previousLatestRequestId === null) {
        if (entries.length > 0) {
          return entries;
        }
      } else if (latestRequestId !== null && latestRequestId !== previousLatestRequestId) {
        return entries;
      }

      await sleep(500);
    }

    return [] as RollHistoryEntry[];
  }, [lastResolvedRoll?.requestId, syncRollHistoryFromChain]);

  const syncPlayerStateAfterResolution = useCallback(async () => {
    let latestState: NormalizedPlayerState | null = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      latestState = await readPlayerStateFromChain();

      if (!latestState) {
        return latestState;
      }


      applyPlayerStateSnapshot(latestState, { preservePending: false });

      if (latestState.phase !== SESSION_PHASE.ROLL_PENDING && latestState.pendingRequestId === 0n) {
        setOptimisticRollPending(false);
        return latestState;
      }

      await sleep(350);
    }

    return latestState;
  }, [applyPlayerStateSnapshot, readPlayerStateFromChain]);

  const waitForResolvedRollByRequestId = useCallback(
    async (requestId: bigint, fromBlock?: bigint) => {
      if (!publicClient || !contractAddress || !address || requestId === 0n) {
        return false;
      }

      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          const latestBlock = await publicClient.getBlockNumber();
          const searchFromBlock = fromBlock !== undefined
            ? (fromBlock > 2n ? fromBlock - 2n : 0n)
            : (latestBlock > 2_000n ? latestBlock - 2_000n : 0n);
          const logs = await publicClient.getLogs({
            address: contractAddress,
            event: rollResolvedEvent,
            args: {
              player: address,
              requestId,
            },
            fromBlock: searchFromBlock,
            toBlock: latestBlock,
          });

          const resolvedLog = logs.at(-1) as
            | {
                args?: {
                  requestId?: bigint;
                  die1?: number;
                  die2?: number;
                  payout?: bigint;
                };
                blockNumber?: bigint;
              }
            | undefined;


          if (resolvedLog) {
            appendResolvedRoll({
              id: `${String(resolvedLog.args?.requestId ?? requestId)}-${String(resolvedLog.blockNumber ?? Date.now())}`,
              requestId: BigInt(resolvedLog.args?.requestId ?? requestId),
              die1: Number(resolvedLog.args?.die1 ?? 0),
              die2: Number(resolvedLog.args?.die2 ?? 0),
              payout: BigInt(resolvedLog.args?.payout ?? 0),
              at: Date.now(),
            });

            setIsRolling(false);
            setOptimisticRollPending(false);
            setSuppressPendingSync(true);
            observedPendingRequestIdRef.current = null;
            setPlayerState((previous) =>
              previous
                ? {
                    ...previous,
                    phase: previous.point === 0 ? SESSION_PHASE.COME_OUT : SESSION_PHASE.POINT,
                    pendingRequestId: 0n,
                    reserved: 0n,
                    lastActivityTime: Math.floor(Date.now() / 1000),
                  }
                : previous,
            );
            await refresh();
            await syncPlayerStateAfterResolution();
            await syncRollHistoryFromChain();
            return true;
          }
        } catch {
          // continue polling
        }

        await sleep(1_000);
      }

      return false;
    },
    [address, appendResolvedRoll, contractAddress, publicClient, refresh, syncPlayerStateAfterResolution, syncRollHistoryFromChain],
  );

  const syncPendingRollRequestFromChain = useCallback(async () => {
    let latestState: NormalizedPlayerState | null = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      latestState = await readPlayerStateFromChain();

      if (!latestState) {
        return latestState;
      }


      if (latestState.phase === SESSION_PHASE.ROLL_PENDING && latestState.pendingRequestId !== 0n) {
        observedPendingRequestIdRef.current = latestState.pendingRequestId;
        void waitForResolvedRollByRequestId(latestState.pendingRequestId);
        return applyPlayerStateSnapshot(latestState, { preservePending: true });
      }

      if (latestState.phase !== SESSION_PHASE.ROLL_PENDING) {
        if (observedPendingRequestIdRef.current === null) {
          await sleep(300);
          continue;
        }

        await sleep(300);
        continue;
      }

      await sleep(300);
    }

    return latestState;
  }, [applyPlayerStateSnapshot, readPlayerStateFromChain, syncRollHistoryAfterSettlement, waitForResolvedRollByRequestId]);

  const syncResolvedRollForPendingRequest = useCallback(async () => {
    if (!publicClient || !contractAddress || !address) {
      return false;
    }

    const pendingRequestId = playerState?.pendingRequestId || observedPendingRequestIdRef.current || 0n;
    if (pendingRequestId === 0n) {
      return false;
    }

    try {
      const latestBlock = await publicClient.getBlockNumber();
      const fromBlock = latestBlock > 2_000n ? latestBlock - 2_000n : 0n;
      const logs = await publicClient.getLogs({
        address: contractAddress,
        event: rollResolvedEvent,
        args: {
          player: address,
          requestId: pendingRequestId,
        },
        fromBlock,
        toBlock: latestBlock,
      });

      const resolvedLog = logs.at(-1) as
        | {
            args?: {
              requestId?: bigint;
              die1?: number;
              die2?: number;
              payout?: bigint;
            };
            blockNumber?: bigint;
          }
        | undefined;

      if (!resolvedLog) {
        return false;
      }


      appendResolvedRoll({
        id: `${String(resolvedLog.args?.requestId ?? pendingRequestId)}-${String(resolvedLog.blockNumber ?? Date.now())}`,
        requestId: BigInt(resolvedLog.args?.requestId ?? pendingRequestId),
        die1: Number(resolvedLog.args?.die1 ?? 0),
        die2: Number(resolvedLog.args?.die2 ?? 0),
        payout: BigInt(resolvedLog.args?.payout ?? 0),
        at: Date.now(),
      });

      setIsRolling(false);
      setOptimisticRollPending(false);
      setSuppressPendingSync(true);
      setPlayerState((previous) =>
        previous
          ? {
              ...previous,
              phase: previous.point === 0 ? SESSION_PHASE.COME_OUT : SESSION_PHASE.POINT,
              pendingRequestId: 0n,
              reserved: 0n,
              lastActivityTime: Math.floor(Date.now() / 1000),
            }
          : previous,
      );
      await refresh();
      await syncPlayerStateAfterResolution();
      await syncRollHistoryFromChain();
      return true;
    } catch {
      return false;
    }
  }, [
    address,
    appendResolvedRoll,
    contractAddress,
    playerState?.pendingRequestId,
    publicClient,
    refresh,
    syncPlayerStateAfterResolution,
    syncRollHistoryFromChain,
  ]);

  useEffect(() => {
    if (!pendingTxMeta || !txReceiptQuery.isSuccess) {
      return;
    }

    let cancelled = false;

    const finalize = async () => {
      try {
        if (pendingTxMeta.label === 'Roll dice' || pendingTxMeta.label === 'Confirm & Roll') {
          const requestId = syncPendingRequestFromReceipt(txReceiptQuery.data as typeof txReceiptQuery.data);
          if (requestId !== null) {
            void waitForResolvedRollByRequestId(
              requestId,
              (txReceiptQuery.data as { blockNumber?: bigint } | undefined)?.blockNumber,
            );
          }
        }

        await pendingTxMeta.onConfirmed?.();
        await refetchRelevantData(pendingTxMeta.refreshTargets);

        if (pendingTxMeta.refreshTargets.includes('playerState')) {
          await syncPlayerStateFromChain({
            preservePending: pendingTxMeta.preservePendingOnSync,
          });
        }

        if (!cancelled) {
          setTxState({ busy: false, label: pendingTxMeta.label, hash: pendingTxMeta.hash });
          pendingTxPromiseRef.current?.resolve();
          pendingTxPromiseRef.current = null;
          setPendingTxMeta(null);
        }
      } catch (error) {
        if (!cancelled) {
          setTxState({ busy: false, label: pendingTxMeta.label, error: mapContractError(error) });
          pendingTxPromiseRef.current?.reject(error);
          pendingTxPromiseRef.current = null;
          setPendingTxMeta(null);
        }
      }
    };

    void finalize();

    return () => {
      cancelled = true;
    };
  }, [
    pendingTxMeta,
    refetchRelevantData,
    syncPendingRequestFromReceipt,
    syncPlayerStateFromChain,
    txReceiptQuery.data,
    txReceiptQuery.isSuccess,
    waitForResolvedRollByRequestId,
  ]);

  useEffect(() => {
    if (!pendingTxMeta || !txReceiptQuery.isError) {
      return;
    }

    const error = txReceiptQuery.error;
    setTxState({ busy: false, label: pendingTxMeta.label, error: mapContractError(error) });
    pendingTxPromiseRef.current?.reject(error);
    pendingTxPromiseRef.current = null;
    setPendingTxMeta(null);
  }, [pendingTxMeta, txReceiptQuery.error, txReceiptQuery.isError]);

  const runWrite = useCallback(
    async (
      label: string,
      writer: () => Promise<Hex>,
      options: {
        refreshTargets?: RefreshTarget[];
        preservePendingOnSync?: boolean;
        onConfirmed?: () => void | Promise<void>;
      } = {},
    ) => {
      setTxState({ busy: true, label, error: undefined });
      try {
        const hash = await writer();
        setTxState({ busy: true, label, hash, error: undefined });

        await new Promise<void>((resolve, reject) => {
          pendingTxPromiseRef.current = { resolve, reject };
          setPendingTxMeta({
            hash,
            label,
            refreshTargets: options.refreshTargets ?? ['playerState', 'walletBalance', 'allowance'],
            preservePendingOnSync: options.preservePendingOnSync,
            onConfirmed: options.onConfirmed,
          });
        });
      } catch (error) {
        setTxState({ busy: false, label, error: mapContractError(error) });
        throw error;
      }
    },
    [],
  );

  const writeGame = useCallback(
    async (
      label: string,
      functionName: string,
      args: readonly unknown[] = [],
      options: {
        refreshTargets?: RefreshTarget[];
        preservePendingOnSync?: boolean;
        onConfirmed?: () => void | Promise<void>;
      } = {},
    ) => {
      if (!contractAddress) {
        throw new Error('Missing game contract configuration.');
      }

      await runWrite(
        label,
        () =>
          writeContractAsync({
            address: contractAddress,
            abi: crapsGameAbi,
            functionName: functionName as never,
            args: args as never,
          }),
        options,
      );
    },
    [contractAddress, runWrite, writeContractAsync],
  );

  const approveMax = useCallback(async () => {
    if (!tokenAddress || !contractAddress) {
      throw new Error('Missing token or game contract configuration.');
    }

    await runWrite(
      'Approve token',
      () =>
        writeContractAsync({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [contractAddress, maxUint256],
        }),
      { refreshTargets: ['allowance'] },
    );
  }, [contractAddress, runWrite, tokenAddress, writeContractAsync]);

  const requestFaucet = useCallback(
    async (amount: bigint) => {
      if (!canRequestFaucet || !address || !tokenAddress) {
        throw new Error('srUSDC faucet is only available on BASE Sepolia for the connected wallet.');
      }

      if (amount <= 0n) {
        throw new Error('Enter a valid faucet amount.');
      }

      if (amount > network.faucetMaxRequestAmount) {
        throw new Error('Faucet requests are capped at 1000 srUSDC per request.');
      }

      await runWrite(
        'Request faucet',
        () =>
          writeContractAsync({
            address: tokenAddress,
            abi: srUsdcAbi,
            functionName: 'mint',
            args: [address, amount],
          }),
        { refreshTargets: ['walletBalance'] },
      );
    },
    [
      address,
      canRequestFaucet,
      network.faucetMaxRequestAmount,
      runWrite,
      tokenAddress,
      walletBalanceQuery,
      writeContractAsync,
    ],
  );

  const deposit = useCallback(
    (amount: bigint) =>
      writeGame('Deposit', 'deposit', [amount], {
        refreshTargets: ['playerState', 'walletBalance', 'allowance'],
      }),
    [writeGame],
  );

  const withdraw = useCallback(
    (amount: bigint) =>
      writeGame('Withdraw', 'withdraw', [amount], {
        refreshTargets: ['playerState', 'walletBalance'],
      }),
    [writeGame],
  );

  const executeTurnActions = useCallback(
    async (label: string, actions: TurnAction[], rollAfter: boolean) => {
      await writeGame(label, 'executeTurn', [actions.map(serializeTurnAction), rollAfter], {
        refreshTargets: rollAfter ? [] : ['playerState'],
      });
    },
    [writeGame],
  );

  const closeSession = useCallback(async () => {
    await writeGame('Close session', 'closeSession', [], {
      refreshTargets: ['playerState', 'walletBalance'],
    });
    setOptimisticRollPending(false);
    setPendingRollActions([]);
    setPlayerState((previous) => ({
      ...(previous ?? EMPTY_PLAYER_STATE),
      phase: SESSION_PHASE.INACTIVE,
      point: 0,
      pendingRequestId: 0n,
      inPlay: 0n,
      reserved: 0n,
      bets: EMPTY_BETS,
    }));
  }, [writeGame]);
  const rollDice = useCallback(async () => {
    try {
      const queuedActions = turnModeEnabled ? queuedTurnActions : [];
      setPendingRollActions(queuedActions);
      setSuppressPendingSync(false);
      observedPendingRequestIdRef.current = null;

      if (queuedActions.length > 0) {
        await executeTurnActions('Confirm & Roll', queuedActions, true);
        setQueuedTurnActions([]);
      } else {
        await executeTurnActions('Roll dice', [], true);
      }

      setIsRolling(true);
      setOptimisticRollPending(true);
      setPlayerState((previous) =>
        previous
          ? {
              ...previous,
              phase: SESSION_PHASE.ROLL_PENDING,
              pendingRequestId: previous.pendingRequestId,
              lastActivityTime: Math.floor(Date.now() / 1000),
            }
          : previous,
      );
      void syncPendingRollRequestFromChain();
    } catch (error) {
      setIsRolling(false);
      setOptimisticRollPending(false);
      setPendingRollActions([]);
      throw error;
    }
  }, [executeTurnActions, queuedTurnActions, syncPendingRollRequestFromChain, turnModeEnabled]);
  const selfExclude = useCallback(
    () => writeGame('Self-exclude', 'selfExclude', [], { refreshTargets: ['playerState'] }),
    [writeGame],
  );
  const requestSelfReinstatement = useCallback(
    () => writeGame('Request reinstatement', 'requestSelfReinstatement', [], { refreshTargets: ['playerState'] }),
    [writeGame],
  );
  const completeSelfReinstatement = useCallback(
    () => writeGame('Complete reinstatement', 'completeSelfReinstatement', [], { refreshTargets: ['playerState'] }),
    [writeGame],
  );

  const clearQueuedTurn = useCallback(() => {
    setQueuedTurnActions([]);
    setPendingRollActions([]);
  }, []);

  const setComposerMode = useCallback((enabled: boolean) => {
    setTurnModeEnabled(enabled);
    if (!enabled) {
      setQueuedTurnActions([]);
    }
  }, []);

  const placeBet = useCallback(
    async (betType: BetTypeId, amount: bigint) => {
      if (turnModeEnabled) {
        queueTurnAction({ kind: 'PLACE_BET', betType, index: 0, amount, working: false });
        return;
      }

      await executeTurnActions('Place bet', [{ kind: 'PLACE_BET', betType, index: 0, amount, working: false }], false);
      setPlayerState((previous) =>
        applyLocalBetsUpdate(previous, (bets) => {
          if (betType === BET_TYPES.PASS_LINE) {
            bets.passLine.amount = BigInt(bets.passLine.amount ?? 0) + amount;
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          if (betType === BET_TYPES.PASS_LINE_ODDS) {
            bets.passLine.oddsAmount = BigInt(bets.passLine.oddsAmount ?? 0) + amount;
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          if (betType === BET_TYPES.DONT_PASS) {
            bets.dontPass.amount = BigInt(bets.dontPass.amount ?? 0) + amount;
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          if (betType === BET_TYPES.DONT_PASS_ODDS) {
            bets.dontPass.oddsAmount = BigInt(bets.dontPass.oddsAmount ?? 0) + amount;
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          if (betType === BET_TYPES.COME || betType === BET_TYPES.DONT_COME) {
            const slots = betType === BET_TYPES.COME ? bets.come : bets.dontCome;
            const targetIndex = slots.findIndex((slot: any) => BigInt(slot?.amount ?? 0) === 0n);
            if (targetIndex >= 0) {
              slots[targetIndex] = {
                amount: BigInt(slots[targetIndex]?.amount ?? 0) + amount,
                oddsAmount: BigInt(slots[targetIndex]?.oddsAmount ?? 0),
                point: Number(slots[targetIndex]?.point ?? 0),
              };
            }
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          const placeMeta = getPlaceToggleMeta(betType);
          if (placeMeta) {
            const current = bets[placeMeta.key] ?? { amount: 0n, working: false };
            bets[placeMeta.key] = {
              amount: BigInt(current.amount ?? 0) + amount,
              working: BigInt(current.amount ?? 0) === 0n ? true : Boolean(current.working),
            };
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          const layMeta = getLayToggleMeta(betType);
          if (layMeta) {
            const current = bets[layMeta.key] ?? { amount: 0n, working: false };
            bets[layMeta.key] = {
              amount: BigInt(current.amount ?? 0) + amount,
              working: BigInt(current.amount ?? 0) === 0n ? true : Boolean(current.working),
            };
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          const hardwayKey = getHardwayKey(betType);
          if (hardwayKey) {
            bets[hardwayKey].amount = BigInt(bets[hardwayKey].amount ?? 0) + amount;
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          const oneRollKey = getOneRollKey(betType);
          if (oneRollKey) {
            bets.oneRolls[oneRollKey] = BigInt(bets.oneRolls[oneRollKey] ?? 0) + amount;
            return { availableDelta: -amount, inPlayDelta: amount };
          }
        }),
      );
    },
    [executeTurnActions, queueTurnAction, turnModeEnabled],
  );

  const placeIndexedBet = useCallback(
    async (betType: BetTypeId, index: number, amount: bigint) => {
      if (turnModeEnabled) {
        queueTurnAction({ kind: 'PLACE_INDEXED_BET', betType, index, amount, working: false });
        return;
      }

      await executeTurnActions(
        'Place indexed bet',
        [{ kind: 'PLACE_INDEXED_BET', betType, index, amount, working: false }],
        false,
      );
      setPlayerState((previous) =>
        applyLocalBetsUpdate(previous, (bets) => {
          if (betType === BET_TYPES.COME_ODDS) {
            const slot = bets.come[index];
            if (slot) {
              slot.oddsAmount = BigInt(slot.oddsAmount ?? 0) + amount;
            }
            return { availableDelta: -amount, inPlayDelta: amount };
          }

          if (betType === BET_TYPES.DONT_COME_ODDS) {
            const slot = bets.dontCome[index];
            if (slot) {
              slot.oddsAmount = BigInt(slot.oddsAmount ?? 0) + amount;
            }
            return { availableDelta: -amount, inPlayDelta: amount };
          }
        }),
      );
    },
    [executeTurnActions, queueTurnAction, turnModeEnabled],
  );

  const removeBet = useCallback(
    async (betType: BetTypeId) => {
      if (turnModeEnabled) {
        queueTurnAction({ kind: 'REMOVE_BET', betType, index: 0, amount: 0n, working: false });
        return;
      }

      await executeTurnActions('Remove bet', [{ kind: 'REMOVE_BET', betType, index: 0, amount: 0n, working: false }], false);
      setPlayerState((previous) =>
        applyLocalBetsUpdate(previous, (bets) => {
          if (betType === BET_TYPES.PASS_LINE) {
            const delta = BigInt(bets.passLine.amount ?? 0) + BigInt(bets.passLine.oddsAmount ?? 0);
            bets.passLine = { amount: 0n, oddsAmount: 0n, point: 0 };
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          if (betType === BET_TYPES.PASS_LINE_ODDS) {
            const delta = BigInt(bets.passLine.oddsAmount ?? 0);
            bets.passLine.oddsAmount = 0n;
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          if (betType === BET_TYPES.DONT_PASS) {
            const delta = BigInt(bets.dontPass.amount ?? 0) + BigInt(bets.dontPass.oddsAmount ?? 0);
            bets.dontPass = { amount: 0n, oddsAmount: 0n, point: 0 };
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          if (betType === BET_TYPES.DONT_PASS_ODDS) {
            const delta = BigInt(bets.dontPass.oddsAmount ?? 0);
            bets.dontPass.oddsAmount = 0n;
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          const placeMeta = getPlaceToggleMeta(betType);
          if (placeMeta) {
            const delta = BigInt(bets[placeMeta.key]?.amount ?? 0);
            bets[placeMeta.key] = { amount: 0n, working: false };
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          const layMeta = getLayToggleMeta(betType);
          if (layMeta) {
            const delta = BigInt(bets[layMeta.key]?.amount ?? 0);
            bets[layMeta.key] = { amount: 0n, working: false };
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          const hardwayKey = getHardwayKey(betType);
          if (hardwayKey) {
            const delta = BigInt(bets[hardwayKey].amount ?? 0);
            bets[hardwayKey].amount = 0n;
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          const oneRollKey = getOneRollKey(betType);
          if (oneRollKey) {
            const delta = BigInt(bets.oneRolls[oneRollKey] ?? 0);
            bets.oneRolls[oneRollKey] = 0n;
            return { availableDelta: delta, inPlayDelta: -delta };
          }
        }),
      );
    },
    [executeTurnActions, queueTurnAction, turnModeEnabled],
  );

  const removeIndexedBet = useCallback(
    async (betType: BetTypeId, index: number) => {
      if (turnModeEnabled) {
        queueTurnAction({ kind: 'REMOVE_INDEXED_BET', betType, index, amount: 0n, working: false });
        return;
      }

      await executeTurnActions(
        'Remove indexed bet',
        [{ kind: 'REMOVE_INDEXED_BET', betType, index, amount: 0n, working: false }],
        false,
      );
      setPlayerState((previous) =>
        applyLocalBetsUpdate(previous, (bets) => {
          if (betType === BET_TYPES.DONT_COME) {
            const slot = bets.dontCome[index];
            const delta = BigInt(slot?.amount ?? 0) + BigInt(slot?.oddsAmount ?? 0);
            bets.dontCome[index] = { amount: 0n, oddsAmount: 0n, point: 0 };
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          if (betType === BET_TYPES.COME_ODDS) {
            const slot = bets.come[index];
            const delta = BigInt(slot?.oddsAmount ?? 0);
            if (slot) {
              slot.oddsAmount = 0n;
            }
            return { availableDelta: delta, inPlayDelta: -delta };
          }

          if (betType === BET_TYPES.DONT_COME_ODDS) {
            const slot = bets.dontCome[index];
            const delta = BigInt(slot?.oddsAmount ?? 0);
            if (slot) {
              slot.oddsAmount = 0n;
            }
            return { availableDelta: delta, inPlayDelta: -delta };
          }
        }),
      );
    },
    [executeTurnActions, queueTurnAction, turnModeEnabled],
  );

  const setPlaceWorking = useCallback(
    async (placeNumber: number, working: boolean) => {
      const placeBetType = (() => {
        switch (placeNumber) {
          case 4:
            return BET_TYPES.PLACE_4;
          case 5:
            return BET_TYPES.PLACE_5;
          case 6:
            return BET_TYPES.PLACE_6;
          case 8:
            return BET_TYPES.PLACE_8;
          case 9:
            return BET_TYPES.PLACE_9;
          case 10:
            return BET_TYPES.PLACE_10;
          default:
            return null;
        }
      })();

      if (turnModeEnabled) {
        if (placeBetType !== null) {
          queueTurnAction({ kind: 'SET_BOX_WORKING', betType: placeBetType, index: 0, amount: 0n, working });
        }
        return;
      }

      await executeTurnActions(
        working ? 'Turn place bet on' : 'Turn place bet off',
        placeBetType !== null ? [{ kind: 'SET_BOX_WORKING', betType: placeBetType, index: 0, amount: 0n, working }] : [],
        false,
      );

      if (placeBetType === null) {
        return;
      }

      setPlayerState((previous) =>
        applyLocalBetsUpdate(previous, (bets) => {
          const placeMeta = getPlaceToggleMeta(placeBetType);
          if (!placeMeta) {
            return;
          }

          bets[placeMeta.key] = {
            ...(bets[placeMeta.key] ?? { amount: 0n, working: false }),
            working,
          };
        }),
      );
    },
    [executeTurnActions, queueTurnAction, turnModeEnabled],
  );

  const setLayWorking = useCallback(
    async (layNumber: number, working: boolean) => {
      const layBetType = (() => {
        switch (layNumber) {
          case 4:
            return BET_TYPES.LAY_4;
          case 5:
            return BET_TYPES.LAY_5;
          case 6:
            return BET_TYPES.LAY_6;
          case 8:
            return BET_TYPES.LAY_8;
          case 9:
            return BET_TYPES.LAY_9;
          case 10:
            return BET_TYPES.LAY_10;
          default:
            return null;
        }
      })();

      if (turnModeEnabled) {
        if (layBetType !== null) {
          queueTurnAction({ kind: 'SET_BOX_WORKING', betType: layBetType, index: 0, amount: 0n, working });
        }
        return;
      }

      await executeTurnActions(
        working ? 'Turn lay bet on' : 'Turn lay bet off',
        layBetType !== null ? [{ kind: 'SET_BOX_WORKING', betType: layBetType, index: 0, amount: 0n, working }] : [],
        false,
      );

      if (layBetType === null) {
        return;
      }

      setPlayerState((previous) =>
        applyLocalBetsUpdate(previous, (bets) => {
          const layMeta = getLayToggleMeta(layBetType);
          if (!layMeta) {
            return;
          }

          bets[layMeta.key] = {
            ...(bets[layMeta.key] ?? { amount: 0n, working: false }),
            working,
          };
        }),
      );
    },
    [executeTurnActions, queueTurnAction, turnModeEnabled],
  );

  useWatchContractEvent({
    address: contractAddress,
    abi: crapsGameAbi,
    enabled: Boolean(publicClient && contractAddress && address),
    poll: true,
    pollingInterval: 4_000,
    onLogs: (logs) => {
      let shouldRefresh = false;
      let forceClearPendingSync = false;

      logs.forEach((log: any) => {
        const player = log.args?.player as Address | undefined;
        if (!player || !address || player.toLowerCase() !== address.toLowerCase()) {
          return;
        }

        shouldRefresh = true;

        if (log.eventName === 'SessionOpened') {
          setPlayerState((previous) => ({
            ...(previous ?? EMPTY_PLAYER_STATE),
            phase: SESSION_PHASE.COME_OUT,
            point: 0,
            pendingRequestId: 0n,
            lastActivityTime: Math.floor(Date.now() / 1000),
          }));
        }

        if (log.eventName === 'SessionClosed' || log.eventName === 'SessionExpired') {
          forceClearPendingSync = true;
          setQueuedTurnActions([]);
          setPendingRollActions([]);
          setPlayerState((previous) => ({
            ...(previous ?? EMPTY_PLAYER_STATE),
            phase: SESSION_PHASE.INACTIVE,
            point: 0,
            pendingRequestId: 0n,
            inPlay: 0n,
            reserved: 0n,
            bets: EMPTY_BETS,
          }));
        }

        if (log.eventName === 'RollRequested') {
          setIsRolling(true);
          setSuppressPendingSync(false);
          observedPendingRequestIdRef.current = BigInt(log.args?.requestId ?? 0);
          setPlayerState((previous) =>
            previous
              ? {
                  ...previous,
                  phase: SESSION_PHASE.ROLL_PENDING,
                  pendingRequestId: BigInt(log.args?.requestId ?? previous.pendingRequestId ?? 0),
                  lastActivityTime: Math.floor(Date.now() / 1000),
                }
              : previous,
          );
        }

        if (log.eventName === 'RollResolved') {
          forceClearPendingSync = true;
          setPendingRollActions([]);
          setOptimisticRollPending(false);
          setSuppressPendingSync(true);
          setPlayerState((previous) =>
            previous
              ? {
                  ...previous,
                  phase: previous.point === 0 ? SESSION_PHASE.COME_OUT : SESSION_PHASE.POINT,
                  pendingRequestId: 0n,
                  reserved: 0n,
                  lastActivityTime: Math.floor(Date.now() / 1000),
                }
              : previous,
          );
          appendResolvedRoll({
            id: `${String(log.args?.requestId ?? 0)}-${String(log.blockNumber ?? Date.now())}`,
            requestId: BigInt(log.args?.requestId ?? 0),
            die1: Number(log.args?.die1 ?? 0),
            die2: Number(log.args?.die2 ?? 0),
            payout: BigInt(log.args?.payout ?? 0),
            at: Date.now(),
          });
          setIsRolling(false);
          observedPendingRequestIdRef.current = null;
          void syncPlayerStateAfterResolution();
        }

        if (log.eventName === 'SessionExpired') {
          setIsRolling(false);
          setOptimisticRollPending(false);
          setSuppressPendingSync(false);
          observedPendingRequestIdRef.current = null;
        }
      });

      if (shouldRefresh) {
        void refresh();
        if (forceClearPendingSync) {
          void syncPlayerStateAfterResolution();
        } else {
          void syncPlayerStateFromChain({ preservePending: true });
        }
        void syncRollHistoryFromChain();
      }
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!address || !contractAddress) {
        return;
      }

      void refresh();
      void syncRollHistoryFromChain();
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [address, contractAddress, refresh, syncRollHistoryFromChain]);

  useEffect(() => {
    if (!address || !contractAddress || !publicClient) {
      return;
    }

    void syncRollHistoryFromChain();
  }, [address, contractAddress, publicClient, syncRollHistoryFromChain]);

  useEffect(() => {
    if (!address || !contractAddress || !publicClient) {
      return;
    }

    if (!isRolling && playerState?.phase !== SESSION_PHASE.ROLL_PENDING) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled) {
        return;
      }

      await refresh();
      const latestState = await readPlayerStateFromChain();

      if (cancelled || !latestState) {
        return;
      }


      if (latestState.phase !== SESSION_PHASE.ROLL_PENDING) {
        if (observedPendingRequestIdRef.current !== null) {
        } else {
          setIsRolling(false);
          setOptimisticRollPending(false);
          setPendingRollActions([]);
          applyPlayerStateSnapshot(latestState, { preservePending: false });
          await syncRollHistoryAfterSettlement();
          return;
        }
      } else {
        applyPlayerStateSnapshot(latestState, { preservePending: true });
      }

      if (cancelled) {
        return;
      }

      await syncResolvedRollForPendingRequest();
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 2_500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    address,
    applyPlayerStateSnapshot,
    contractAddress,
    isRolling,
    playerState?.phase,
    publicClient,
    readPlayerStateFromChain,
    refresh,
    syncResolvedRollForPendingRequest,
    syncRollHistoryAfterSettlement,
  ]);

  useEffect(() => {
    if (!playerState) {
      return;
    }


    if (playerState.phase === SESSION_PHASE.INACTIVE && !optimisticRollPending) {
      setRollHistory([]);
      setLastResolvedRoll(null);
      setIsRolling(false);
      setSuppressPendingSync(false);
      setPendingRollActions([]);
    }

    if (playerState.phase !== SESSION_PHASE.ROLL_PENDING && !optimisticRollPending) {
      setIsRolling(false);
      setPendingRollActions([]);
    }
  }, [optimisticRollPending, playerState]);

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
    faucetMaxRequestAmount: network.faucetMaxRequestAmount,
    canRequestFaucet,
    playerState: displayPlayerState,
    rollHistory,
    lastResolvedRoll,
    refresh,
    isRolling: isRolling || playerState?.phase === SESSION_PHASE.ROLL_PENDING,
    isBusy:
      txState.busy ||
      playerStateQuery.isFetching ||
      walletBalanceQuery.isFetching ||
      allowanceQuery.isFetching,
    isTxPending: txState.busy,
    txLabel: txState.label,
    txHash: txState.hash,
    error: txState.error,
    clearError: () => setTxState((previous) => ({ ...previous, error: undefined })),
    switchToBaseSepolia,
    deposit,
    withdraw,
    approveMax,
    requestFaucet,
    closeSession,
    placeBet,
    placeIndexedBet,
    removeBet,
    removeIndexedBet,
    setPlaceWorking,
    setLayWorking,
    setTurnModeEnabled: setComposerMode,
    clearQueuedTurn,
    turnModeEnabled,
    queuedTurnActions,
    rollDice,
    selfExclude,
    requestSelfReinstatement,
    completeSelfReinstatement,
  };
};

