# Mythril Notes

## Environment notes

Mythril required a local Python 3.11 virtualenv with `setuptools<81` so the legacy `pkg_resources` import path remained available.
The direct Docker image path was not usable for source analysis on this machine because Mythril's internal `solc` bootstrap hit an architecture issue.

## Successful command

```bash
source /tmp/mythril-venv/bin/activate
myth analyze contracts/CrapsGame.sol \
  --execution-timeout 120 \
  --solc-json /tmp/myth-solc-settings.json \
  --solc-args "--base-path . --include-path node_modules --allow-paths .,$PWD/node_modules"
```

Where `/tmp/myth-solc-settings.json` contained:

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

## Result

Mythril completed successfully and reported:

> The analysis was completed successfully. No issues were detected.

## Interpretation

- No vulnerabilities were detected in `contracts/CrapsGame.sol` under the configured Mythril run.
- This result is consistent with the existing full test suite plus the additional Slither cleanup done in Phase 7.
- The contract still deserves normal pre-deployment human review, but Mythril did not identify exploitable paths in this pass.

## Follow-up

If this analysis is repeated in CI or another environment, prefer:
- Python 3.11
- `setuptools<81`
- explicit solc remappings for `@openzeppelin` and `@chainlink`
- matching `viaIR`/optimizer settings with `hardhat.config.ts`
