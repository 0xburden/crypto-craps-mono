# Phase 7 Security Checks

Use this guide to rerun the Phase 7 security gate locally or in CI.

## Commands

```bash
pnpm audit:slither
pnpm audit:mythril
pnpm audit:phase7
```

What they do:
- `pnpm audit:slither` runs Slither, writes `audit/reports/slither-report.json`, and fails on any **High** or **Medium** finding.
- `pnpm audit:mythril` runs Mythril against `contracts/CrapsGame.sol`, writes `audit/reports/mythril-report.json`, and fails if Mythril reports any issues.
- `pnpm audit:phase7` runs both gates.

## Prerequisites

Install project dependencies first:

```bash
pnpm install --frozen-lockfile
```

### Slither

The Slither wrapper expects `uvx` to be available.

Recommended setup:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
pnpm audit:slither
```

## Mythril local setup

On local machines, especially Apple Silicon, the most reliable path is a Python 3.11 virtualenv with a pinned setuptools version:

```bash
python3.11 -m venv /tmp/mythril-venv
source /tmp/mythril-venv/bin/activate
pip install 'setuptools<81' 'mythril==0.24.8'
pnpm audit:mythril
```

Notes:
- The wrapper reads `mythril.config.json`.
- Compiler/remapping settings live in `audit/mythril-solc-settings.json`.
- If a local `myth` binary is available, it is preferred by default.

## Mythril runner selection

Supported overrides:

```bash
MYTHRIL_RUNNER=local pnpm audit:mythril
MYTHRIL_RUNNER=docker pnpm audit:mythril
```

Behavior:
- `local` uses the installed `myth`/`mythril` binary.
- `docker` uses the `mythril/myth` image.
- `auto` is the default from `mythril.config.json`.

CI forces Docker for Mythril.

## Output artifacts

Generated reports are written to:
- `audit/reports/slither-report.json`
- `audit/reports/mythril-report.json`

These files are ignored by git and uploaded as CI artifacts.

## CI enforcement

GitHub Actions runs three relevant jobs:
- `test`
- `slither`
- `mythril`

A Phase 7 regression should fail CI if:
- Slither reports any **High** or **Medium** finding
- Mythril reports any issue

## Related files

- `.github/workflows/ci.yml`
- `scripts/run-slither.mjs`
- `scripts/run-mythril.mjs`
- `slither.config.json`
- `mythril.config.json`
- `audit/slither-notes.md`
- `audit/mythril-notes.md`
- `audit/security-checklist.md`
