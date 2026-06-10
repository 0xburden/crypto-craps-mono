import { AccordionSection } from './AccordionSection';
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
  const hasQueuedTurn = game.queuedTurnActions.length > 0;
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
  const rollButtonLabel = hasQueuedTurn ? 'Confirm & Roll' : 'Roll dice';

  return (
    <section className="felt-panel machine-panel rounded-3xl p-4 sm:p-5">
      <div className="machine-panel__titlebar">
        <div className="min-w-0">
          <p className="machine-kicker">Roll console</p>
          <h2 className="truncate text-xl font-black uppercase tracking-[0.08em] text-white">Ready station</h2>
        </div>
        <span
          className={`status-pill ${pointOn ? 'border border-amber-300/35 bg-amber-400/15 text-amber-100 shadow-[0_0_24px_rgba(246,196,83,0.18)]' : 'bg-white/5 text-slate-100'}`}
        >
          {getPuckLabel(state)}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <PanelMetric label="Phase" value={getPhaseLabel(state?.phase)} />
        <PanelMetric label={pointOn ? 'Point is ON' : 'Point'} value={state?.point ? state.point.toString() : '—'} emphasis={pointOn} />
        <PanelMetric label="On table" value={formatUsd(state?.inPlay)} />
        <PanelMetric label="Timer" value={formatCountdown(sessionRemainingSeconds)} />
      </div>

      {pointOn && (
        <div className="point-display mt-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-amber-100/80">Point number</p>
            <p className="mt-1 text-5xl font-black leading-none text-amber-50">{state?.point}</p>
          </div>
          <span className="status-pill border border-amber-200/35 bg-black/20 text-amber-50">BOX ACTION LIVE</span>
        </div>
      )}

      <div className="roll-console mt-4">
        <button
          className="roll-button"
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
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <button className="action-btn action-btn--secondary" disabled={!hasQueuedTurn || actionLocked} onClick={game.clearQueuedTurn}>
            Clear queue
          </button>
          <button className="action-btn action-btn--secondary" disabled={actionLocked} onClick={() => void game.setTurnModeEnabled(!game.turnModeEnabled)}>
            Queue {game.turnModeEnabled ? 'ON' : 'OFF'}
          </button>
          <button className="action-btn action-btn--warning sm:col-span-2 xl:col-span-1 2xl:col-span-2" disabled={!canClose || actionLocked} onClick={() => void game.closeSession()}>
            {actionLocked && game.txLabel === 'Close session' ? (
              <>
                <span className="action-btn__spinner" aria-hidden="true" />
                Closing…
              </>
            ) : (
              'Color up / close'
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-[0.22em] text-emerald-100/75">Queued turn</span>
          <span className="status-pill border border-emerald-200/30 bg-emerald-400/10 text-emerald-50">
            {game.queuedTurnActions.length} action{game.queuedTurnActions.length === 1 ? '' : 's'}
          </span>
        </div>
        {hasQueuedTurn ? (
          <div className="mt-3 space-y-2">
            {game.queuedTurnActions.slice(0, 3).map((action, index) => (
              <div key={`${action.kind}-${action.betType}-${action.index}-${index}`} className="queue-row">
                <span className="min-w-0 truncate">{describeTurnAction(action)}</span>
                <span>{index + 1}</span>
              </div>
            ))}
            {game.queuedTurnActions.length > 3 && <p className="text-xs text-emerald-50/75">+{game.queuedTurnActions.length - 3} more queued</p>}
          </div>
        ) : (
          <p className="mt-2 text-emerald-50/80">Tap a felt zone to queue chips.</p>
        )}
      </div>

      <AccordionSection title="Machine details" description="Request id, reserve, and full turn queue.">
        <div className="space-y-3 text-sm text-slate-300">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <p className="text-slate-300">Pending request</p>
              <p className="max-w-full break-all font-mono text-xs text-slate-200 sm:text-right">
                {formatRequestId(state?.pendingRequestId)}
              </p>
            </div>
            <p className="mt-2">Reserved payout: {formatUsd(state?.reserved)}</p>
          </div>
          {hasQueuedTurn && (
            <div className="space-y-2 rounded-2xl border border-emerald-300/20 bg-black/15 p-3 text-emerald-50">
              {game.queuedTurnActions.map((action, index) => (
                <div key={`${action.kind}-${action.betType}-${action.index}-detail-${index}`} className="queue-row">
                  <span className="min-w-0 truncate">{describeTurnAction(action)}</span>
                  <span>{index + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </AccordionSection>
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
  <div className={`machine-metric ${emphasis ? 'machine-metric--hot' : ''}`}>
    <p>{label}</p>
    <strong>{value}</strong>
  </div>
);
