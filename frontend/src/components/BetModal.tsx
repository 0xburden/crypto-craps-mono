import { useEffect, useMemo, useState } from 'react';
import { type BetTypeId, getBetInputRule } from '../lib/craps';
import { formatUsd, parseUsdInput } from '../lib/format';

interface BetModalProps {
  open: boolean;
  title: string;
  description?: string;
  betType: BetTypeId;
  currentAmount?: bigint;
  flatAmount?: bigint;
  point?: number;
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

  const quickAmounts = [rule.minAdditional, 25_000_000n, 50_000_000n, 100_000_000n]
    .filter((entry, index, list) => entry > 0n && entry <= rule.maxAdditional && list.indexOf(entry) === index)
    .slice(0, 4);

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
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {quickAmounts.map((entry) => (
              <button
                key={entry.toString()}
                className="action-btn action-btn--secondary"
                onClick={() => setAmount((Number(entry) / 1_000_000).toString())}
              >
                {formatUsd(entry)}
              </button>
            ))}
            {rule.maxAdditional > 0n && (
              <button
                className="action-btn action-btn--warning"
                onClick={() => setAmount((Number(rule.maxAdditional) / 1_000_000).toString())}
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
              disabled={submitting || Boolean(validationMessage)}
              onClick={handleSubmit}
            >
              {submitting ? 'Submitting…' : 'Confirm bet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
