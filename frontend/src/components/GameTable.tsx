import { useMemo, useState } from 'react';
import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import {
  BET_DEFINITIONS,
  BET_TYPES,
  HARDWAY_BETS,
  PLACE_BETS,
  PROP_BETS,
  SESSION_PHASE,
  getPuckLabel,
  isExcluded,
  type BetTypeId,
} from '../lib/craps';
import { formatUsd } from '../lib/format';
import { BetModal } from './BetModal';

interface GameTableProps {
  game: UseCrapsGameResult;
}

interface ModalState {
  title: string;
  description?: string;
  betType: BetTypeId;
  currentAmount?: bigint;
  flatAmount?: bigint;
  point?: number;
  index?: number;
}

export const GameTable = ({ game }: GameTableProps) => {
  const [modal, setModal] = useState<ModalState | null>(null);
  const state = game.playerState;
  const bets = state?.bets;
  const excluded = isExcluded(state);

  const comeSlots = useMemo(() => ((bets?.come ?? []) as any[]).slice(0, 4), [bets]);
  const dontComeSlots = useMemo(() => ((bets?.dontCome ?? []) as any[]).slice(0, 4), [bets]);

  const firstEmptyCome = comeSlots.findIndex((slot) => BigInt(slot?.amount ?? 0) === 0n);
  const firstEmptyDontCome = dontComeSlots.findIndex((slot) => BigInt(slot?.amount ?? 0) === 0n);

  const isTableBlocked = !game.isConnected || !state || state.phase === SESSION_PHASE.INACTIVE;

  const tableReason = (() => {
    if (!game.isConnected) return 'Connect wallet';
    if (!state || state.phase === SESSION_PHASE.INACTIVE) return 'Open a session';
    if (excluded) return 'Excluded from play';
    if (state.paused) return 'Table paused';
    if (state.phase === SESSION_PHASE.ROLL_PENDING) return 'Roll pending';
    return null;
  })();

  const openSimpleModal = (
    title: string,
    betType: BetTypeId,
    currentAmount = 0n,
    flatAmount = 0n,
    point = state?.point ?? 0,
    description?: string,
  ) => {
    setModal({ title, betType, currentAmount, flatAmount, point, description });
  };

  const openIndexedModal = (
    title: string,
    betType: BetTypeId,
    index: number,
    currentAmount = 0n,
    flatAmount = 0n,
    point = 0,
    description?: string,
  ) => {
    setModal({ title, betType, index, currentAmount, flatAmount, point, description });
  };

  const onConfirmModal = async (amount: bigint) => {
    if (!modal) {
      return;
    }

    if (typeof modal.index === 'number') {
      await game.placeIndexedBet(modal.betType, modal.index, amount);
      return;
    }

    await game.placeBet(modal.betType, amount);
  };

  return (
    <>
      <section className="felt-panel rounded-[2rem] p-5 lg:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/75">
              Betting surface
            </p>
            <h2 className="text-2xl font-semibold text-white">Single-player bubble craps</h2>
            <p className="mt-2 text-sm text-slate-300">
              Click a betting area to place chips. All interactions route through the shared hook and refresh from `getPlayerState`.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-200">
            <span className="status-pill bg-white/5 text-slate-200">Puck {getPuckLabel(state)}</span>
            <span className="status-pill bg-white/5 text-slate-200">
              Point {state?.point ? state.point : '—'}
            </span>
            <span className="status-pill bg-white/5 text-slate-200">
              In play {formatUsd(state?.inPlay)}
            </span>
          </div>
        </div>

        {tableReason && (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {tableReason}
          </div>
        )}

        <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <LineBetCard
                title="Pass Line"
                amount={BigInt(bets?.passLine?.amount ?? 0)}
                oddsAmount={BigInt(bets?.passLine?.oddsAmount ?? 0)}
                disabledReason={
                  tableReason ??
                  ((state?.point ?? 0) !== 0
                    ? 'Pass Line can only be placed on come-out.'
                    : BigInt(bets?.passLine?.amount ?? 0) > 0n
                      ? 'Pass Line is already active.'
                      : null)
                }
                onAdd={() => openSimpleModal('Pass Line', BET_TYPES.PASS_LINE, BigInt(bets?.passLine?.amount ?? 0))}
                onAddOdds={() =>
                  openSimpleModal(
                    'Pass Line Odds',
                    BET_TYPES.PASS_LINE_ODDS,
                    BigInt(bets?.passLine?.oddsAmount ?? 0),
                    BigInt(bets?.passLine?.amount ?? 0),
                    state?.point ?? 0,
                    'Odds can be added once a point is established.',
                  )
                }
                onRemoveOdds={
                  BigInt(bets?.passLine?.oddsAmount ?? 0) > 0n
                    ? () => void game.removeBet(BET_TYPES.PASS_LINE_ODDS)
                    : undefined
                }
                canAddOdds={Boolean(
                  !tableReason &&
                    (state?.point ?? 0) !== 0 &&
                    BigInt(bets?.passLine?.amount ?? 0) > 0n,
                )}
                lockLabel="Flat bet locks once placed"
              />

              <LineBetCard
                title="Don't Pass"
                amount={BigInt(bets?.dontPass?.amount ?? 0)}
                oddsAmount={BigInt(bets?.dontPass?.oddsAmount ?? 0)}
                disabledReason={
                  tableReason ??
                  ((state?.point ?? 0) !== 0
                    ? "Don't Pass can only be placed on come-out."
                    : BigInt(bets?.dontPass?.amount ?? 0) > 0n
                      ? "Don't Pass is already active."
                      : null)
                }
                onAdd={() => openSimpleModal("Don't Pass", BET_TYPES.DONT_PASS, BigInt(bets?.dontPass?.amount ?? 0))}
                onAddOdds={() =>
                  openSimpleModal(
                    "Don't Pass Odds",
                    BET_TYPES.DONT_PASS_ODDS,
                    BigInt(bets?.dontPass?.oddsAmount ?? 0),
                    BigInt(bets?.dontPass?.amount ?? 0),
                    state?.point ?? 0,
                    'Lay odds after the point is on.',
                  )
                }
                onRemove={() => void game.removeBet(BET_TYPES.DONT_PASS)}
                onRemoveOdds={
                  BigInt(bets?.dontPass?.oddsAmount ?? 0) > 0n
                    ? () => void game.removeBet(BET_TYPES.DONT_PASS_ODDS)
                    : undefined
                }
                canAddOdds={Boolean(
                  !tableReason &&
                    (state?.point ?? 0) !== 0 &&
                    BigInt(bets?.dontPass?.amount ?? 0) > 0n,
                )}
              />
            </div>

            <div className="bet-card bet-card--active">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Come / Don’t Come ladder</h3>
                  <p className="mt-1 text-sm text-slate-300">
                    Four fixed slots each. Empty slots highlight the next open seat.
                  </p>
                </div>
                <span className="status-pill bg-white/5 text-slate-200">4 slots each</span>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <SlotColumn
                  title="Come"
                  slots={comeSlots}
                  firstEmptyIndex={firstEmptyCome}
                  disabledReason={tableReason ?? ((state?.point ?? 0) === 0 ? 'Come bets require puck ON.' : null)}
                  onAddSlot={(index) =>
                    openSimpleModal(
                      `Come slot ${index + 1}`,
                      BET_TYPES.COME,
                      BigInt(comeSlots[index]?.amount ?? 0),
                    )
                  }
                  onAddOdds={(index, slot) =>
                    openIndexedModal(
                      `Come odds · slot ${index + 1}`,
                      BET_TYPES.COME_ODDS,
                      index,
                      BigInt(slot?.oddsAmount ?? 0),
                      BigInt(slot?.amount ?? 0),
                      Number(slot?.point ?? 0),
                    )
                  }
                  onRemoveOdds={(index) => void game.removeIndexedBet(BET_TYPES.COME_ODDS, index)}
                  showRemoveBase={false}
                />

                <SlotColumn
                  title="Don't Come"
                  slots={dontComeSlots}
                  firstEmptyIndex={firstEmptyDontCome}
                  disabledReason={tableReason ?? ((state?.point ?? 0) === 0 ? "Don't Come requires puck ON." : null)}
                  onAddSlot={(index) =>
                    openSimpleModal(
                      `Don't Come slot ${index + 1}`,
                      BET_TYPES.DONT_COME,
                      BigInt(dontComeSlots[index]?.amount ?? 0),
                    )
                  }
                  onAddOdds={(index, slot) =>
                    openIndexedModal(
                      `Don't Come odds · slot ${index + 1}`,
                      BET_TYPES.DONT_COME_ODDS,
                      index,
                      BigInt(slot?.oddsAmount ?? 0),
                      BigInt(slot?.amount ?? 0),
                      Number(slot?.point ?? 0),
                    )
                  }
                  onRemoveBase={(index) => void game.removeIndexedBet(BET_TYPES.DONT_COME, index)}
                  onRemoveOdds={(index) => void game.removeIndexedBet(BET_TYPES.DONT_COME_ODDS, index)}
                  showRemoveBase
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {PLACE_BETS.map((definition) => {
                const key = `place${definition.number}` as keyof typeof bets;
                const placeBet = (bets?.[key] ?? { amount: 0n, working: false }) as any;
                return (
                  <StackableBetCard
                    key={definition.betType}
                    title={definition.label}
                    amount={BigInt(placeBet.amount ?? 0)}
                    disabledReason={
                      tableReason ?? ((state?.point ?? 0) === 0 ? 'Place bets require puck ON.' : null)
                    }
                    onAdd={() =>
                      openSimpleModal(definition.label, definition.betType, BigInt(placeBet.amount ?? 0))
                    }
                    onRemove={
                      BigInt(placeBet.amount ?? 0) > 0n
                        ? () => void game.removeBet(definition.betType)
                        : undefined
                    }
                    footer={
                      BigInt(placeBet.amount ?? 0) > 0n ? (
                        <button
                          className="action-btn action-btn--secondary w-full"
                          onClick={() => void game.setPlaceWorking(definition.number ?? 0, !placeBet.working)}
                        >
                          {placeBet.working ? 'Turn OFF on hit' : 'Turn ON on hit'}
                        </button>
                      ) : null
                    }
                    badge={BigInt(placeBet.amount ?? 0) > 0n ? (placeBet.working ? 'Working' : 'OFF') : undefined}
                  />
                );
              })}
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <StackableBetCard
                title="Field"
                amount={BigInt(bets?.oneRolls?.field ?? 0)}
                disabledReason={tableReason}
                onAdd={() => openSimpleModal('Field', BET_TYPES.FIELD, BigInt(bets?.oneRolls?.field ?? 0))}
                onRemove={
                  BigInt(bets?.oneRolls?.field ?? 0) > 0n
                    ? () => void game.removeBet(BET_TYPES.FIELD)
                    : undefined
                }
              />
            </div>

            <div className="bet-card">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-white">Hardways</h3>
                <span className="status-pill bg-white/5 text-slate-200">Persistent</span>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {HARDWAY_BETS.map((definition) => {
                  const key = `hard${definition.number}` as keyof typeof bets;
                  const hardway = (bets?.[key] ?? { amount: 0n }) as any;
                  return (
                    <StackableBetCard
                      key={definition.betType}
                      compact
                      title={definition.label}
                      amount={BigInt(hardway.amount ?? 0)}
                      disabledReason={tableReason}
                      onAdd={() => openSimpleModal(definition.label, definition.betType, BigInt(hardway.amount ?? 0))}
                      onRemove={
                        BigInt(hardway.amount ?? 0) > 0n
                          ? () => void game.removeBet(definition.betType)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>

            <div className="bet-card">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-white">One-roll props</h3>
                <span className="status-pill bg-white/5 text-slate-200">Resolve next roll</span>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                {PROP_BETS.map((definition) => {
                  const propAmount = getPropAmount(definition.betType, bets);
                  return (
                    <StackableBetCard
                      key={definition.betType}
                      compact
                      title={definition.label}
                      amount={propAmount}
                      disabledReason={tableReason}
                      onAdd={() => openSimpleModal(definition.label, definition.betType, propAmount)}
                      onRemove={
                        propAmount > 0n ? () => void game.removeBet(definition.betType) : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {modal && (
        <BetModal
          open={Boolean(modal)}
          title={modal.title}
          description={modal.description}
          betType={modal.betType}
          currentAmount={modal.currentAmount}
          flatAmount={modal.flatAmount}
          point={modal.point}
          onClose={() => setModal(null)}
          onConfirm={onConfirmModal}
        />
      )}
    </>
  );
};

const LineBetCard = ({
  title,
  amount,
  oddsAmount,
  disabledReason,
  canAddOdds,
  lockLabel,
  onAdd,
  onAddOdds,
  onRemove,
  onRemoveOdds,
}: {
  title: string;
  amount: bigint;
  oddsAmount: bigint;
  disabledReason: string | null;
  canAddOdds: boolean;
  lockLabel?: string;
  onAdd: () => void;
  onAddOdds: () => void;
  onRemove?: () => void;
  onRemoveOdds?: () => void;
}) => (
  <div className={`bet-card ${amount > 0n ? 'bet-card--active' : ''} ${disabledReason ? 'bet-card--disabled' : ''}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-300">Flat {formatUsd(amount)} · Odds {formatUsd(oddsAmount)}</p>
      </div>
      {amount > 0n && <span className="chip-badge">Live</span>}
    </div>
    {lockLabel && <p className="mt-3 text-xs text-slate-400">{lockLabel}</p>}
    {disabledReason && <p className="mt-3 text-xs text-amber-200">{disabledReason}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button className="action-btn action-btn--primary" disabled={Boolean(disabledReason)} onClick={onAdd}>
        {amount > 0n ? 'View flat' : 'Add flat'}
      </button>
      <button className="action-btn action-btn--secondary" disabled={!canAddOdds} onClick={onAddOdds}>
        Add odds
      </button>
      {onRemove && amount > 0n && (
        <button className="action-btn action-btn--danger" onClick={onRemove}>
          Remove bet
        </button>
      )}
      {onRemoveOdds && oddsAmount > 0n && (
        <button className="action-btn action-btn--warning" onClick={onRemoveOdds}>
          Remove odds
        </button>
      )}
    </div>
  </div>
);

const SlotColumn = ({
  title,
  slots,
  firstEmptyIndex,
  disabledReason,
  onAddSlot,
  onAddOdds,
  onRemoveBase,
  onRemoveOdds,
  showRemoveBase,
}: {
  title: string;
  slots: any[];
  firstEmptyIndex: number;
  disabledReason: string | null;
  onAddSlot: (index: number) => void;
  onAddOdds: (index: number, slot: any) => void;
  onRemoveBase?: (index: number) => void;
  onRemoveOdds?: (index: number) => void;
  showRemoveBase: boolean;
}) => (
  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
    <div className="flex items-center justify-between gap-3">
      <h4 className="font-semibold text-white">{title}</h4>
      <span className="text-xs text-slate-400">Next open #{firstEmptyIndex >= 0 ? firstEmptyIndex + 1 : '—'}</span>
    </div>
    <div className="mt-4 space-y-3">
      {slots.map((slot, index) => {
        const amount = BigInt(slot?.amount ?? 0);
        const oddsAmount = BigInt(slot?.oddsAmount ?? 0);
        const point = Number(slot?.point ?? 0);
        const isEmpty = amount === 0n;
        const isFirstEmpty = index === firstEmptyIndex;
        const canAddHere = isEmpty && isFirstEmpty && !disabledReason;
        const canAddOdds = !isEmpty && point !== 0 && !disabledReason;

        return (
          <div key={`${title}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-white">Slot {index + 1}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {isEmpty ? 'Empty' : `Base ${formatUsd(amount)} · ${point === 0 ? 'Traveling' : `Point ${point}`}`}
                </p>
                {!isEmpty && <p className="mt-1 text-xs text-slate-400">Odds {formatUsd(oddsAmount)}</p>}
              </div>
              {!isEmpty && <span className="chip-badge">Live</span>}
            </div>
            {disabledReason && <p className="mt-2 text-xs text-amber-200">{disabledReason}</p>}
            {isEmpty && !isFirstEmpty && <p className="mt-2 text-xs text-slate-400">Fill the next open slot first.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="action-btn action-btn--primary"
                disabled={!canAddHere}
                onClick={() => onAddSlot(index)}
              >
                {isEmpty ? 'Add base' : 'Base locked'}
              </button>
              <button
                className="action-btn action-btn--secondary"
                disabled={!canAddOdds}
                onClick={() => onAddOdds(index, slot)}
              >
                Add odds
              </button>
              {showRemoveBase && !isEmpty && onRemoveBase && (
                <button className="action-btn action-btn--danger" onClick={() => onRemoveBase(index)}>
                  Remove base
                </button>
              )}
              {!isEmpty && oddsAmount > 0n && onRemoveOdds && (
                <button className="action-btn action-btn--warning" onClick={() => onRemoveOdds(index)}>
                  Remove odds
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const StackableBetCard = ({
  title,
  amount,
  disabledReason,
  onAdd,
  onRemove,
  footer,
  badge,
  compact = false,
}: {
  title: string;
  amount: bigint;
  disabledReason: string | null;
  onAdd: () => void;
  onRemove?: () => void;
  footer?: React.ReactNode;
  badge?: string;
  compact?: boolean;
}) => (
  <div className={`bet-card ${amount > 0n ? 'bet-card--active' : ''} ${disabledReason ? 'bet-card--disabled' : ''}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <h4 className={`${compact ? 'text-base' : 'text-lg'} font-semibold text-white`}>{title}</h4>
        <p className="mt-1 text-sm text-slate-300">Current {formatUsd(amount)}</p>
      </div>
      {badge ? <span className="chip-badge">{badge}</span> : amount > 0n ? <span className="chip-badge">Live</span> : null}
    </div>
    {disabledReason && <p className="mt-3 text-xs text-amber-200">{disabledReason}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button className="action-btn action-btn--primary" disabled={Boolean(disabledReason)} onClick={onAdd}>
        {amount > 0n ? 'Add chips' : 'Place bet'}
      </button>
      {onRemove && amount > 0n && (
        <button className="action-btn action-btn--danger" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
    {footer && <div className="mt-3">{footer}</div>}
  </div>
);

const getPropAmount = (betType: BetTypeId, bets: any) => {
  switch (betType) {
    case BET_TYPES.ANY_7:
      return BigInt(bets?.oneRolls?.any7 ?? 0);
    case BET_TYPES.ANY_CRAPS:
      return BigInt(bets?.oneRolls?.anyCraps ?? 0);
    case BET_TYPES.CRAPS_2:
      return BigInt(bets?.oneRolls?.craps2 ?? 0);
    case BET_TYPES.CRAPS_3:
      return BigInt(bets?.oneRolls?.craps3 ?? 0);
    case BET_TYPES.YO:
      return BigInt(bets?.oneRolls?.yo ?? 0);
    case BET_TYPES.TWELVE:
      return BigInt(bets?.oneRolls?.twelve ?? 0);
    case BET_TYPES.HORN:
      return BigInt(bets?.oneRolls?.horn ?? 0);
    default:
      return 0n;
  }
};
