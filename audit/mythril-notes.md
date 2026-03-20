# Mythril Notes

## Recommended command

```bash
pnpm audit:mythril
```

See also: `docs/security-running.md`

This runs `scripts/run-mythril.mjs`, which reads `mythril.config.json`, uses the committed compiler settings in `audit/mythril-solc-settings.json`, writes the JSON report to `audit/reports/mythril-report.json`, and fails the Phase 7 gate if any issue is detected.

Runner selection:

- `runner: auto` in `mythril.config.json` prefers a local `myth` binary when available
- CI forces `MYTHRIL_RUNNER=docker`
- local overrides are supported via `MYTHRIL_RUNNER=local` or `MYTHRIL_RUNNER=docker`

A reproducible local setup is:

```bash
python3.11 -m venv /tmp/mythril-venv
source /tmp/mythril-venv/bin/activate
pip install 'setuptools<81' 'mythril==0.24.8'
pnpm audit:mythril
```

## Repo-local configuration

Committed files used by the script:

- `mythril.config.json`
- `audit/mythril-solc-settings.json`

The analysis uses project-matching compiler settings:

```json
{
  "optimizer": { "enabled": true, "runs": 1 },
  "viaIR": true,
  "remappings": [
    "@openzeppelin/=node_modules/@openzeppelin/",
    "@chainlink/=node_modules/@chainlink/"
  ]
}
```

## Effective analyzer command

The wrapper runs the equivalent of:

```bash
myth analyze contracts/CrapsGame.sol \
  --execution-timeout 120 \
  --solv 0.8.24 \
  --solc-json audit/mythril-solc-settings.json \
  --solc-args "--base-path . --include-path node_modules --allow-paths .,$PWD/node_modules" \
  -o jsonv2
```

On CI, the same command is executed through the `mythril/myth` Docker image with `/src`-scoped paths.

## Result

Mythril completed successfully and reported no issues.

- **Vulnerabilities detected:** 0
- **Target analyzed:** `contracts/CrapsGame.sol`

## Interpretation

- No vulnerabilities were detected in `contracts/CrapsGame.sol` under the configured Mythril run.
- This result is consistent with the existing full test suite plus the additional Slither cleanup done in Phase 7.
- The contract still deserves normal pre-deployment human review, but Mythril did not identify exploitable paths in this pass.

## Conclusion

Mythril is now reproducible from committed repo state and participates in CI as an actual deployment gate.
