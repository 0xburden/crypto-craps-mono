import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { getPhaseLabel, getPuckLabel, isExcluded, SESSION_PHASE } from '../lib/craps';
import { formatCountdown, formatUsd } from '../lib/format';

interface SessionPanelProps {
  game: UseCrapsGameResult;
  sessionRemainingSeconds: number;
}

export const SessionPanel = ({ game, sessionRemainingSeconds }: SessionPanelProps) => {
  const state = game.playerState;
  const excluded = isExcluded(state);
  const canOpen = game.isConnected && state?.phase === SESSION_PHASE.INACTIVE && !excluded && !state.paused;
  const canClose =
    game.isConnected &&
    state !== null &&
    state.phase !== SESSION_PHASE.INACTIVE &&
    state.phase !== SESSION_PHASE.ROLL_PENDING;
  const canRoll =
    game.isConnected &&
    state !== null &&
    state.phase !== SESSION_PHASE.INACTIVE &&
    state.phase !== SESSION_PHASE.ROLL_PENDING &&
    state.inPlay > 0n &&
    !excluded &&
    !state.paused;

  return (
    <section className="felt-panel rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Session</h2>
          <p className="mt-1 text-sm text-slate-300">
            Open, close, and roll without leaving the table.
          </p>
        </div>
        <span className="status-pill bg-white/5 text-slate-100">{getPuckLabel(state)}</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PanelMetric label="Phase" value={getPhaseLabel(state?.phase)} />
        <PanelMetric label="Point" value={state?.point ? state.point.toString() : '—'} />
        <PanelMetric label="In play" value={formatUsd(state?.inPlay)} />
        <PanelMetric label="Timer" value={formatCountdown(sessionRemainingSeconds)} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <button
          className="action-btn action-btn--secondary"
          disabled={!canOpen}
          onClick={() => void game.openSession()}
        >
          Open session
        </button>
        <button
          className="action-btn action-btn--secondary"
          disabled={!canClose}
          onClick={() => void game.closeSession()}
        >
          Close session
        </button>
        <button
          className="action-btn action-btn--primary"
          disabled={!canRoll || game.isRolling}
          onClick={() => void game.rollDice()}
        >
          {game.isRolling ? 'Rolling…' : 'Roll dice'}
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
        <p>Pending request ID: {state?.pendingRequestId ? state.pendingRequestId.toString() : '—'}</p>
        <p className="mt-1">Reserved payout: {formatUsd(state?.reserved)}</p>
        <p className="mt-1">Roll requests are synchronized via the on-chain RollResolved event.</p>
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

const PanelMetric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
    <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 font-semibold text-white">{value}</p>
  </div>
);
