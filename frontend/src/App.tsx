/**
 * crypto-craps frontend — Phase 9 scaffold placeholder.
 *
 * Components to implement (per TASKS.md Phase 9):
 *   - wagmi + RainbowKit wallet connect / chain switch
 *   - useCrapsGame hook (getPlayerState, write contracts)
 *   - WalletBalance component
 *   - DepositWithdraw component (approval + deposit fee preview)
 *   - GameTable component (craps layout, all bet slots, puck/point display)
 *   - RollButton + event-driven state sync (watch RollRequested / RollResolved)
 *   - SessionManager (open/close, 24h countdown, self-exclusion)
 *   - ExclusionPanel (responsible gambling, 7-day reinstatement countdown)
 *   - Mobile landscape gate
 *
 * See docs/phase9-validation.md for contract/event integration notes.
 */
export default function App() {
  return (
    <main className="min-h-screen bg-[#0b3d2e] flex items-center justify-center text-white font-sans">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-wide">crypto-craps</h1>
        <p className="text-lg text-emerald-300">On-chain craps on BASE</p>
        <p className="text-sm text-emerald-500">
          Frontend scaffold — TASKS.md Phase 9 in progress.
          <br />
          Connect wallet + implement game UI to complete.
        </p>
        <div className="mt-6 p-4 bg-emerald-950 rounded border border-emerald-800 text-left text-sm text-emerald-300 space-y-1">
          <p className="font-semibold text-emerald-400">Setup</p>
          <p>
            <code className="text-emerald-200">pnpm frontend:install</code> — install deps
          </p>
          <p>
            <code className="text-emerald-200">cp frontend/.env.example frontend/.env</code> — configure
          </p>
          <p>
            <code className="text-emerald-200">pnpm frontend:dev</code> — start dev server
          </p>
          <p>
            <code className="text-emerald-200">pnpm frontend:build</code> — production build
          </p>
        </div>
      </div>
    </main>
  );
}
