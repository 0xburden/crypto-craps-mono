import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { formatUsd } from '../lib/format';

interface RollHistoryPanelProps {
  game: UseCrapsGameResult;
}

export const RollHistoryPanel = ({ game }: RollHistoryPanelProps) => {
  return (
    <section className="felt-panel rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Roll history</h2>
          <p className="mt-1 text-sm text-slate-300">
            In-memory session history fed by `RollResolved` events.
          </p>
        </div>
        <span className="status-pill bg-white/5 text-slate-200">
          {game.rollHistory.length} rolls
        </span>
      </div>

      <div className="scrollbar-thin mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1">
        {game.rollHistory.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 p-4 text-sm text-slate-400">
            No rolls yet in this session.
          </div>
        ) : (
          game.rollHistory.map((entry, index) => (
            <article
              key={entry.id}
              className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-white">Roll #{game.rollHistory.length - index}</span>
                <span className="text-xs text-slate-400">Request {entry.requestId.toString()}</span>
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
