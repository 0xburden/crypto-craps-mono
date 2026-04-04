import { ConnectButton } from '@rainbow-me/rainbowkit';
import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { getPhaseLabel, getPuckLabel } from '../lib/craps';
import { formatCountdown, formatUsd, percentage } from '../lib/format';

interface HeaderBarProps {
  game: UseCrapsGameResult;
  sessionRemainingSeconds: number;
}

export const HeaderBar = ({ game, sessionRemainingSeconds }: HeaderBarProps) => {
  const state = game.playerState;
  const bankrollPct = state
    ? percentage(state.totalBankroll, state.initialBankroll || 1n)
    : 0;

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-felt-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">Crypto Craps</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-200/85">
            <span className="status-pill bg-emerald-500/10 text-emerald-300">
              {game.networkLabel}
            </span>
            {game.isTxPending && (
              <span className="status-pill bg-amber-500/10 text-amber-200">
                <span className="action-btn__spinner" aria-hidden="true" />
                {game.txLabel ?? 'Transaction pending'}
              </span>
            )}
            <span className="status-pill bg-white/5 text-slate-200">
              Phase: {getPhaseLabel(state?.phase)}
            </span>
            <span className="status-pill bg-white/5 text-slate-200">
              Puck: {getPuckLabel(state)}
            </span>
            <span className="status-pill bg-white/5 text-slate-200">
              Session timer: {formatCountdown(sessionRemainingSeconds)}
            </span>
          </div>
        </div>

        <div className="grid gap-3 xl:min-w-[720px] xl:grid-cols-[1fr_auto] xl:items-center">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Metric label="Available" value={formatUsd(state?.available)} />
            <Metric label="In Play" value={formatUsd(state?.inPlay)} />
            <Metric label="Reserved" value={formatUsd(state?.reserved)} />
            <Metric label="Fees" value={formatUsd(state?.accruedFees)} />
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Bankroll health</span>
                <span>{bankrollPct.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all"
                  style={{ width: `${Math.min(bankrollPct, 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-300">
                {formatUsd(state?.totalBankroll)} / {formatUsd(state?.initialBankroll)}
              </p>
            </div>
          </div>
          <div className="justify-self-start xl:justify-self-end">
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
          </div>
        </div>
      </div>
    </header>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
    <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 text-sm font-semibold text-white">{value}</p>
  </div>
);
