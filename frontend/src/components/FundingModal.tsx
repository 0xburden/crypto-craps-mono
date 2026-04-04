import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_CHAIN_ID } from '../config/contracts';
import { type UseCrapsGameResult } from '../hooks/useCrapsGame';
import { formatUsd, formatUsdInput, parseUsdInput, shortAddress } from '../lib/format';

interface FundingModalProps {
  open: boolean;
  game: UseCrapsGameResult;
  onClose: () => void;
}

const QUICK_AMOUNTS = [25_000_000n, 100_000_000n, 250_000_000n, 500_000_000n, 1_000_000_000n];
const FAUCET_TX_LABEL = 'Request faucet';

export const FundingModal = ({ open, game, onClose }: FundingModalProps) => {
  const [amount, setAmount] = useState('100');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = game.isTxPending && game.txLabel === FAUCET_TX_LABEL;
  const faucetMaxRequestAmount = game.faucetMaxRequestAmount;

  useEffect(() => {
    if (!open) {
      setAmount('100');
      setSubmitting(false);
      setError(null);
      return;
    }

    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting && !isPending) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPending, onClose, open, submitting]);

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

  const isBaseSepolia = game.isConnected && !game.wrongNetwork && game.chainId === DEFAULT_CHAIN_ID;
  const symbol = 'srUSDC';

  const validationMessage = (() => {
    if (!game.isConnected) {
      return 'Connect your wallet on Base Sepolia to request test funds.';
    }
    if (!isBaseSepolia) {
      return 'Test funding is only available while connected to Base Sepolia.';
    }
    if (!amount.trim()) {
      return 'Enter an amount to continue.';
    }
    if (parsedAmount <= 0n) {
      return 'Amount must be greater than zero.';
    }
    if (parsedAmount > faucetMaxRequestAmount) {
      return `You can request up to ${formatUsd(faucetMaxRequestAmount, 0, '')} ${symbol} per request.`;
    }
    return null;
  })();

  const handleSubmit = async () => {
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await game.requestFaucet(parsedAmount);
      onClose();
    } catch {
      setError('Funding request failed. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting && !isPending) {
          onClose();
        }
      }}
    >
      <div
        aria-describedby="funding-modal-description"
        aria-labelledby="funding-modal-title"
        aria-modal="true"
        className="modal-dialog felt-panel p-5"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-white" id="funding-modal-title">
              Fund wallet with test {symbol}
            </h3>
            <p className="mt-2 text-sm text-slate-300" id="funding-modal-description">
              Mint test srUSDC directly to the connected wallet on Base Sepolia. Each request is capped at{' '}
              {formatUsd(faucetMaxRequestAmount, 0)}.
            </p>
          </div>
          <button className="action-btn action-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/35 p-4 text-sm text-slate-300">
            <p>
              Connected wallet: <span className="font-semibold text-white">{shortAddress(game.account)}</span>
            </p>
            <p className="mt-1">
              Network: <span className="font-semibold text-white">{game.networkLabel}</span>
            </p>
            <p className="mt-1">
              Funds are minted to your connected address and appear in your wallet balance after confirmation.
            </p>
          </div>

          <label className="block text-sm text-slate-200">
            Amount ({symbol})
            <input
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-white outline-none"
              inputMode="decimal"
              max={formatUsdInput(faucetMaxRequestAmount)}
              placeholder="100"
              disabled={submitting || isPending}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((entry) => (
              <button
                key={entry.toString()}
                className="action-btn action-btn--secondary"
                disabled={submitting || isPending}
                onClick={() => setAmount(formatUsdInput(entry > faucetMaxRequestAmount ? faucetMaxRequestAmount : entry))}
              >
                {formatUsdInput(entry > faucetMaxRequestAmount ? faucetMaxRequestAmount : entry)}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-950/80 p-4 text-sm text-emerald-100">
            <p className="font-semibold text-white">Funding preview</p>
            <p className="mt-2">
              You will mint <span className="font-semibold text-white">{formatUsd(parsedAmount)}</span> to{' '}
              <span className="font-semibold text-white">{shortAddress(game.account)}</span>.
            </p>
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
              onClick={() => void handleSubmit()}
            >
              {submitting || isPending ? (
                <>
                  <span className="action-btn__spinner" aria-hidden="true" />
                  Funding…
                </>
              ) : (
                <>Fund wallet</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
