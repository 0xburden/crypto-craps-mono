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
  const bankrollPct = state ? percentage(state.totalBankroll, state.initialBankroll || 1n) : 0;
  const pointLabel = state?.point ? state.point.toString() : 'OFF';

  return (
    <header className="machine-header sticky top-0 z-20 border-b border-emerald-300/10 bg-felt-950/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-3 py-3 sm:px-4 lg:px-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="machine-logo" aria-hidden="true">CC</div>
            <div className="min-w-0">
              <p className="text-[0.68rem] uppercase tracking-[0.3em] text-emerald-300/80">Crypto Craps</p>
              <h1 className="truncate text-xl font-black uppercase tracking-[0.08em] text-white sm:text-2xl">
                Bubble table
              </h1>
            </div>
          </div>

          <div className="machine-header__actions">
            <span className="status-pill bg-emerald-500/10 text-emerald-300">{game.networkLabel}</span>
            {game.isTxPending && (
              <span className="status-pill bg-amber-500/10 text-amber-200">
                <span className="action-btn__spinner" aria-hidden="true" />
                {game.txLabel ?? 'Transaction'}
              </span>
            )}
            <div className="connect-shell">
              <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
            </div>
          </div>
        </div>

        <div className="machine-header__hud">
          <div className="machine-header__meters">
            <Metric label="Available" value={formatUsd(state?.available)} tone="emerald" />
            <Metric label="On table" value={formatUsd(state?.inPlay)} />
            <Metric label="Reserved" value={formatUsd(state?.reserved)} />
            <Metric label="Point" value={pointLabel} tone={state?.point ? 'amber' : 'default'} />
            <div className="machine-bankroll min-w-0 rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 text-[0.68rem] uppercase tracking-[0.16em] text-slate-400">
                <span>Bankroll</span>
                <span>{bankrollPct.toFixed(0)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.min(bankrollPct, 100)}%` }} />
              </div>
              <p className="mt-1 truncate text-xs text-slate-300">{formatUsd(state?.totalBankroll)}</p>
            </div>
          </div>

          <div className="machine-header__state">
            <span className="status-pill bg-white/5 text-slate-200">{getPhaseLabel(state?.phase)} · {getPuckLabel(state)}</span>
            <span className="status-pill bg-white/5 text-slate-200">{formatCountdown(sessionRemainingSeconds)}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

const Metric = ({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'emerald' | 'amber';
}) => (
  <div className={`machine-meter machine-meter--${tone}`}>
    <p>{label}</p>
    <strong>{value}</strong>
  </div>
);
