import { useMemo, useState } from 'react';
import { DEPOSIT_FEE_BPS } from '../config/contracts';
import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { calculateDepositPreview, isExcluded } from '../lib/craps';
import { formatUsd, parseUsdInput } from '../lib/format';

interface WalletPanelProps {
  game: UseCrapsGameResult;
}

export const WalletPanel = ({ game }: WalletPanelProps) => {
  const [depositAmount, setDepositAmount] = useState('100');
  const [withdrawAmount, setWithdrawAmount] = useState('0');

  const depositParsed = useMemo(() => {
    try {
      return parseUsdInput(depositAmount);
    } catch {
      return 0n;
    }
  }, [depositAmount]);

  const withdrawParsed = useMemo(() => {
    try {
      return parseUsdInput(withdrawAmount);
    } catch {
      return 0n;
    }
  }, [withdrawAmount]);

  const preview = calculateDepositPreview(depositParsed);
  const state = game.playerState;
  const excluded = isExcluded(state);
  const depositDisabled = !game.isConnected || excluded || state?.paused;

  return (
    <section className="felt-panel rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Wallet & balances</h2>
          <p className="mt-1 text-sm text-slate-300">
            Connect, approve, deposit, and withdraw through the shared contract hook.
          </p>
        </div>
        <span className="status-pill bg-white/5 text-slate-200">{game.tokenSymbol}</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <StatRow label="Wallet" value={formatUsd(game.walletTokenBalance)} />
        <StatRow label="Allowance" value={formatUsd(game.allowance)} />
        <StatRow label="Available" value={formatUsd(state?.available)} />
        <StatRow label="Accrued fees" value={formatUsd(state?.accruedFees)} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-white">Deposit</h3>
            <button
              className="action-btn action-btn--secondary"
              disabled={!game.isConnected || !game.contractAddress}
              onClick={() => void game.approveMax()}
            >
              Approve max
            </button>
          </div>
          <input
            className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none"
            inputMode="decimal"
            value={depositAmount}
            onChange={(event) => setDepositAmount(event.target.value)}
          />
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
            <p>
              Deposit fee ({DEPOSIT_FEE_BPS / 100}%): <span className="font-semibold text-white">{formatUsd(preview.fee)}</span>
            </p>
            <p className="mt-1">
              Available after deposit:{' '}
              <span className="font-semibold text-emerald-300">{formatUsd(preview.credited)}</span>
            </p>
          </div>
          <button
            className="action-btn action-btn--primary mt-4 w-full"
            disabled={depositDisabled || depositParsed <= 0n}
            onClick={() => void game.deposit(depositParsed)}
          >
            Deposit {game.tokenSymbol}
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-white">Withdraw</h3>
            <button
              className="action-btn action-btn--secondary"
              disabled={(state?.available ?? 0n) === 0n}
              onClick={() => setWithdrawAmount(((state?.available ?? 0n) / 1_000_000n).toString())}
            >
              Withdraw all
            </button>
          </div>
          <input
            className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none"
            inputMode="decimal"
            value={withdrawAmount}
            onChange={(event) => setWithdrawAmount(event.target.value)}
          />
          <p className="mt-3 text-sm text-slate-300">
            Withdrawals stay available even while paused or excluded.
          </p>
          <button
            className="action-btn action-btn--primary mt-4 w-full"
            disabled={!game.isConnected || withdrawParsed <= 0n}
            onClick={() => void game.withdraw(withdrawParsed)}
          >
            Withdraw {game.tokenSymbol}
          </button>
        </div>
      </div>
    </section>
  );
};

const StatRow = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
    <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 font-semibold text-white">{value}</p>
  </div>
);
