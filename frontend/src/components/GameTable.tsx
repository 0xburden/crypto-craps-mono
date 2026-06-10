import { useMemo, useState } from 'react';
import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import {
  BET_TYPES,
  HARDWAY_BETS,
  LAY_BETS,
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

interface TableSlot {
  amount: bigint;
  oddsAmount: bigint;
  point: number;
}

interface SelectedBetAction {
  key: string;
  title: string;
  subtitle: string;
  amount: bigint;
  secondaryLabel?: string;
  secondaryAmount?: bigint;
  status: string;
  rule: string;
  disabledReason: string | null;
  placeLabel?: string;
  onPlace?: () => void;
  onOdds?: () => void;
  oddsLabel?: string;
  oddsDisabledReason?: string | null;
  onRemove?: () => void;
  removeLabel?: string;
  onRemoveOdds?: () => void;
  onToggleWorking?: () => void;
  toggleLabel?: string;
}

const PROP_ORDER = [
  BET_TYPES.CRAPS_2,
  BET_TYPES.CRAPS_3,
  BET_TYPES.ANY_CRAPS,
  BET_TYPES.HORN,
  BET_TYPES.YO,
  BET_TYPES.TWELVE,
  BET_TYPES.ANY_7,
] as const;

export const GameTable = ({ game }: GameTableProps) => {
  const [modal, setModal] = useState<ModalState | null>(null);
  const [selectedBetKey, setSelectedBetKey] = useState('pass-line');
  const state = game.playerState;
  const bets = state?.bets;
  const excluded = isExcluded(state);

  const comeSlots = useMemo(
    () => ((bets?.come ?? []) as unknown[]).slice(0, 4).map(normalizeSlot),
    [bets],
  );
  const dontComeSlots = useMemo(
    () => ((bets?.dontCome ?? []) as unknown[]).slice(0, 4).map(normalizeSlot),
    [bets],
  );

  const firstEmptyCome = comeSlots.findIndex((slot) => slot.amount === 0n);
  const firstEmptyDontCome = dontComeSlots.findIndex((slot) => slot.amount === 0n);
  const passLineAmount = BigInt(bets?.passLine?.amount ?? 0);
  const passLineOdds = BigInt(bets?.passLine?.oddsAmount ?? 0);
  const dontPassAmount = BigInt(bets?.dontPass?.amount ?? 0);
  const dontPassOdds = BigInt(bets?.dontPass?.oddsAmount ?? 0);
  const point = state?.point ?? 0;
  const pointOn = point !== 0;
  const latestRoll = game.lastResolvedRoll;
  const latestTotal = latestRoll ? latestRoll.die1 + latestRoll.die2 : null;
  const guideSteps = [
    { label: '1 · Get chips', done: game.isConnected && Boolean(state) && (state?.available ?? 0n) > 0n },
    { label: '2 · Place chips', done: (state?.inPlay ?? 0n) > 0n },
    { label: '3 · Confirm turn', done: game.queuedTurnActions.length > 0 || state?.phase === SESSION_PHASE.ROLL_PENDING },
    { label: '4 · Roll', done: Boolean(latestRoll) },
  ];
  const hasQueuedTurn = game.queuedTurnActions.length > 0;
  const canRoll =
    game.isConnected &&
    state !== null &&
    state.phase !== SESSION_PHASE.ROLL_PENDING &&
    (state.inPlay > 0n || hasQueuedTurn) &&
    !excluded &&
    !state.paused;
  const rollButtonLabel = hasQueuedTurn ? 'Confirm & Roll' : 'Roll dice';

  const isTableBlocked = !game.isConnected || !state;
  const actionLocked = game.isTxPending;

  const tableReason = (() => {
    if (!game.isConnected) return 'Connect wallet';
    if (!state) return 'Loading table';
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

  const lineActions: SelectedBetAction[] = [
    {
      key: 'dont-pass',
      title: "Don't Pass Bar",
      subtitle: 'Line bet',
      amount: dontPassAmount,
      secondaryLabel: 'Odds',
      secondaryAmount: dontPassOdds,
      status: dontPassAmount > 0n ? 'LIVE' : 'OPEN',
      rule: pointOn ? "Don't Pass is locked after come-out. Add lay odds here if active." : "Wins on come-out 2/3, loses on 7/11, pushes on 12.",
      disabledReason: tableReason ?? (pointOn ? "Don't Pass can only be placed on come-out." : dontPassAmount > 0n ? "Don't Pass is already active." : null),
      placeLabel: dontPassAmount > 0n ? 'View flat bet' : "Place Don't Pass",
      onPlace: () => openSimpleModal("Don't Pass", BET_TYPES.DONT_PASS, dontPassAmount),
      onOdds: () => openSimpleModal("Don't Pass Odds", BET_TYPES.DONT_PASS_ODDS, dontPassOdds, dontPassAmount, state?.point ?? 0, 'Lay odds after the point is established.'),
      oddsLabel: 'Lay odds',
      oddsDisabledReason: !pointOn ? 'Odds unlock after point ON.' : dontPassAmount === 0n ? "Place Don't Pass first." : null,
      onRemove: dontPassAmount > 0n ? () => void game.removeBet(BET_TYPES.DONT_PASS) : undefined,
      removeLabel: 'Take down',
      onRemoveOdds: dontPassOdds > 0n ? () => void game.removeBet(BET_TYPES.DONT_PASS_ODDS) : undefined,
    },
    {
      key: 'pass-line',
      title: 'Pass Line',
      subtitle: 'Line bet',
      amount: passLineAmount,
      secondaryLabel: 'Odds',
      secondaryAmount: passLineOdds,
      status: passLineAmount > 0n ? 'LIVE' : 'OPEN',
      rule: pointOn ? 'Flat bet is locked. Add odds behind the active point.' : 'Wins on come-out 7/11. Loses on 2/3/12.',
      disabledReason: tableReason ?? (pointOn ? 'Pass Line can only be placed on come-out.' : passLineAmount > 0n ? 'Pass Line is already active.' : null),
      placeLabel: passLineAmount > 0n ? 'View flat bet' : 'Place Pass Line',
      onPlace: () => openSimpleModal('Pass Line', BET_TYPES.PASS_LINE, passLineAmount),
      onOdds: () => openSimpleModal('Pass Line Odds', BET_TYPES.PASS_LINE_ODDS, passLineOdds, passLineAmount, state?.point ?? 0, 'Odds can be added once a point is established.'),
      oddsLabel: 'Add odds',
      oddsDisabledReason: !pointOn ? 'Odds unlock after point ON.' : passLineAmount === 0n ? 'Place Pass Line first.' : null,
      onRemoveOdds: passLineOdds > 0n ? () => void game.removeBet(BET_TYPES.PASS_LINE_ODDS) : undefined,
    },
  ];

  const placeActions: SelectedBetAction[] = PLACE_BETS.map((definition) => {
    const key = `place${definition.number}` as keyof typeof bets;
    const placeBet = (bets?.[key] ?? { amount: 0n, working: false }) as { amount?: bigint; working?: boolean };
    const amount = BigInt(placeBet.amount ?? 0);
    const working = Boolean(placeBet.working);
    return {
      key: `place-${definition.number}`,
      title: definition.label,
      subtitle: 'Place number',
      amount,
      status: amount > 0n ? (working ? 'WORKING' : 'OFF') : 'NO CHIPS',
      rule: 'Pays when the number repeats. In V3, OFF place bets stay parked through every roll.',
      disabledReason: tableReason ?? (!pointOn ? 'Place bets require puck ON.' : null),
      placeLabel: amount > 0n ? 'Add chips' : 'Place chips',
      onPlace: () => openSimpleModal(definition.label, definition.betType, amount),
      onRemove: amount > 0n ? () => void game.removeBet(definition.betType) : undefined,
      removeLabel: 'Take down',
      onToggleWorking: amount > 0n ? () => void game.setPlaceWorking(definition.number ?? 0, !working) : undefined,
      toggleLabel: working ? 'Turn OFF' : 'Make working',
    };
  });

  const layActions: SelectedBetAction[] = LAY_BETS.map((definition) => {
    const key = `lay${definition.number}` as keyof typeof bets;
    const layBet = (bets?.[key] ?? { amount: 0n, working: false }) as { amount?: bigint; working?: boolean };
    const amount = BigInt(layBet.amount ?? 0);
    const working = Boolean(layBet.working);
    return {
      key: `lay-${definition.number}`,
      title: definition.label,
      subtitle: 'Lay number',
      amount,
      status: amount > 0n ? (working ? 'WORKING' : 'OFF') : 'NO CHIPS',
      rule: 'Wins on 7 before the number. In V3, OFF lay bets stay parked through every roll.',
      disabledReason: tableReason ?? (!pointOn ? 'Lay bets require puck ON.' : null),
      placeLabel: amount > 0n ? 'Add lay chips' : 'Lay chips',
      onPlace: () => openSimpleModal(definition.label, definition.betType, amount),
      onRemove: amount > 0n ? () => void game.removeBet(definition.betType) : undefined,
      removeLabel: 'Take down',
      onToggleWorking: amount > 0n ? () => void game.setLayWorking(definition.number ?? 0, !working) : undefined,
      toggleLabel: working ? 'Turn OFF' : 'Make working',
    };
  });

  const hardwayActions: SelectedBetAction[] = HARDWAY_BETS.map((definition) => {
    const key = `hard${definition.number}` as keyof typeof bets;
    const hardway = (bets?.[key] ?? { amount: 0n }) as { amount?: bigint };
    const amount = BigInt(hardway.amount ?? 0);
    return {
      key: `hard-${definition.number}`,
      title: definition.label,
      subtitle: 'Hardway',
      amount,
      status: amount > 0n ? 'ALWAYS WORKING' : 'NO CHIPS',
      rule: `${definition.label} wins on the matching pair. Easy ${definition.number} or any 7 loses.`,
      disabledReason: tableReason,
      placeLabel: amount > 0n ? 'Add chips' : 'Place hardway',
      onPlace: () => openSimpleModal(definition.label, definition.betType, amount),
      onRemove: amount > 0n ? () => void game.removeBet(definition.betType) : undefined,
      removeLabel: 'Take down',
    };
  });

  const fieldAmount = BigInt(bets?.oneRolls?.field ?? 0);
  const fieldAction: SelectedBetAction = {
    key: 'field',
    title: 'Field',
    subtitle: 'One-roll bet',
    amount: fieldAmount,
    status: fieldAmount > 0n ? 'LIVE THIS ROLL' : 'NO CHIPS',
    rule: 'Wins on 2, 3, 4, 9, 10, 11, or 12. Clears after the next roll.',
    disabledReason: tableReason,
    placeLabel: fieldAmount > 0n ? 'Add chips' : 'Place field',
    onPlace: () => openSimpleModal('Field', BET_TYPES.FIELD, fieldAmount),
    onRemove: fieldAmount > 0n ? () => void game.removeBet(BET_TYPES.FIELD) : undefined,
    removeLabel: 'Take down',
  };

  const propActions: SelectedBetAction[] = PROP_ORDER.flatMap((betType) => {
    const definition = PROP_BETS.find((entry) => entry.betType === betType);
    if (!definition) return [];
    const amount = getPropAmount(definition.betType, bets);
    const rule = definition.betType === BET_TYPES.HORN
      ? 'Horn covers 2, 3, 11, and 12 for one roll.'
      : definition.betType === BET_TYPES.ANY_CRAPS
        ? 'Wins on 2, 3, or 12 for one roll.'
        : definition.betType === BET_TYPES.ANY_7
          ? 'Wins on any 7 for one roll.'
          : 'Single-roll proposition bet. Clears after the next roll.';
    return [{
      key: `prop-${definition.betType}`,
      title: definition.label,
      subtitle: 'Center action',
      amount,
      status: amount > 0n ? 'LIVE THIS ROLL' : 'NO CHIPS',
      rule,
      disabledReason: tableReason,
      placeLabel: amount > 0n ? 'Add chips' : 'Place prop',
      onPlace: () => openSimpleModal(definition.label, definition.betType, amount),
      onRemove: amount > 0n ? () => void game.removeBet(definition.betType) : undefined,
      removeLabel: 'Take down',
    }];
  });

  const selectedBet = [...lineActions, ...placeActions, ...layActions, fieldAction, ...hardwayActions, ...propActions]
    .find((action) => action.key === selectedBetKey) ?? lineActions[1];

  return (
    <>
      <section className="felt-panel craps-table-shell bubble-machine rounded-[2rem] p-3 sm:p-4 lg:p-5">
        <div className="machine-topper min-w-0">
          <div className="machine-marquee">
            <p className="machine-kicker">Bubble craps terminal</p>
            <h2>Tap a betting zone. Queue chips. Roll.</h2>
            <div className="machine-lamps" aria-label="Game prompts">
              <span className="machine-lamp machine-lamp--hot">V3 table</span>
              <span className="machine-lamp">OFF bets park</span>
              <span className="machine-lamp">VRF dice</span>
            </div>
          </div>

          <div className="dice-console min-w-0" aria-live="polite">
            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-emerald-100/70">Last roll</p>
            {latestRoll ? (
              <>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <span className="die-face">{latestRoll.die1}</span>
                  <span className="die-face">{latestRoll.die2}</span>
                </div>
                <p className="mt-2 text-sm text-slate-200">Total {latestTotal} · paid {formatUsd(latestRoll.payout)}</p>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-300">Ready for dice</p>
            )}
          </div>
        </div>

        <div className="machine-hud mt-3">
          <MiniStat label="Puck" value={getPuckLabel(state)} />
          <MiniStat label="Point" value={point ? point.toString() : '—'} />
          <MiniStat label="On table" value={formatUsd(state?.inPlay)} />
          <MiniStat label="Status" value={tableReason ?? (isTableBlocked ? 'Waiting' : 'Open')} />
        </div>

        {tableReason && (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {tableReason}
          </div>
        )}

        <div className="craps-surface mt-6 overflow-hidden rounded-[2rem] p-4 lg:p-5">
          <div className="craps-layout min-w-0">
            <div className="surface-print">
              <span>Tap zones to place chips</span>
              <span>Working bets glow</span>
              <span>Roll from the console</span>
            </div>

            <div>
              <div className="painted-banner painted-banner--rail mb-3">Pass line / don’t pass bar</div>
              <div className="line-grid">
              <LineZone
                title="Don't Pass Bar"
                subtitle="Come-out only · lay odds after point"
                amount={dontPassAmount}
                oddsAmount={dontPassOdds}
                disabledReason={
                  tableReason ??
                  (pointOn
                    ? "Don't Pass can only be placed on come-out."
                    : dontPassAmount > 0n
                      ? "Don't Pass is already active."
                      : null)
                }
                canAddOdds={Boolean(!tableReason && pointOn && dontPassAmount > 0n)}
                actionLocked={actionLocked}
                onAdd={() => setSelectedBetKey('dont-pass')}
                onAddOdds={() =>
                  openSimpleModal(
                    "Don't Pass Odds",
                    BET_TYPES.DONT_PASS_ODDS,
                    dontPassOdds,
                    dontPassAmount,
                    state?.point ?? 0,
                    'Lay odds after the point is established.',
                  )
                }
                onRemove={() => void game.removeBet(BET_TYPES.DONT_PASS)}
                onRemoveOdds={
                  dontPassOdds > 0n ? () => void game.removeBet(BET_TYPES.DONT_PASS_ODDS) : undefined
                }
                accent="rose"
                selected={selectedBet.key === 'dont-pass'}
              />

              <LineZone
                title="Pass Line"
                subtitle="Come-out only · back it with odds"
                amount={passLineAmount}
                oddsAmount={passLineOdds}
                disabledReason={
                  tableReason ??
                  (pointOn
                    ? 'Pass Line can only be placed on come-out.'
                    : passLineAmount > 0n
                      ? 'Pass Line is already active.'
                      : null)
                }
                canAddOdds={Boolean(!tableReason && pointOn && passLineAmount > 0n)}
                actionLocked={actionLocked}
                onAdd={() => setSelectedBetKey('pass-line')}
                onAddOdds={() =>
                  openSimpleModal(
                    'Pass Line Odds',
                    BET_TYPES.PASS_LINE_ODDS,
                    passLineOdds,
                    passLineAmount,
                    state?.point ?? 0,
                    'Odds can be added once a point is established.',
                  )
                }
                onRemoveOdds={
                  passLineOdds > 0n ? () => void game.removeBet(BET_TYPES.PASS_LINE_ODDS) : undefined
                }
                accent="gold"
                lockLabel="Flat bet locks once placed"
                selected={selectedBet.key === 'pass-line'}
              />
              </div>
            </div>

            <div className="craps-band">
              <div className="craps-band__header">
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.28em] text-slate-400">
                    Box numbers
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-white">Place numbers</h3>
                </div>
                <span className="status-pill bg-white/5 text-slate-200">4 · 5 · 6 · 8 · 9 · 10</span>
              </div>
              <div className="painted-banner mt-4">PLACE BETS</div>
              {!pointOn && !tableReason ? <p className="table-lockline">Place bets unlock after a point is ON.</p> : null}
              <div className="number-grid mt-3">
                {PLACE_BETS.map((definition) => {
                  const key = `place${definition.number}` as keyof typeof bets;
                  const placeBet = (bets?.[key] ?? { amount: 0n, working: false }) as {
                    amount?: bigint;
                    working?: boolean;
                  };
                  const amount = BigInt(placeBet.amount ?? 0);
                  const working = Boolean(placeBet.working);

                  return (
                    <PlaceNumberZone
                      key={definition.betType}
                      number={definition.number ?? 0}
                      amount={amount}
                      working={working}
                      isPoint={point === definition.number}
                      selected={selectedBet.key === `place-${definition.number}`}
                      disabledReason={tableReason ?? (!pointOn ? 'Place bets require puck ON.' : null)}
                      onAdd={() => setSelectedBetKey(`place-${definition.number}`)}
                      onRemove={amount > 0n ? () => void game.removeBet(definition.betType) : undefined}
                      actionLocked={actionLocked}
                      onToggleWorking={
                        amount > 0n
                          ? () => void game.setPlaceWorking(definition.number ?? 0, !working)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>

            <div className="craps-band">
              <div className="craps-band__header">
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.28em] text-slate-400">
                    Box numbers
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-white">Lay numbers</h3>
                </div>
                <span className="status-pill bg-white/5 text-slate-200">4 · 5 · 6 · 8 · 9 · 10</span>
              </div>
              <div className="painted-banner mt-4">LAY BETS</div>
              {!pointOn && !tableReason ? <p className="table-lockline">Lay bets unlock after a point is ON.</p> : null}
              <div className="number-grid mt-3">
                {LAY_BETS.map((definition) => {
                  const key = `lay${definition.number}` as keyof typeof bets;
                  const layBet = (bets?.[key] ?? { amount: 0n, working: false }) as {
                    amount?: bigint;
                    working?: boolean;
                  };
                  const amount = BigInt(layBet.amount ?? 0);
                  const working = Boolean(layBet.working);

                  return (
                    <PlaceNumberZone
                      key={definition.betType}
                      number={definition.number ?? 0}
                      amount={amount}
                      working={working}
                      isPoint={point === definition.number}
                      variant="lay"
                      selected={selectedBet.key === `lay-${definition.number}`}
                      disabledReason={tableReason ?? (!pointOn ? 'Lay bets require puck ON.' : null)}
                      onAdd={() => setSelectedBetKey(`lay-${definition.number}`)}
                      onRemove={amount > 0n ? () => void game.removeBet(definition.betType) : undefined}
                      actionLocked={actionLocked}
                      onToggleWorking={
                        amount > 0n
                          ? () => void game.setLayWorking(definition.number ?? 0, !working)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>

            <SlotTrack
              title="Don't Come Bar"
              subtitle="Lay behind the numbers once the puck is ON."
              tone="rose"
              slots={dontComeSlots}
              firstEmptyIndex={firstEmptyDontCome}
              disabledReason={tableReason ?? (!pointOn ? "Don't Come requires puck ON." : null)}
              onAddSlot={(index) =>
                openSimpleModal(
                  `Don't Come slot ${index + 1}`,
                  BET_TYPES.DONT_COME,
                  dontComeSlots[index]?.amount ?? 0n,
                )
              }
              onAddOdds={(index, slot) =>
                openIndexedModal(
                  `Don't Come odds · slot ${index + 1}`,
                  BET_TYPES.DONT_COME_ODDS,
                  index,
                  slot.oddsAmount,
                  slot.amount,
                  slot.point,
                  'Lay odds once the bet has traveled behind a point.',
                )
              }
              onRemoveBase={(index) => void game.removeIndexedBet(BET_TYPES.DONT_COME, index)}
              onRemoveOdds={(index) => void game.removeIndexedBet(BET_TYPES.DONT_COME_ODDS, index)}
              showRemoveBase
              actionLocked={actionLocked}
            />

            <SlotTrack
              title="Come"
              subtitle="Travel the next open slot, then back them with odds behind the point."
              tone="emerald"
              slots={comeSlots}
              firstEmptyIndex={firstEmptyCome}
              disabledReason={tableReason ?? (!pointOn ? 'Come bets require puck ON.' : null)}
              onAddSlot={(index) =>
                openSimpleModal(`Come slot ${index + 1}`, BET_TYPES.COME, comeSlots[index]?.amount ?? 0n)
              }
              onAddOdds={(index, slot) =>
                openIndexedModal(
                  `Come odds · slot ${index + 1}`,
                  BET_TYPES.COME_ODDS,
                  index,
                  slot.oddsAmount,
                  slot.amount,
                  slot.point,
                  'Odds are available after the come bet lands on a point.',
                )
              }
              onRemoveOdds={(index) => void game.removeIndexedBet(BET_TYPES.COME_ODDS, index)}
              showRemoveBase={false}
              actionLocked={actionLocked}
            />

            <div className="craps-band craps-band--field">
              <TableZone
                title="Field"
                subtitle="2 · 3 · 4 · 9 · 10 · 11 · 12"
                amount={BigInt(bets?.oneRolls?.field ?? 0)}
                disabledReason={tableReason}
                onAdd={() => setSelectedBetKey('field')}
                onRemove={
                  BigInt(bets?.oneRolls?.field ?? 0) > 0n
                    ? () => void game.removeBet(BET_TYPES.FIELD)
                    : undefined
                }
                accent="emerald"
                hero
                actionLocked={actionLocked}
                selected={selectedBet.key === 'field'}
              />
            </div>

            <div className="craps-band">
              <div className="craps-band__header">
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.28em] text-slate-400">
                    Inside numbers
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-white">Hardways</h3>
                </div>
                <span className="status-pill bg-white/5 text-slate-200">Persistent</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {HARDWAY_BETS.map((definition) => {
                  const key = `hard${definition.number}` as keyof typeof bets;
                  const hardway = (bets?.[key] ?? { amount: 0n }) as { amount?: bigint };
                  const amount = BigInt(hardway.amount ?? 0);

                  return (
                    <TableZone
                      key={definition.betType}
                      title={definition.label}
                      subtitle="Persistent"
                      amount={amount}
                      disabledReason={tableReason}
                      onAdd={() => setSelectedBetKey(`prop-${definition.betType}`)}
                      onRemove={amount > 0n ? () => void game.removeBet(definition.betType) : undefined}
                      accent="blue"
                      actionLocked={actionLocked}
                      selected={selectedBet.key === `hard-${definition.number}`}
                    />
                  );
                })}
              </div>
            </div>

            <div className="craps-band">
              <div className="craps-band__header">
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.28em] text-slate-400">
                    Center action
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-white">Proposition bets</h3>
                </div>
                <span className="status-pill bg-white/5 text-slate-200">One-roll heavy</span>
              </div>
              <div className="prop-grid mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
                {PROP_ORDER.map((betType) => {
                  const definition = PROP_BETS.find((entry) => entry.betType === betType);
                  if (!definition) {
                    return null;
                  }

                  const amount = getPropAmount(definition.betType, bets);
                  return (
                    <TableZone
                      key={definition.betType}
                      title={getPropDisplay(definition.betType).title}
                      subtitle={getPropDisplay(definition.betType).subtitle}
                      amount={amount}
                      disabledReason={tableReason}
                      onAdd={() => setSelectedBetKey(`prop-${definition.betType}`)}
                      onRemove={
                        amount > 0n ? () => void game.removeBet(definition.betType) : undefined
                      }
                      accent={definition.betType === BET_TYPES.ANY_7 ? 'rose' : 'gold'}
                      actionLocked={actionLocked}
                      compact
                      selected={selectedBet.key === `prop-${definition.betType}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <MachineConsole
          selectedBet={selectedBet}
          available={state?.available ?? 0n}
          queuedCount={game.queuedTurnActions.length}
          guideSteps={guideSteps}
          hasQueuedTurn={hasQueuedTurn}
          actionLocked={actionLocked}
          canRoll={canRoll}
          isRolling={game.isRolling}
          txLabel={game.txLabel}
          rollButtonLabel={rollButtonLabel}
          onClearQueue={game.clearQueuedTurn}
          onRoll={() => void game.rollDice()}
        />
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
          availableBalance={state?.available ?? 0n}
          isPending={game.isTxPending}
          submitLabel={game.turnModeEnabled ? 'Add to turn' : 'Confirm bet'}
          pendingLabel={game.txLabel === 'Place bet' || game.txLabel === 'Place indexed bet' ? 'Confirming…' : undefined}
          onClose={() => setModal(null)}
          onConfirm={onConfirmModal}
        />
      )}
    </>
  );
};

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
    <p className="truncate text-[0.68rem] uppercase tracking-[0.16em] text-slate-400">{label}</p>
    <p className="mt-1 break-words text-lg font-semibold leading-tight text-white">{value}</p>
  </div>
);

const TableZone = ({
  title,
  subtitle,
  amount,
  disabledReason,
  onAdd,
  onRemove,
  accent = 'gold',
  compact = false,
  hero = false,
  actionLocked = false,
  selected = false,
}: {
  title: string;
  subtitle: string;
  amount: bigint;
  disabledReason: string | null;
  onAdd: () => void;
  onRemove?: () => void;
  accent?: 'gold' | 'rose' | 'blue' | 'emerald';
  compact?: boolean;
  hero?: boolean;
  actionLocked?: boolean;
  selected?: boolean;
}) => {
  return (
    <div
      className={[
        'table-zone',
        `table-zone--${accent}`,
        amount > 0n ? 'table-zone--active' : '',
        disabledReason ? 'table-zone--disabled' : '',
        hero ? 'table-zone--hero' : '',
        selected ? 'table-zone--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button className="zone-hit-button zone-hit-button--felt" disabled={actionLocked} onClick={onAdd} aria-label={`${title}. ${subtitle}`}>
        <span className="zone-hit-button__copy">
          <span className={`zone-title ${compact ? 'zone-title--compact' : ''}`}>{title}</span>
          <span className="zone-state">{disabledReason ? 'LOCKED' : amount > 0n ? 'ACTIVE' : 'READY'}</span>
        </span>
        <span className="zone-hit-button__amount">
          <span className={hero ? 'text-2xl' : 'text-lg'}>{formatUsd(amount)}</span>
        </span>
      </button>
    </div>
  );
};

const PlaceNumberZone = ({
  number,
  amount,
  working,
  isPoint = false,
  disabledReason,
  onAdd,
  onRemove,
  onToggleWorking,
  actionLocked = false,
  variant = 'place',
  selected = false,
}: {
  number: number;
  amount: bigint;
  working: boolean;
  isPoint?: boolean;
  disabledReason: string | null;
  onAdd: () => void;
  onRemove?: () => void;
  onToggleWorking?: () => void;
  actionLocked?: boolean;
  variant?: 'place' | 'lay';
  selected?: boolean;
}) => {
  return (
    <div
      className={[
        'number-zone',
        amount > 0n ? 'number-zone--active' : '',
        amount > 0n && working ? 'number-zone--working' : '',
        amount > 0n && !working ? 'number-zone--off' : '',
        disabledReason ? 'number-zone--disabled' : '',
        selected ? 'number-zone--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button className="number-hit-button number-hit-button--felt" disabled={actionLocked} onClick={onAdd}>
        <span className={`number-zone__token number-zone__token--${getNumberTone(number)}`}>{number}</span>
        <span className="number-hit-button__copy">
          <span className="zone-state">{variant === 'lay' ? 'LAY' : 'PLACE'}</span>
          <span className="number-amount">{formatUsd(amount)}</span>
          <span className={`chip-badge ${amount > 0n ? (working ? 'chip-badge--working' : 'chip-badge--off') : ''}`}>
            {disabledReason ? 'LOCKED' : amount > 0n ? (working ? 'WORKING' : 'OFF') : 'READY'}
          </span>
        </span>
      </button>

      {isPoint ? <span className="puck-marker mt-3">PUCK ON</span> : null}
    </div>
  );
};

const LineZone = ({
  title,
  subtitle,
  amount,
  oddsAmount,
  disabledReason,
  canAddOdds,
  onAdd,
  onAddOdds,
  onRemove,
  onRemoveOdds,
  accent,
  lockLabel,
  actionLocked = false,
  selected = false,
}: {
  title: string;
  subtitle: string;
  amount: bigint;
  oddsAmount: bigint;
  disabledReason: string | null;
  canAddOdds: boolean;
  onAdd: () => void;
  onAddOdds: () => void;
  onRemove?: () => void;
  onRemoveOdds?: () => void;
  accent: 'gold' | 'rose';
  lockLabel?: string;
  actionLocked?: boolean;
  selected?: boolean;
}) => (
  <div
    className={[
      'line-zone',
      `line-zone--${accent}`,
      amount > 0n || oddsAmount > 0n ? 'line-zone--active' : '',
      disabledReason ? 'line-zone--disabled' : '',
      selected ? 'line-zone--selected' : '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    <div className="line-zone__content">
      <button className="zone-hit-button zone-hit-button--line" disabled={actionLocked} onClick={onAdd}>
        <span className="zone-hit-button__copy">
          <span className="zone-title">{title}</span>
          <span className="zone-state">{disabledReason ? 'LOCKED' : amount > 0n ? 'LIVE' : 'READY'}</span>
        </span>
        <span className="zone-hit-button__amount">
          <span>{formatUsd(amount)}</span>
          <span className="text-[0.68rem] uppercase tracking-[0.12em] text-emerald-100/70">Odds {formatUsd(oddsAmount)}</span>
        </span>
      </button>
    </div>
  </div>
);

const MachineConsole = ({
  selectedBet,
  available,
  queuedCount,
  guideSteps,
  hasQueuedTurn,
  actionLocked,
  canRoll,
  isRolling,
  txLabel,
  rollButtonLabel,
  onClearQueue,
  onRoll,
}: {
  selectedBet: SelectedBetAction;
  available: bigint;
  queuedCount: number;
  guideSteps: Array<{ label: string; done: boolean }>;
  hasQueuedTurn: boolean;
  actionLocked: boolean;
  canRoll: boolean;
  isRolling: boolean;
  txLabel?: string;
  rollButtonLabel: string;
  onClearQueue: () => void;
  onRoll: () => void;
}) => {
  const placeDisabled = Boolean(selectedBet.disabledReason) || actionLocked || !selectedBet.onPlace;
  const oddsDisabled = Boolean(selectedBet.oddsDisabledReason) || actionLocked || !selectedBet.onOdds;
  const rolling = isRolling || (actionLocked && (txLabel === 'Roll dice' || txLabel === 'Confirm & Roll'));

  return (
    <div className="machine-console machine-console--deck mt-4">
      <div className="machine-console__screen machine-console__screen--selected">
        <p className="text-[0.68rem] uppercase tracking-[0.18em] text-emerald-100/70">Selected bet</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-end gap-3">
          <p className="min-w-0 truncate text-3xl font-bold text-white">{selectedBet.title}</p>
          <span className="console-pill console-pill--hot">{selectedBet.status}</span>
          <span className="console-pill">{formatUsd(selectedBet.amount)}</span>
          {selectedBet.secondaryAmount !== undefined ? (
            <span className="console-pill">{selectedBet.secondaryLabel}: {formatUsd(selectedBet.secondaryAmount)}</span>
          ) : null}
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-emerald-50/75">{selectedBet.rule}</p>
        {selectedBet.disabledReason ? <p className="mt-2 text-xs font-bold text-amber-200">{selectedBet.disabledReason}</p> : null}
        {selectedBet.oddsDisabledReason ? <p className="mt-1 text-xs text-slate-400">{selectedBet.oddsDisabledReason}</p> : null}
      </div>

      <div className="machine-steps" aria-label="Bubble craps play steps">
        {guideSteps.map((step, index) => (
          <span key={step.label} className={`machine-step ${step.done ? 'machine-step--done' : ''}`}>
            <span>{step.label}</span>
            {index < guideSteps.length - 1 ? <span className="hidden text-slate-500 sm:inline">→</span> : null}
          </span>
        ))}
      </div>

      <div className="chip-rail" aria-label="Chip rail visual guide">
        <span className="console-pill">Available {formatUsd(available)}</span>
        {['$1', '$5', '$25', '$100'].map((chip) => (
          <span key={chip} className="chip-token">{chip}</span>
        ))}
        {queuedCount > 0 ? <span className="console-pill console-pill--hot">{queuedCount} queued</span> : null}
      </div>

      <div className="machine-console__actions">
        <button className="action-btn action-btn--primary" disabled={placeDisabled} onClick={selectedBet.onPlace}>
          {selectedBet.placeLabel ?? 'Place chips'}
        </button>
        {selectedBet.onOdds ? (
          <button className="action-btn action-btn--secondary" disabled={oddsDisabled} onClick={selectedBet.onOdds}>
            {selectedBet.oddsLabel ?? 'Odds'}
          </button>
        ) : null}
        {selectedBet.onToggleWorking ? (
          <button className="action-btn action-btn--warning" disabled={actionLocked} onClick={selectedBet.onToggleWorking}>
            {selectedBet.toggleLabel ?? 'Toggle'}
          </button>
        ) : null}
        {selectedBet.onRemove ? (
          <button className="action-btn action-btn--danger" disabled={actionLocked} onClick={selectedBet.onRemove}>
            {selectedBet.removeLabel ?? 'Take down'}
          </button>
        ) : null}
        {selectedBet.onRemoveOdds ? (
          <button className="action-btn action-btn--warning" disabled={actionLocked} onClick={selectedBet.onRemoveOdds}>
            Take odds
          </button>
        ) : null}
        <button className="action-btn action-btn--secondary" disabled={!hasQueuedTurn || actionLocked} onClick={onClearQueue}>
          Clear queued
        </button>
        <button className="action-btn action-btn--primary action-btn--roll" disabled={!canRoll || isRolling || actionLocked} onClick={onRoll}>
          {rolling ? (
            <>
              <span className="action-btn__spinner" aria-hidden="true" />
              Rolling…
            </>
          ) : (
            rollButtonLabel
          )}
        </button>
      </div>
    </div>
  );
};

const SlotTrack = ({
  title,
  subtitle,
  tone,
  slots,
  firstEmptyIndex,
  disabledReason,
  onAddSlot,
  onAddOdds,
  onRemoveBase,
  onRemoveOdds,
  showRemoveBase,
  actionLocked = false,
  selected = false,
}: {
  title: string;
  subtitle: string;
  tone: 'emerald' | 'rose';
  slots: TableSlot[];
  firstEmptyIndex: number;
  disabledReason: string | null;
  onAddSlot: (index: number) => void;
  onAddOdds: (index: number, slot: TableSlot) => void;
  onRemoveBase?: (index: number) => void;
  onRemoveOdds?: (index: number) => void;
  showRemoveBase: boolean;
  actionLocked?: boolean;
  selected?: boolean;
}) => (
  <div className={`slot-track slot-track--${tone} ${selected ? 'slot-track--selected' : ''}`}>
    <div className="craps-band__header min-w-0">
      <div className="min-w-0">
        <p className="text-[0.7rem] uppercase tracking-[0.28em] text-slate-400">Travel lane</p>
        <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
      </div>
      <span className="status-pill bg-white/5 text-slate-200">
        Next open #{firstEmptyIndex >= 0 ? firstEmptyIndex + 1 : '—'}
      </span>
    </div>
    <p className="mt-2 text-sm text-slate-300">{subtitle}</p>
    {disabledReason && <p className="mt-3 text-xs text-amber-200">{disabledReason}</p>}

    <div className="mt-4 grid gap-3 xl:grid-cols-4">
      {slots.map((slot, index) => {
        const isEmpty = slot.amount === 0n;
        const isFirstEmpty = index === firstEmptyIndex;
        const canAddHere = isEmpty && isFirstEmpty && !disabledReason && !actionLocked;
        const canAddOdds = !isEmpty && slot.point !== 0 && !disabledReason && !actionLocked;

        return (
          <div
            key={`${title}-${index}`}
            className={`slot-card ${slot.amount > 0n ? 'slot-card--active' : ''} ${isFirstEmpty ? 'slot-card--next' : ''}`}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Seat {index + 1}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                  {isEmpty ? 'Empty' : slot.point === 0 ? 'Traveling' : `Point ${slot.point}`}
                </p>
              </div>
              {!isEmpty && <span className="chip-badge">Live</span>}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="truncate text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Base</p>
                <p className="mt-1 break-words font-semibold text-white">{formatUsd(slot.amount)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="truncate text-[0.68rem] uppercase tracking-[0.18em] text-slate-400">Odds</p>
                <p className="mt-1 break-words font-semibold text-white">{formatUsd(slot.oddsAmount)}</p>
              </div>
            </div>

            {isEmpty && !isFirstEmpty && (
              <p className="mt-3 text-xs text-slate-400">Fill the next open seat first.</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
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
                <button className="action-btn action-btn--danger" disabled={actionLocked} onClick={() => onRemoveBase(index)}>
                  Remove base
                </button>
              )}
              {!isEmpty && slot.oddsAmount > 0n && onRemoveOdds && (
                <button className="action-btn action-btn--warning" disabled={actionLocked} onClick={() => onRemoveOdds(index)}>
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

const normalizeSlot = (slot: unknown): TableSlot => {
  const value = (slot ?? {}) as {
    amount?: bigint | number | string;
    oddsAmount?: bigint | number | string;
    point?: number | string;
  };

  return {
    amount: BigInt(value.amount ?? 0),
    oddsAmount: BigInt(value.oddsAmount ?? 0),
    point: Number(value.point ?? 0),
  };
};

const getNumberTone = (number: number) => {
  if (number === 6 || number === 8) {
    return 'rose';
  }

  if (number === 5 || number === 9) {
    return 'emerald';
  }

  return 'blue';
};

const getPropDisplay = (betType: BetTypeId) => {
  switch (betType) {
    case BET_TYPES.CRAPS_2:
      return { title: '2', subtitle: 'Craps' };
    case BET_TYPES.CRAPS_3:
      return { title: '3', subtitle: 'Craps' };
    case BET_TYPES.ANY_CRAPS:
      return { title: 'Any Craps', subtitle: '2 · 3 · 12' };
    case BET_TYPES.HORN:
      return { title: 'Horn', subtitle: '2 · 3 · 11 · 12' };
    case BET_TYPES.YO:
      return { title: 'Yo 11', subtitle: 'Single roll' };
    case BET_TYPES.TWELVE:
      return { title: '12', subtitle: 'Twelve' };
    case BET_TYPES.ANY_7:
      return { title: 'Any 7', subtitle: 'Single roll' };
    default:
      return { title: 'Prop', subtitle: 'Single roll' };
  }
};





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
