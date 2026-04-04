import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { describeTurnAction, getPhaseLabel, getPuckLabel, isExcluded, SESSION_PHASE } from '../lib/craps';
import { formatCountdown, formatUsd } from '../lib/format';

interface SessionPanelProps {
  game: UseCrapsGameResult;
  sessionRemainingSeconds: number;
}

const formatRequestId = (requestId?: bigint) => {
  if (!requestId || requestId === 0n) {
    return '—';
  }

  const value = requestId.toString();
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}…${value.slice(-8)}`;
};

export const SessionPanel = ({ game, sessionRemainingSeconds }: SessionPanelProps) => {
  const state = game.playerState;
  const excluded = isExcluded(state);
  const pointOn = (state?.point ?? 0) !== 0;
  const actionLocked = game.isTxPending;
  const canClose =
    game.isConnected &&
    state !== null &&
    state.phase !== SESSION_PHASE.INACTIVE &&
    state.phase !== SESSION_PHASE.ROLL_PENDING;
  const hasQueuedTurn = game.queuedTurnActions.length > 0;
  const canRoll =
    game.isConnected &&
    state !== null &&
    state.phase !== SESSION_PHASE.INACTIVE &&
    state.phase !== SESSION_PHASE.ROLL_PENDING &&
    state.inPlay > 0n &&
    !excluded &&
    !state.paused;
  const rollButtonLabel = hasQueuedTurn ? 'Confirm & Roll' : 'Roll dice';

  return (
    <section className="felt-panel rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Session</h2>
          <p className="mt-1 text-sm text-slate-300">
            Sessions open automatically on your first bet. Close and roll without leaving the table.
          </p>
        </div>
        <span
          className={`status-pill ${pointOn ? 'border border-amber-300/35 bg-amber-400/15 text-amber-100 shadow-[0_0_24px_rgba(246,196,83,0.18)]' : 'bg-white/5 text-slate-100'}`}
        >
          {getPuckLabel(state)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PanelMetric label="Phase" value={getPhaseLabel(state?.phase)} />
        <PanelMetric
          label={pointOn ? 'Point is ON' : 'Point'}
          value={state?.point ? state.point.toString() : '—'}
          emphasis={pointOn}
        />
        <PanelMetric label="In play" value={formatUsd(state?.inPlay)} />
        <PanelMetric label="Timer" value={formatCountdown(sessionRemainingSeconds)} />
      </div>

      {pointOn && (
        <div className="mt-4 rounded-2xl border border-amber-300/30 bg-[radial-gradient(circle_at_top,rgba(246,196,83,0.24),rgba(246,196,83,0.08)_45%,rgba(0,0,0,0.08))] p-4 text-amber-50 shadow-[0_0_30px_rgba(246,196,83,0.12)]">
          <p className="text-xs uppercase tracking-[0.24em] text-amber-100/80">Puck on</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <p className="text-4xl font-semibold leading-none">{state?.point}</p>
              <p className="mt-2 text-sm text-amber-50/85">Point is established. Box action and odds are live.</p>
            </div>
            <span className="status-pill border border-amber-200/35 bg-black/15 text-amber-50">POINT {state?.point}</span>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <button
          className="action-btn action-btn--secondary"
          disabled={!canClose || actionLocked}
          onClick={() => void game.closeSession()}
        >
          {actionLocked && game.txLabel === 'Close session' ? (
            <>
              <span className="action-btn__spinner" aria-hidden="true" />
              Closing…
            </>
          ) : (
            'Close session'
          )}
        </button>
        <button
          className="action-btn action-btn--primary"
          disabled={!canRoll || game.isRolling || actionLocked}
          onClick={() => void game.rollDice()}
        >
          {game.isRolling || (actionLocked && (game.txLabel === 'Roll dice' || game.txLabel === 'Confirm & Roll')) ? (
            <>
              <span className="action-btn__spinner" aria-hidden="true" />
              Rolling…
            </>
          ) : (
            rollButtonLabel
          )}
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-emerald-100/80">Turn composer</p>
            <p className="mt-1 text-sm text-emerald-50/90">
              Queue bet changes, then confirm them with the next roll.
            </p>
          </div>
          <button
            className={`action-btn ${game.turnModeEnabled ? 'action-btn--warning' : 'action-btn--secondary'}`}
            disabled={actionLocked}
            onClick={() => void game.setTurnModeEnabled(!game.turnModeEnabled)}
          >
            {game.turnModeEnabled ? 'Turn mode: ON' : 'Turn mode: OFF'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="action-btn action-btn--secondary"
            disabled={!hasQueuedTurn || actionLocked}
            onClick={game.clearQueuedTurn}
          >
            Clear queued turn
          </button>
          {hasQueuedTurn && (
            <span className="status-pill border border-emerald-200/30 bg-emerald-400/10 text-emerald-50">
              {game.queuedTurnActions.length} action{game.queuedTurnActions.length === 1 ? '' : 's'} queued
            </span>
          )}
        </div>

        {hasQueuedTurn ? (
          <div className="mt-4 space-y-2 rounded-2xl border border-emerald-300/20 bg-black/15 p-3 text-sm text-emerald-50">
            {game.queuedTurnActions.map((action, index) => (
              <div
                key={`${action.kind}-${action.betType}-${action.index}-${index}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <span>{describeTurnAction(action)}</span>
                <span className="text-xs uppercase tracking-[0.2em] text-emerald-100/70">
                  {index + 1}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-emerald-50/80">No queued turn actions.</p>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <p className="text-slate-300">Pending request</p>
          <p className="max-w-full break-all font-mono text-xs text-slate-200 sm:text-right">
            {formatRequestId(state?.pendingRequestId)}
          </p>
        </div>
        <p className="mt-2">Reserved payout: {formatUsd(state?.reserved)}</p>
        <p className="mt-1 text-slate-400">Roll requests are synchronized via the on-chain RollResolved event.</p>
      </div>

      {game.lastResolvedRoll && (
        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          <p className="font-semibold">Latest roll</p>
          <p className="mt-1">
            {game.lastResolvedRoll.die1} + {game.lastResolvedRoll.die2} ={' '}
            {game.lastResolvedRoll.die1 + game.lastResolvedRoll.die2}
          </p>
          <p className="mt-1">Payout: {formatUsd(game.lastResolvedRoll.payout)}</p>
        </div>
      )}
    </section>
  );
};

const PanelMetric = ({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) => (
  <div
    className={`rounded-2xl border p-3 ${
      emphasis
        ? 'border-amber-300/30 bg-amber-400/10 shadow-[0_0_24px_rgba(246,196,83,0.10)]'
        : 'border-white/10 bg-white/5'
    }`}
  >
    <p className={`text-xs uppercase tracking-wide ${emphasis ? 'text-amber-100/80' : 'text-slate-400'}`}>{label}</p>
    <p className={`mt-1 font-semibold ${emphasis ? 'text-amber-50' : 'text-white'}`}>{value}</p>
  </div>
);
