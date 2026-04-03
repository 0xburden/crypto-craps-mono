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

    if (game.needsMainnetDeployment) {
      return {
        tone: 'amber',
        message: 'BASE Mainnet support is configured, but the live game contract address is not set yet.',
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
      <div className="min-h-screen bg-felt-950 text-white">
        <HeaderBar game={game} sessionRemainingSeconds={sessionRemainingSeconds} />

        <div className="mx-auto max-w-[1600px] px-4 py-4 lg:px-6">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              banner.tone === 'rose'
                ? 'border-rose-400/20 bg-rose-500/10 text-rose-100'
                : banner.tone === 'amber'
                  ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
                  : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
            }`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p>{banner.message}</p>
              {banner.action}
            </div>
          </div>
        </div>

        <main className="mx-auto grid max-w-[1600px] gap-5 px-4 pb-8 lg:px-6 xl:grid-cols-[1.6fr_0.95fr]">
          <div className="space-y-5">
            <GameTable game={game} />
          </div>

          <aside className="space-y-5">
            <WalletPanel game={game} />
            <SessionPanel game={game} sessionRemainingSeconds={sessionRemainingSeconds} />
            <RollHistoryPanel game={game} />
            <ExclusionPanel
              game={game}
              reinstatementRemainingSeconds={reinstatementRemainingSeconds}
            />
          </aside>
        </main>
      </div>
    </LandscapeGate>
  );
};

export default App;
