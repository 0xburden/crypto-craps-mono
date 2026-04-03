import { DEPOSIT_FEE_BPS } from '../config/contracts';

export const BET_TYPES = {
  PASS_LINE: 0,
  PASS_LINE_ODDS: 1,
  DONT_PASS: 2,
  DONT_PASS_ODDS: 3,
  COME: 4,
  COME_ODDS: 5,
  DONT_COME: 6,
  DONT_COME_ODDS: 7,
  PLACE_4: 8,
  PLACE_5: 9,
  PLACE_6: 10,
  PLACE_8: 11,
  PLACE_9: 12,
  PLACE_10: 13,
  FIELD: 14,
  HARD_4: 15,
  HARD_6: 16,
  HARD_8: 17,
  HARD_10: 18,
  ANY_7: 19,
  ANY_CRAPS: 20,
  CRAPS_2: 21,
  CRAPS_3: 22,
  YO: 23,
  TWELVE: 24,
  HORN: 25,
} as const;

export const SESSION_PHASE = {
  INACTIVE: 0,
  COME_OUT: 1,
  POINT: 2,
  ROLL_PENDING: 3,
} as const;

export const PUCK_STATE = {
  OFF: 0,
  ON: 1,
} as const;

export type BetTypeId = (typeof BET_TYPES)[keyof typeof BET_TYPES];

export interface NormalizedPlayerState {
  phase: number;
  puckState: number;
  point: number;
  lastActivityTime: number;
  pendingRequestId: bigint;
  available: bigint;
  inPlay: bigint;
  reserved: bigint;
  bankroll: bigint;
  totalBankroll: bigint;
  initialBankroll: bigint;
  accruedFees: bigint;
  paused: boolean;
  selfExcluded: boolean;
  operatorExcluded: boolean;
  reinstatementEligibleAt: bigint;
  bets: any;
}

export interface RollHistoryEntry {
  id: string;
  requestId: bigint;
  die1: number;
  die2: number;
  payout: bigint;
  at: number;
}

export interface BetInputRule {
  minAdditional: bigint;
  maxAdditional: bigint;
  step: bigint;
  note: string;
}

export interface BetDefinition {
  label: string;
  betType: BetTypeId;
  minTotal: bigint;
  maxTotal: bigint;
  multiple: bigint;
  category: 'line' | 'odds' | 'place' | 'field' | 'hardway' | 'prop';
  number?: number;
  shortLabel?: string;
}

const USD = 1_000_000n;

