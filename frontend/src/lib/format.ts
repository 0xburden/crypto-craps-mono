import { formatUnits, parseUnits } from 'viem';

export const TOKEN_DECIMALS = 6;

export const formatUsd = (
  value: bigint | null | undefined,
  digits = 2,
  prefix = '$',
) => {
  const normalized = value ?? 0n;
  const formatted = Number(formatUnits(normalized, TOKEN_DECIMALS)).toLocaleString(
    undefined,
    {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    },
  );

  return `${prefix}${formatted}`;
};

export const formatCompactUsd = (value: bigint | null | undefined) => {
  const normalized = Number(formatUnits(value ?? 0n, TOKEN_DECIMALS));

  if (normalized >= 1_000_000) {
    return `$${(normalized / 1_000_000).toFixed(1)}m`;
  }

  if (normalized >= 1_000) {
    return `$${(normalized / 1_000).toFixed(1)}k`;
  }

  return `$${normalized.toFixed(2)}`;
};

export const parseUsdInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0n;
  }

  return parseUnits(trimmed, TOKEN_DECIMALS);
};

export const formatUsdInput = (value: bigint | null | undefined) => {
  const normalized = formatUnits(value ?? 0n, TOKEN_DECIMALS);
  if (!normalized.includes('.')) {
    return normalized;
  }

  return normalized.replace(/0+$/u, '').replace(/\.$/u, '');
};

export const shortAddress = (value?: string) => {
  if (!value) {
    return 'Not connected';
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

export const formatCountdown = (seconds: number) => {
  if (seconds <= 0) {
    return '00:00:00';
  }

  const hrs = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${hrs}:${mins}:${secs}`;
};

export const percentage = (numerator: bigint, denominator: bigint) => {
  if (denominator === 0n) {
    return 0;
  }

  return Number((numerator * 10_000n) / denominator) / 100;
};
