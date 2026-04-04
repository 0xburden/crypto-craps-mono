import { useEffect, useMemo, useState } from 'react';
import { BET_TYPES, type BetTypeId, getBetInputRule } from '../lib/craps';
import { formatUsd, formatUsdInput, parseUsdInput } from '../lib/format';

interface BetModalProps {
  open: boolean;
  title: string;
  description?: string;
  betType: BetTypeId;
  currentAmount?: bigint;
  flatAmount?: bigint;
  point?: number;
  isPending?: boolean;
  pendingLabel?: string;
  submitLabel?: string;
  onClose: () => void;
  onConfirm: (amount: bigint) => Promise<void>;
}

export const BetModal = ({
  open,
  title,
  description,
  betType,
  currentAmount = 0n,
  flatAmount = 0n,
  point = 0,
  isPending = false,
  pendingLabel,
  submitLabel,
  onClose,
  onConfirm,
}: BetModalProps) => {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rule = useMemo(
    () => getBetInputRule({ betType, currentAmount, flatAmount, point }),
    [betType, currentAmount, flatAmount, point],
  );

  useEffect(() => {
    if (!open) {
      setAmount('');
      setError(null);
      setSubmitting(false);
      return;
    }

    if (rule.minAdditional > 0n) {
      setAmount((Number(rule.minAdditional) / 1_000_000).toString());
    }
  }, [open, rule.minAdditional]);

  if (!open) {
    return null;
  }

  const parsedAmount = (() => {
    try {
      return parseUsdInput(amount);
    } catch {
      return 0n;
    }
  })();

  const validationMessage = (() => {
    if (!amount) {
      return 'Enter an amount to continue.';
    }
    if (parsedAmount <= 0n) {
      return 'Amount must be greater than zero.';
    }
    if (rule.maxAdditional === 0n) {
      return 'This bet cannot be added right now.';
    }
    if (parsedAmount < rule.minAdditional) {
      return `Minimum add is ${formatUsd(rule.minAdditional)}.`;
    }
    if (parsedAmount > rule.maxAdditional) {
      return `Maximum add is ${formatUsd(rule.maxAdditional)}.`;
    }
    if (rule.step > 1n && parsedAmount % rule.step !== 0n) {
      return `Amount must be a multiple of ${formatUsd(rule.step)}.`;
    }
    return null;
  })();

  const isPlaceFiveUnitBet =
    betType === BET_TYPES.PLACE_4 ||
    betType === BET_TYPES.PLACE_5 ||
    betType === BET_TYPES.PLACE_9 ||
    betType === BET_TYPES.PLACE_10;
  const isPlaceSixUnitBet = betType === BET_TYPES.PLACE_6 || betType === BET_TYPES.PLACE_8;

  const isPlaceBet = isPlaceFiveUnitBet || isPlaceSixUnitBet;

  const quickAmounts = (
    isPlaceFiveUnitBet
      ? [5_000_000n, 10_000_000n, 15_000_000n, 25_000_000n]
      : isPlaceSixUnitBet
        ? [6_000_000n, 12_000_000n, 18_000_000n, 24_000_000n]
        : [rule.minAdditional, 25_000_000n, 50_000_000n, 100_000_000n]
  )
    .filter((entry, index, list) => entry > 0n && entry <= rule.maxAdditional && list.indexOf(entry) === index)
    .slice(0, 4);

  const formatQuickAmountLabel = (entry: bigint) => (isPlaceBet ? formatUsdInput(entry) : formatUsd(entry));

  const handleIncrement = () => {
    const baseAmount = parsedAmount > 0n ? parsedAmount : 0n;
    const nextAmount = baseAmount === 0n ? rule.minAdditional : baseAmount + rule.step;
    const boundedAmount = nextAmount > rule.maxAdditional ? rule.maxAdditional : nextAmount;

    if (boundedAmount > 0n) {
      setAmount(formatUsdInput(boundedAmount));
    }
  };

  const handleSubmit = async () => {
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(parsedAmount);
      onClose();
    } catch {
      setError('Transaction failed. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="felt-panel w-full max-w-md rounded-3xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm text-slate-300">{description ?? rule.note}</p>
          </div>
          <button className="action-btn action-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block text-sm text-slate-200">
            Amount
            <input
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
              inputMode="decimal"
              placeholder="0.00"
              disabled={submitting || isPending}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {quickAmounts.map((entry) => (
              <button
                key={entry.toString()}
                className="action-btn action-btn--secondary"
                disabled={submitting || isPending}
                onClick={() => setAmount(formatUsdInput(entry))}
              >
                {formatQuickAmountLabel(entry)}
              </button>
            ))}
            {rule.step > 1n && rule.maxAdditional > 0n && (
              <button
                className="action-btn action-btn--secondary"
                disabled={submitting || isPending || parsedAmount >= rule.maxAdditional}
                onClick={handleIncrement}
              >
                +{isPlaceBet ? formatUsdInput(rule.step) : formatUsd(rule.step)}
              </button>
            )}
            {rule.maxAdditional > 0n && (
              <button
                className="action-btn action-btn--warning"
                disabled={submitting || isPending}
                onClick={() => setAmount(formatUsdInput(rule.maxAdditional))}
              >
                Max
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
            <p>Current bet: {formatUsd(currentAmount)}</p>
            {flatAmount > 0n && <p>Flat bet reference: {formatUsd(flatAmount)}</p>}
            <p>Point: {point || '—'}</p>
          </div>

          {error && <p className="text-sm text-rose-300">{error}</p>}
          {!error && validationMessage && <p className="text-sm text-amber-300">{validationMessage}</p>}

          <div className="flex justify-end gap-3">
            <button className="action-btn action-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="action-btn action-btn--primary"
              disabled={submitting || isPending || Boolean(validationMessage)}
              onClick={handleSubmit}
            >
              {submitting || isPending ? (
                <>
                  <span className="action-btn__spinner" aria-hidden="true" />
                  {pendingLabel ?? 'Submitting…'}
                </>
              ) : (
                submitLabel ?? 'Confirm bet'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