export const BET_DEFINITIONS: Record<string, BetDefinition> = {
  PASS_LINE: {
    label: 'Pass Line',
    betType: BET_TYPES.PASS_LINE,
    minTotal: 1n * USD,
    maxTotal: 500n * USD,
    multiple: 1n,
    category: 'line',
  },
  PASS_LINE_ODDS: {
    label: 'Pass Odds',
    betType: BET_TYPES.PASS_LINE_ODDS,
    minTotal: 1n,
    maxTotal: 0n,
    multiple: 1n,
    category: 'odds',
  },
  DONT_PASS: {
    label: "Don't Pass",
    betType: BET_TYPES.DONT_PASS,
    minTotal: 1n * USD,
    maxTotal: 500n * USD,
    multiple: 1n,
    category: 'line',
  },
  DONT_PASS_ODDS: {
    label: "Don't Pass Odds",
    betType: BET_TYPES.DONT_PASS_ODDS,
    minTotal: 1n,
    maxTotal: 0n,
    multiple: 1n,
    category: 'odds',
  },
  COME: {
    label: 'Come',
    betType: BET_TYPES.COME,
    minTotal: 1n * USD,
    maxTotal: 500n * USD,
    multiple: 1n,
    category: 'line',
  },
  COME_ODDS: {
    label: 'Come Odds',
    betType: BET_TYPES.COME_ODDS,
    minTotal: 1n,
    maxTotal: 0n,
    multiple: 1n,
    category: 'odds',
  },
  DONT_COME: {
    label: "Don't Come",
    betType: BET_TYPES.DONT_COME,
    minTotal: 1n * USD,
    maxTotal: 500n * USD,
    multiple: 1n,
    category: 'line',
  },
  DONT_COME_ODDS: {
    label: "Don't Come Odds",
    betType: BET_TYPES.DONT_COME_ODDS,
    minTotal: 1n,
    maxTotal: 0n,
    multiple: 1n,
    category: 'odds',
  },
  PLACE_4: {
    label: 'Place 4',
    shortLabel: 'P4',
    betType: BET_TYPES.PLACE_4,
    minTotal: 5n * USD,
    maxTotal: 500n * USD,
    multiple: 5n * USD,
    category: 'place',
    number: 4,
  },
  PLACE_5: {
    label: 'Place 5',
    shortLabel: 'P5',
    betType: BET_TYPES.PLACE_5,
    minTotal: 5n * USD,
    maxTotal: 500n * USD,
    multiple: 5n * USD,
    category: 'place',
    number: 5,
  },
  PLACE_6: {
    label: 'Place 6',
    shortLabel: 'P6',
    betType: BET_TYPES.PLACE_6,
    minTotal: 6n * USD,
    maxTotal: 500n * USD,
    multiple: 6n * USD,
    category: 'place',
    number: 6,
  },
  PLACE_8: {
    label: 'Place 8',
    shortLabel: 'P8',
    betType: BET_TYPES.PLACE_8,
    minTotal: 6n * USD,
    maxTotal: 500n * USD,
    multiple: 6n * USD,
    category: 'place',
    number: 8,
  },
  PLACE_9: {
    label: 'Place 9',
    shortLabel: 'P9',
    betType: BET_TYPES.PLACE_9,
    minTotal: 5n * USD,
    maxTotal: 500n * USD,
    multiple: 5n * USD,
    category: 'place',
    number: 9,
  },
  PLACE_10: {
    label: 'Place 10',
    shortLabel: 'P10',
    betType: BET_TYPES.PLACE_10,
    minTotal: 5n * USD,
    maxTotal: 500n * USD,
    multiple: 5n * USD,
    category: 'place',
    number: 10,
  },
  FIELD: {
    label: 'Field',
    betType: BET_TYPES.FIELD,
    minTotal: 1n * USD,
    maxTotal: 500n * USD,
    multiple: 1n,
    category: 'field',
  },
  HARD_4: {
    label: 'Hard 4',
    shortLabel: 'H4',
    betType: BET_TYPES.HARD_4,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'hardway',
    number: 4,
  },
  HARD_6: {
    label: 'Hard 6',
    shortLabel: 'H6',
    betType: BET_TYPES.HARD_6,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'hardway',
    number: 6,
  },
  HARD_8: {
    label: 'Hard 8',
    shortLabel: 'H8',
    betType: BET_TYPES.HARD_8,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'hardway',
    number: 8,
  },
  HARD_10: {
    label: 'Hard 10',
    shortLabel: 'H10',
    betType: BET_TYPES.HARD_10,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'hardway',
    number: 10,
  },
  ANY_7: {
    label: 'Any 7',
    betType: BET_TYPES.ANY_7,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'prop',
  },
  ANY_CRAPS: {
    label: 'Any Craps',
    betType: BET_TYPES.ANY_CRAPS,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'prop',
  },
  CRAPS_2: {
    label: 'Craps 2',
    betType: BET_TYPES.CRAPS_2,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'prop',
  },
  CRAPS_3: {
    label: 'Craps 3',
    betType: BET_TYPES.CRAPS_3,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'prop',
  },
  YO: {
    label: 'Yo (11)',
    betType: BET_TYPES.YO,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'prop',
  },
  TWELVE: {
    label: 'Twelve',
    betType: BET_TYPES.TWELVE,
    minTotal: 1n * USD,
    maxTotal: 100n * USD,
    multiple: 1n,
    category: 'prop',
  },
  HORN: {
    label: 'Horn',
    betType: BET_TYPES.HORN,
    minTotal: 4n * USD,
    maxTotal: 100n * USD,
    multiple: 4n * USD,
    category: 'prop',
  },
};

export const PLACE_BETS = [
  BET_DEFINITIONS.PLACE_4,
  BET_DEFINITIONS.PLACE_5,
  BET_DEFINITIONS.PLACE_6,
  BET_DEFINITIONS.PLACE_8,
  BET_DEFINITIONS.PLACE_9,
  BET_DEFINITIONS.PLACE_10,
];

