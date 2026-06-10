import { useEffect, useMemo, useState } from 'react';
import { ExclusionPanel } from './components/ExclusionPanel';
import { GameTable } from './components/GameTable';
import { HeaderBar } from './components/HeaderBar';
import { LandscapeGate } from './components/LandscapeGate';
import { RollHistoryPanel } from './components/RollHistoryPanel';
import { SessionPanel } from './components/SessionPanel';
import { WalletPanel } from './components/WalletPanel';
import { DEFAULT_CHAIN_ID } from './config/contracts';
import { useCrapsGame } from './hooks/useCrapsGame';
import { isExcluded } from './lib/craps';

const App = () => {
  const game = useCrapsGame();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const sessionRemainingSeconds = useMemo(() => {
    const state = game.playerState;
    if (!state || state.lastActivityTime === 0) {
      return 0;
    }

    const elapsed = Math.max(0, Math.floor(now / 1000) - state.lastActivityTime);
    return Math.max(0, 86_400 - elapsed);
  }, [game.playerState, now]);

  const reinstatementRemainingSeconds = useMemo(() => {
    const state = game.playerState;
    if (!state || state.reinstatementEligibleAt === 0n) {
      return 0;
    }

    return Math.max(0, Number(state.reinstatementEligibleAt) - Math.floor(now / 1000));
  }, [game.playerState, now]);

  const banner = (() => {
    if (game.wrongNetwork) {
      return {
        tone: 'amber',
        message: 'Switch to BASE Sepolia or BASE Mainnet to use the table.',
        action: (
          <button className="action-btn action-btn--warning" onClick={() => void game.switchToBaseSepolia()}>
            Switch to BASE Sepolia
          </button>
        ),
      };
    }

    if (game.needsGameDeployment) {
      return {
        tone: 'amber',
        message: `${game.networkLabel} V3 game contract address is not configured. Set the V3 address before playing.`,
      };
    }

    if (game.playerState?.paused) {
      return {
        tone: 'rose',
        message:
          'The table is currently paused. Withdrawals remain available while play actions stay disabled.',
      };
    }

    if (isExcluded(game.playerState)) {
      return {
        tone: 'rose',
        message:
          'Play is disabled for this account. You can still withdraw, request reinstatement, or complete reinstatement if eligible.',
      };
    }

    if (game.error) {
      return {
        tone: 'amber',
        message: game.error,
        action: (
          <button className="action-btn action-btn--secondary" onClick={game.clearError}>
            Dismiss
          </button>
        ),
      };
    }

    return {
      tone: 'emerald',
      message: `Sepolia primary (${DEFAULT_CHAIN_ID}) · Event sync uses RollResolved and getPlayerState refreshes.`,
    };
  })();

  return (
    <LandscapeGate>
      <div className="machine-room min-h-screen bg-felt-950 text-white">
        <HeaderBar game={game} sessionRemainingSeconds={sessionRemainingSeconds} />

        <div className="mx-auto max-w-[1600px] px-3 py-3 sm:px-4 lg:px-6">
          <div
            className={`machine-alert rounded-2xl border px-4 py-3 text-sm ${
              banner.tone === 'rose'
                ? 'border-rose-400/20 bg-rose-500/10 text-rose-100'
                : banner.tone === 'amber'
                  ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
                  : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
            }`}
          >
            <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="min-w-0 break-words leading-relaxed">{banner.message}</p>
              {banner.action}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6">
          <div className="table-rail machine-rail mb-3 rounded-2xl px-4 py-3 text-[0.72rem] uppercase tracking-[0.18em] text-slate-200/80">
            <span className="text-emerald-200">Machine mode</span> · Tap felt zones · OFF place/lay bets stay parked · Confirm & roll
          </div>
        </div>

        <main className="mx-auto max-w-[1600px] px-3 pb-8 sm:px-4 lg:px-6">
          <div className="table-shell machine-cabinet grid min-w-0 gap-4 rounded-[2.25rem] p-2 sm:p-3 xl:grid-cols-[minmax(0,1.82fr)_minmax(320px,0.76fr)]">
            <div className="machine-table-area min-w-0 space-y-5">
              <GameTable game={game} />
            </div>

            <aside className="machine-sidecar min-w-0 space-y-4 xl:sticky xl:top-24 xl:self-start">
              <SessionPanel game={game} sessionRemainingSeconds={sessionRemainingSeconds} />
              <RollHistoryPanel game={game} />
              <WalletPanel game={game} />
              <ExclusionPanel
                game={game}
                reinstatementRemainingSeconds={reinstatementRemainingSeconds}
              />
            </aside>
          </div>
        </main>
      </div>
    </LandscapeGate>
  );
};

export default App;
