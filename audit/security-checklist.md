# Security Checklist

Phase 7 manual review of `contracts/CrapsGame.sol` and related runtime paths.

## 7.3a Reentrancy: all vault mutations guarded by `ReentrancyGuard`
- **Verified:** Yes.
- `deposit`, `withdraw`, `withdrawFees`, `fundBankroll`, `withdrawBankroll`, `openSession`, `closeSession`, `expireSession`, `selfExclude`, `operatorExclude`, `placeBet`, `placeIndexedBet`, `removeBet`, `removeIndexedBet`, `setPlaceWorking`, and `rollDice` are all `nonReentrant`.
- Token transfer entrypoints are covered by the same guard.

## 7.3b VRF manipulation: only VRF coordinator can call `fulfillRandomWords`
- **Verified:** Yes.
- `CrapsGame` inherits `VRFConsumerBaseV2Plus`.
- The base contract's `rawFulfillRandomWords()` checks `msg.sender == address(s_vrfCoordinator)` before dispatching to the internal override.
- `CrapsGame.fulfillRandomWords()` itself is `internal`, so it is not directly user-callable.

## 7.3c Callback revert impossibility: zero `require` / `revert` inside `fulfillRandomWords`
- **Verified:** Yes.
- Checked with grep over the callback line range after the Phase 7 edits.
- Result: no `require(` and no `revert(` inside `fulfillRandomWords`.

## 7.3d Access control: `onlyOwner` on all administrative functions
- **Verified:** Yes.
- Administrative entrypoints gated by `onlyOwner`:
  - `withdrawFees`
  - `fundBankroll`
  - `withdrawBankroll`
  - `pause`
  - `unpause`
  - `operatorExclude`
  - `operatorReinstate`
- Ownership is inherited from Chainlink's `ConfirmedOwner` through `VRFConsumerBaseV2Plus`.

## 7.3e Integer overflow protection
- **Verified:** Yes.
- The contract is compiled with Solidity `0.8.24`, which provides checked arithmetic by default.
- `unchecked` blocks appear only after explicit bounds checks and bucket-balance validations.
- Slither Medium/High arithmetic-related findings were cleared; Mythril also reported no issues.

## 7.3f No floating point in payout math
- **Verified:** Yes.
- `contracts/libraries/PayoutMath.sol` uses integer numerator/denominator math only.
- No floating-point types or fixed-point libraries are used.

## 7.3g Invariant manual trace: no bucket leakage
- **Verified:** Yes.
- Manual path reviewed:
  1. `deposit()` moves tokens into contract, splits fee into `accruedFees`, credits player `_available`.
  2. `placeBet()` debits `_available` into `_inPlay`.
  3. `rollDice()` reserves worst-case payout from `bankroll` into `_reserved[player]`.
  4. `fulfillRandomWords()` moves resolved bet principal from `_inPlay` either back to `_available` or into `bankroll`, then releases reserve through `_softReleaseReserve()`.
  5. `withdraw()` transfers only from `_available`.
- The full automated suite still passes, including the randomized invariant test in `test/integration/invariantRandom.test.ts`.

## 7.3h Exclusion bypass via `openSession` or `placeBet`
- **Verified:** Prevented.
- `openSession`, `placeBet`, `placeIndexedBet`, and `rollDice` all use `notExcluded`.
- `selfExclude()` and `operatorExclude()` also close/expire active sessions immediately.
- Integration coverage exists in `test/integration/exclusionAndSolvency.test.ts`.

## 7.3i `withdraw()` remains available while paused
- **Verified:** Yes.
- `withdraw()` does **not** use `whenNotPaused`.
- Integration test `test/integration/multiplayerAndPause.test.ts` explicitly verifies that pause blocks gameplay but still allows withdrawals.

## 7.4 Gas optimization pass
- Reviewed `rollDice` and `fulfillRandomWords` for avoidable storage work.
- Applied low-risk improvements:
  - cached `msg.sender` as `player` in `rollDice`
  - committed `session.phase` / `pendingVRFRequests` before the external VRF request call
  - replaced odds multiple inference through `PayoutMath.payoutMultiplier()` with direct `_oddsBetRequiredMultiple()` logic
  - cleaned up local initialization patterns to reduce analyzer noise and keep generated IR simpler
- Updated gas baseline with `REPORT_GAS=true pnpm test`.

## Gas baseline snapshot
- `deposit(uint256)` avg: **167,062** gas
- `withdraw(uint256)` avg: **86,276** gas
- `rollDice()` avg: **581,208** gas
- `rollDice()` min/max: **523,036 / 610,022** gas
- `MockVRFCoordinator.fulfillRandomWords(uint256,uint256[])` avg: **174,299** gas
- `MockVRFCoordinator.fulfillRandomWords(uint256,uint256[])` min/max: **58,836 / 327,411** gas
- `expireSession(address)` avg: **194,164** gas

## Overall conclusion
- Manual checklist items: **9 / 9 verified**
- Static analysis gate status:
  - Slither: **0 High/Critical, 0 Medium**
  - Mythril: **0 issues detected**
- Reproducible security commands:
  - `pnpm audit:slither`
  - `pnpm audit:mythril`
  - `pnpm audit:phase7`
- Runbook: `docs/security-running.md`
- CI now enforces the static-analysis gate and uploads the generated reports from `audit/reports/`.
- Post-review full suite status: **passing**
