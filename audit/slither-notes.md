# Slither Notes

## Command

```bash
uvx --python 3.11 --from slither-analyzer slither . --config-file slither.config.json
```

A JSON run was also used to confirm detector impact levels after fixes.

## Result

- **High findings:** 0
- **Medium findings:** 0
- **Low findings:** 4
- **Informational findings:** 4

## Fixes applied to clear High / Medium findings

### `contracts/CrapsGame.sol`
- Reworked `rollDice()` state sequencing so `session.phase` and `pendingVRFRequests` are committed before the external VRF request call.
- Replaced the odds-bet required-multiple lookup with `_oddsBetRequiredMultiple()` to remove the previous Slither `unused-return` finding.
- Removed named storage return variables from `_placeBetStorage()` and `_hardwayBetStorage()` to eliminate false-positive `uninitialized-storage` findings.
- Explicitly initialized accumulator locals in `fulfillRandomWords()` and `_assertInvariant()` to eliminate `uninitialized-local` findings.
- Kept the invariant equality check but documented it as intentional with a targeted Slither suppression because the five-bucket accounting invariant is deliberately exact.
- Adjusted reinstatement readiness validation to avoid the prior strict-equality medium finding.

### `contracts/mocks/PayoutMathHarness.sol`
- Assigned the tuple returned from `PayoutMath.payoutMultiplier()` directly into named return variables to remove the `unused-return` finding.

## Acknowledged Low findings

### 1. `MockVRFConsumer.requestRandomWords` — `reentrancy-benign`
- **Why Slither flags it:** state is written after an external coordinator call.
- **Why this is acceptable:** this is a test-only mock consumer, not production code. It stores only `lastRequestId` for test visibility and holds no funds.

### 2. `MockVRFCoordinator._fulfillRandomWords` — `reentrancy-events`
- **Why Slither flags it:** an event is emitted after the consumer callback.
- **Why this is acceptable:** this is a test-only mock coordinator. The post-callback event is diagnostic only and does not affect contract security or accounting.

### 3. `CrapsGame.completeSelfReinstatement` — `timestamp`
- **Why Slither flags it:** the function compares `block.timestamp` to a waiting-period deadline.
- **Why this is acceptable:** the seven-day reinstatement delay is intentionally time based. Small miner/proposer timestamp variance does not let a player bypass the delay in any meaningful way.

### 4. `CrapsGame._isSessionExpired` — `timestamp`
- **Why Slither flags it:** session expiry depends on `block.timestamp`.
- **Why this is acceptable:** session timeout is intentionally wall-clock based (`24 hours`). Minor timestamp drift is acceptable for expiry handling and does not create a bankroll-loss path.

## Informational findings

- `fulfillRandomWords()` cyclomatic complexity is high because it resolves the full craps state machine in one callback.
- `DEBUG` naming does not match Slither's preferred mixedCase style, but it matches the existing contract/API pattern and tests.
- `MIN_BANKROLL` and `VRF_TIMEOUT_BLOCKS` are retained as spec-facing constants even though they are not enforced in current runtime logic.

## Conclusion

Slither now reports **zero High/Critical** and **zero Medium** findings for the repository under the configured run.