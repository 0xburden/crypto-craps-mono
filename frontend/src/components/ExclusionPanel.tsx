import { SELF_EXCLUSION_DELAY_SECONDS } from '../config/contracts';
import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { isExcluded } from '../lib/craps';
import { formatCountdown, formatUsd } from '../lib/format';

interface ExclusionPanelProps {
  game: UseCrapsGameResult;
  reinstatementRemainingSeconds: number;
}

export const ExclusionPanel = ({
  game,
  reinstatementRemainingSeconds,
}: ExclusionPanelProps) => {
  const state = game.playerState;
  const excluded = isExcluded(state);
  const actionLocked = game.isTxPending;

  if (!state) {
    return (
      <section className="felt-panel rounded-3xl p-5">
        <h2 className="text-lg font-semibold text-white">Responsible gambling</h2>
        <p className="mt-2 text-sm text-slate-300">
          Connect a wallet to access self-exclusion controls.
        </p>
      </section>
    );
  }

  if (excluded) {
    const canComplete =
      state.selfExcluded &&
      state.reinstatementEligibleAt > 0n &&
      reinstatementRemainingSeconds <= 0;

    return (
      <section className="felt-panel rounded-3xl border border-rose-400/20 p-5">
        <h2 className="text-lg font-semibold text-white">Play restricted</h2>
        <p className="mt-2 text-sm text-slate-300">
          You can still withdraw {formatUsd(state.available)} at any time.
        </p>

        {state.selfExcluded ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
              <p>Self-exclusion is active.</p>
              <p className="mt-1">
                Delay before return: {formatCountdown(reinstatementRemainingSeconds)} /{' '}
                {formatCountdown(SELF_EXCLUSION_DELAY_SECONDS)}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className="action-btn action-btn--secondary"
                disabled={actionLocked}
                onClick={() => void game.requestSelfReinstatement()}
              >
                {actionLocked && game.txLabel === 'Request reinstatement' ? (
                  <>
                    <span className="action-btn__spinner" aria-hidden="true" />
                    Requesting…
                  </>
                ) : (
                  'Request reinstatement'
                )}
              </button>
              <button
                className="action-btn action-btn--primary"
                disabled={!canComplete || actionLocked}
                onClick={() => void game.completeSelfReinstatement()}
              >
                {actionLocked && game.txLabel === 'Complete reinstatement' ? (
                  <>
                    <span className="action-btn__spinner" aria-hidden="true" />
                    Completing…
                  </>
                ) : (
                  'Complete reinstatement'
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
            Operator exclusion is active. Contact support for reinstatement.
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="felt-panel rounded-3xl p-5">
      <h2 className="text-lg font-semibold text-white">Responsible gambling</h2>
      <p className="mt-2 text-sm text-slate-300">
        Self-exclusion ends your active session immediately, keeps withdrawals available, and requires a 7-day cooldown before returning.
      </p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
        <p>• Self-exclusion is immediate.</p>
        <p className="mt-1">• Your session closes and bets are returned.</p>
        <p className="mt-1">• Reinstatement requires a 7-day delay.</p>
      </div>
      <button
        className="action-btn action-btn--danger mt-4 w-full"
        disabled={!game.isConnected || actionLocked}
        onClick={() => void game.selfExclude()}
      >
        {actionLocked && game.txLabel === 'Self-exclude' ? (
          <>
            <span className="action-btn__spinner" aria-hidden="true" />
            Processing…
          </>
        ) : (
          'Self-exclude now'
        )}
      </button>
    </section>
  );
};
