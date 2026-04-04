import { useMemo, useState } from 'react';
import { maxUint256 } from 'viem';
import { AccordionSection } from './AccordionSection';
import { FundingModal } from './FundingModal';
import { DEFAULT_CHAIN_ID, DEPOSIT_FEE_BPS } from '../config/contracts';
import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { calculateDepositPreview, isExcluded } from '../lib/craps';
import { formatUsd, formatUsdInput, parseUsdInput } from '../lib/format';

interface WalletPanelProps {
  game: UseCrapsGameResult;
}

export const WalletPanel = ({ game }: WalletPanelProps) => {
  const [depositAmount, setDepositAmount] = useState('100');
  const [withdrawAmount, setWithdrawAmount] = useState('0');
  const [fundModalOpen, setFundModalOpen] = useState(false);

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
  const allowanceDisplay = game.allowance === maxUint256 ? 'Unlimited' : formatUsd(game.allowance);
  const actionLocked = game.isTxPending;
  const canRequestFunds = game.canRequestFaucet;
  const showFundingAction = game.isConnected && !game.wrongNetwork && game.chainId === DEFAULT_CHAIN_ID;
  const maxDepositInput = formatUsdInput(game.walletTokenBalance);
  const hasEnoughWalletBalance = depositParsed <= game.walletTokenBalance;
  const hasEnoughAllowance = depositParsed > 0n && depositParsed <= game.allowance;

  const depositValidationMessage = (() => {
    if (!game.isConnected) return 'Connect wallet to deposit.';
    if (excluded) return 'Deposits are disabled while excluded.';
    if (state?.paused) return 'Deposits are disabled while the table is paused.';
    if (depositParsed <= 0n) return 'Enter a deposit amount greater than zero.';
    if (!hasEnoughWalletBalance) {
      return `Wallet balance is only ${formatUsd(game.walletTokenBalance)}.`;
    }
    if (!hasEnoughAllowance) {
      return 'Approve the token for this amount before depositing.';
    }
    return null;
  })();

  const depositDisabled =
    !game.isConnected || excluded || state?.paused || depositParsed <= 0n || !hasEnoughWalletBalance;

  const handleDepositAmountChange = (value: string) => {
    setDepositAmount(value);
  };

  const clampDepositAmountToWallet = () => {
    try {
      const parsed = parseUsdInput(depositAmount);
      if (parsed > game.walletTokenBalance) {
        setDepositAmount(maxDepositInput);
      }
    } catch {
      // Preserve the current input and let existing validation handle malformed values.
    }
  };

  const handleDepositAction = async () => {
    if (depositDisabled) {
      return;
    }

    if (hasEnoughAllowance) {
      await game.deposit(depositParsed);
      return;
    }

    await game.approveMax();
  };

  return (
    <>
      <section className="felt-panel rounded-3xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Wallet & balances</h2>
            <p className="mt-1 text-sm text-slate-300">
              Connect, approve, deposit, withdraw, and mint test srUSDC through the shared contract hook.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="status-pill bg-white/5 text-slate-200">{game.tokenSymbol}</span>
            {showFundingAction && (
              <button
                className="action-btn action-btn--warning"
                disabled={!canRequestFunds || actionLocked}
                onClick={() => setFundModalOpen(true)}
              >
                Request srUSDC
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <StatRow label="Wallet" value={formatUsd(game.walletTokenBalance)} />
          <StatRow label="Allowance" value={allowanceDisplay} />
          <StatRow label="Available" value={formatUsd(state?.available)} />
          <StatRow label="Accrued fees" value={formatUsd(state?.accruedFees)} />
        </div>

        <div className="mt-5">
          <AccordionSection
            title="Deposit & withdraw"
            description="Collapsed by default to keep gameplay focused."
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-white">Deposit</h3>
                  <button
                    className="action-btn action-btn--secondary"
                    disabled={game.walletTokenBalance === 0n || actionLocked}
                    onClick={() => setDepositAmount(maxDepositInput)}
                  >
                    Max wallet
                  </button>
                </div>
                <input
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none"
                  inputMode="decimal"
                  max={maxDepositInput}
                  placeholder={maxDepositInput}
                  value={depositAmount}
                  onBlur={clampDepositAmountToWallet}
                  onChange={(event) => handleDepositAmountChange(event.target.value)}
                />
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
                  <p>
                    Wallet balance:{' '}
                    <span className="break-all font-semibold text-white">{formatUsd(game.walletTokenBalance)}</span>
                  </p>
                  <p className="mt-1">
                    Current allowance:{' '}
                    <span className="break-all font-semibold text-white">{allowanceDisplay}</span>
                  </p>
                  <p className="mt-2">
                    Deposit fee ({DEPOSIT_FEE_BPS / 100}%):{' '}
                    <span className="font-semibold text-white">{formatUsd(preview.fee)}</span>
                  </p>
                  <p className="mt-1">
                    Available after deposit:{' '}
                    <span className="font-semibold text-emerald-300">{formatUsd(preview.credited)}</span>
                  </p>
                </div>
                {depositValidationMessage && (
                  <p className={`mt-3 text-sm ${!hasEnoughWalletBalance ? 'text-rose-300' : 'text-slate-300'}`}>
                    {depositValidationMessage}
                  </p>
                )}
                <button
                  className="action-btn action-btn--primary mt-4 w-full"
                  disabled={depositDisabled || actionLocked}
                  onClick={() => void handleDepositAction()}
                >
                  {actionLocked && (game.txLabel === 'Deposit' || game.txLabel === 'Approve token') ? (
                    <>
                      <span className="action-btn__spinner" aria-hidden="true" />
                      {game.txLabel === 'Deposit' ? 'Depositing…' : 'Approving…'}
                    </>
                  ) : hasEnoughAllowance ? (
                    `Deposit ${game.tokenSymbol}`
                  ) : (
                    `Approve ${game.tokenSymbol}`
                  )}
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-white">Withdraw</h3>
                  <button
                    className="action-btn action-btn--secondary"
                    disabled={(state?.available ?? 0n) === 0n || actionLocked}
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
                  disabled={!game.isConnected || withdrawParsed <= 0n || actionLocked}
                  onClick={() => void game.withdraw(withdrawParsed)}
                >
                  {actionLocked && game.txLabel === 'Withdraw' ? (
                    <>
                      <span className="action-btn__spinner" aria-hidden="true" />
                      Withdrawing…
                    </>
                  ) : (
                    <>Withdraw {game.tokenSymbol}</>
                  )}
                </button>
              </div>
            </div>
          </AccordionSection>
        </div>
      </section>

      <FundingModal open={fundModalOpen} game={game} onClose={() => setFundModalOpen(false)} />
    </>
  );
};

const StatRow = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
    <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 break-all font-semibold text-white">{value}</p>
  </div>
);