export const HARDWAY_BETS = [
  BET_DEFINITIONS.HARD_4,
  BET_DEFINITIONS.HARD_6,
  BET_DEFINITIONS.HARD_8,
  BET_DEFINITIONS.HARD_10,
];

export const PROP_BETS = [
  BET_DEFINITIONS.ANY_7,
  BET_DEFINITIONS.ANY_CRAPS,
  BET_DEFINITIONS.CRAPS_2,
  BET_DEFINITIONS.CRAPS_3,
  BET_DEFINITIONS.YO,
  BET_DEFINITIONS.TWELVE,
  BET_DEFINITIONS.HORN,
];

export const isExcluded = (state: NormalizedPlayerState | null) =>
  Boolean(state?.selfExcluded || state?.operatorExcluded);

export const getPuckLabel = (state: NormalizedPlayerState | null) => {
  if (!state || state.phase === SESSION_PHASE.INACTIVE) {
    return 'Inactive';
  }

  if (state.point === 0) {
    return 'OFF';
  }

  return `ON ${state.point}`;
};

export const getPhaseLabel = (phase: number | undefined) => {
  switch (phase) {
    case SESSION_PHASE.COME_OUT:
      return 'Come Out';
    case SESSION_PHASE.POINT:
      return 'Point';
    case SESSION_PHASE.ROLL_PENDING:
      return 'Roll Pending';
    default:
      return 'Inactive';
  }
};

export const calculateDepositPreview = (amount: bigint) => {
  const fee = (amount * BigInt(DEPOSIT_FEE_BPS)) / 10_000n;
  return {
    fee,
    credited: amount - fee,
  };
};

export const getOddsRequiredMultiple = (betType: BetTypeId, point: number) => {
  if (point === 4 || point === 10) {
    return betType === BET_TYPES.DONT_PASS_ODDS || betType === BET_TYPES.DONT_COME_ODDS
      ? 2n
      : 1n;
  }

  if (point === 5 || point === 9) {
    return betType === BET_TYPES.DONT_PASS_ODDS || betType === BET_TYPES.DONT_COME_ODDS
      ? 3n
      : 2n;
  }

  if (point === 6 || point === 8) {
    return betType === BET_TYPES.DONT_PASS_ODDS || betType === BET_TYPES.DONT_COME_ODDS
      ? 6n
      : 5n;
  }

  return 1n;
};

export const getBetInputRule = ({
  betType,
  currentAmount = 0n,
  flatAmount = 0n,
  point = 0,
}: {
  betType: BetTypeId;
  currentAmount?: bigint;
  flatAmount?: bigint;
  point?: number;
}): BetInputRule => {
  if (
    betType === BET_TYPES.PASS_LINE_ODDS ||
    betType === BET_TYPES.DONT_PASS_ODDS ||
    betType === BET_TYPES.COME_ODDS ||
    betType === BET_TYPES.DONT_COME_ODDS
  ) {
    const step = getOddsRequiredMultiple(betType, point);
    const maxAdditional = flatAmount > 0n ? flatAmount * 3n - currentAmount : 0n;
    return {
      minAdditional: step,
      maxAdditional: maxAdditional > 0n ? maxAdditional : 0n,
      step,
      note:
        flatAmount > 0n
          ? `Max total odds is 3× flat bet. Current point ${point || '—'} requires increments of ${step.toString()}.`
          : 'Place the flat bet first.',
    };
  }

  const definition = Object.values(BET_DEFINITIONS).find((entry) => entry.betType === betType);
  if (!definition) {
    return {
      minAdditional: 0n,
      maxAdditional: 0n,
      step: 1n,
      note: 'Unsupported bet type.',
    };
  }

  const minAdditional = currentAmount > 0n ? definition.multiple : definition.minTotal;
  const maxAdditional = definition.maxTotal - currentAmount;

  return {
    minAdditional: maxAdditional > 0n ? minAdditional : 0n,
    maxAdditional: maxAdditional > 0n ? maxAdditional : 0n,
    step: definition.multiple,
    note: `${definition.label}: min ${definition.minTotal.toString()} raw units, max ${definition.maxTotal.toString()} raw units.`,
  };
};
