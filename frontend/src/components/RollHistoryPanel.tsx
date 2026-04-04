import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { formatUsd } from '../lib/format';

interface RollHistoryPanelProps {
  game: UseCrapsGameResult;
}

const formatRequestId = (requestId: bigint) => {
  const value = requestId.toString();
  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 8)}…${value.slice(-6)}`;
};

export const RollHistoryPanel = ({ game }: RollHistoryPanelProps) => {
  const latest = game.lastResolvedRoll;

  return (
    <section className="felt-panel rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Roll history</h2>
          <p className="mt-1 text-sm text-slate-300">
            Recent resolved rolls pulled from on-chain `RollResolved` logs.
          </p>
        </div>
        <span className="status-pill bg-white/5 text-slate-200">{game.rollHistory.length} rolls</span>
      </div>

      {latest && (
        <div className="mt-4 rounded-3xl border border-emerald-300/25 bg-[radial-gradient(circle_at_top,rgba(82,209,138,0.22),rgba(82,209,138,0.08)_48%,rgba(0,0,0,0.1))] p-5 text-emerald-50 shadow-[0_0_32px_rgba(82,209,138,0.14)] overflow-hidden">
          <p className="text-xs uppercase tracking-[0.24em] text-emerald-100/80">Previous roll</p>
          <div className="mt-3 flex flex-col gap-4">
            <div className="min-w-0">
              <p className="text-6xl font-semibold leading-none">{latest.die1 + latest.die2}</p>
              <p className="mt-3 text-base font-semibold text-emerald-100">
                {latest.die1} + {latest.die2}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-emerald-100/70">
                Request {formatRequestId(latest.requestId)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="status-pill border border-emerald-200/30 bg-black/15 text-emerald-50">Die 1 · {latest.die1}</span>
              <span className="status-pill border border-emerald-200/30 bg-black/15 text-emerald-50">Die 2 · {latest.die2}</span>
              <span className="status-pill border border-emerald-200/30 bg-black/15 text-emerald-50">Payout · {formatUsd(latest.payout)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="scrollbar-thin mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1">
        {game.rollHistory.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 p-4 text-sm text-slate-400">
            No resolved rolls yet.
          </div>
        ) : (
          game.rollHistory.map((entry, index) => (
            <article
              key={entry.id}
              className={`rounded-2xl border p-4 text-sm overflow-hidden ${
                index === 0
                  ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50'
                  : 'border-white/10 bg-black/20 text-slate-200'
              }`}
            >
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <span className="font-semibold text-white">{index === 0 ? 'Latest resolved' : `Roll ${game.rollHistory.length - index}`}</span>
                <span className="min-w-0 break-all text-xs text-slate-400">Request {formatRequestId(entry.requestId)}</span>
              </div>
              <p className="mt-2 text-base font-semibold text-emerald-300">
                {entry.die1} + {entry.die2} = {entry.die1 + entry.die2}
              </p>
              <p className="mt-1 text-slate-300">Payout: {formatUsd(entry.payout)}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
};
