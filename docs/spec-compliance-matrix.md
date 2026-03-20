# Spec Compliance Matrix — Phases 0–5

Generated: 2026-03-20

Scope:
- `TASKS.md` phases 0–5
- relevant behavioral requirements in `PLAN.md`
- current repository state only

Method:
- inspected source, tests, and config files
- ran the documented/related validation commands where possible
- classified each item as one of:
  - **Compliant**
  - **Partially compliant**
  - **Non-compliant**
  - **TASKS/PLAN conflict**
  - **Historically not re-verifiable** (repo has moved past that phase gate)

---

## Executive summary

Overall verdict: **Partially compliant** against `TASKS.md` **and** `PLAN.md` together.

Why not fully compliant:
1. `TASKS.md` and `PLAN.md` contain a few direct conflicts.
2. Clean compile still emits contract-size warnings, so some TASKS exit criteria are not met literally.
3. Several PLAN-only requirements are not implemented yet in the current contract/test suite.
4. One TASKS exit command for Phase 5 does not currently work as written.

### Source-doc conflicts that need reconciliation first

| Topic | `TASKS.md` | `PLAN.md` | Current repo |
|---|---|---|---|
| Session start | `openSession()` exists and is required (`TASKS.md:166`) | first bet transitions `INACTIVE -> COME_OUT` (`PLAN.md:158-175`) | repo follows **TASKS** (`contracts/CrapsGame.sol:196`) |
| Don't Pass removal timing | suggests take-down after point established (`TASKS.md:178`) | explicitly removable at any time (`PLAN.md:544-555`) | repo follows **PLAN** (`contracts/CrapsGame.sol:516-533`) |
| VRF dice derivation | `die2 = ((randomWord >> 8) % 6) + 1` (`TASKS.md:186`) | `die2 = (random / 6 % 6) + 1` (`PLAN.md:944`) | repo follows **TASKS** (`contracts/CrapsGame.sol:1142-1143`) |

Because of these conflicts, some rows below are marked `TASKS/PLAN conflict` rather than plain pass/fail.

---

## Commands run

### Passing
- `pnpm test` → **78 passing**
- `pnpm clean && pnpm compile` → compile succeeds, but with warnings
- `npx hardhat test test/unit/PayoutMath.test.ts` → **4 passing**
- `npx hardhat test test/unit/Mocks.test.ts` → **2 passing**
- `npx hardhat test test/unit/Vault.test.ts` → **18 passing**
- `npx hardhat test test/unit/Session.test.ts test/unit/Exclusion.test.ts test/unit/GameCore.test.ts` → **17 passing**
- `npx hardhat test test/unit/OddsBets.test.ts test/unit/ComeBets.test.ts test/unit/PlaceBets.test.ts test/unit/HardwayBets.test.ts test/unit/PropBets.test.ts test/unit/WorstCaseAudit.test.ts` → **22 passing**
- `npx hardhat coverage` → **98.13% lines overall**
- `node scripts/check-vault-coverage.mjs` → **100.00%** selected vault-function line coverage

### Failing / mismatched against docs
- `npx hardhat test test/integration/` → fails with `MODULE_NOT_FOUND` for `test/integration`

---

## Phase 0 — Project Scaffold

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 0.1 | Hardhat TS project initialized | Compliant | `package.json`, `hardhat.config.ts`, `tsconfig.json` present | Current repo clearly has mature Hardhat TS setup |
| 0.2 | Required dependencies installed | Compliant | `package.json:16-28` | Includes required deps plus reasonable extras (`ts-node`, `typescript`, `dotenv`) |
| 0.3 | Required directory structure exists | Compliant | `contracts/`, `contracts/interfaces/`, `contracts/libraries/`, `contracts/mocks/`, `test/unit/`, `test/integration/`, `ignition/modules/`, `frontend/` | Verified present |
| 0.4 | Hardhat config: Solidity, BASE networks, Basescan, gas reporter, coverage | Compliant | `hardhat.config.ts:11-71` | Includes `0.8.24`, `baseSepolia`, `base`, `etherscan`, `gasReporter`, `solidity-coverage` |
| 0.5 | `.env.example` variables present | Compliant | `.env.example:1-6` | All required vars present |
| 0.6 | Slither/Mythril config stubs present | Compliant | `slither.config.json`, `mythril.config.json` | Present |
| 0.7 | CI stub on push | Compliant | `.github/workflows/ci.yml:8-21` | CI runs install, compile, test |
| Exit criterion | `npx hardhat compile` on empty `contracts/` dir | Historically not re-verifiable | repo no longer has empty `contracts/` | Current repo has progressed beyond this point |
| Exit criterion | `npx hardhat test` with 0 passing because no tests yet | Historically not re-verifiable | repo now contains many tests | No longer a replayable gate |

### Phase 0 assessment
**Compliant for artifacts/config.** Historical early-phase exit gates are no longer replayable in the current progressed repo.

---

## Phase 1 — Core Libraries, Interfaces & Mocks

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 1.1 | `PayoutMath.sol` implemented | Compliant | `contracts/libraries/PayoutMath.sol:12-281` | Includes `payoutMultiplier` and `maxPossiblePayout` |
| 1.1c | Payout math tests cover payout table and worst cases | Compliant | `test/unit/PayoutMath.test.ts:65-161` | `npx hardhat test test/unit/PayoutMath.test.ts` → 4 passing |
| 1.2 | `ICrapsGame.sol` enums/structs/events/errors/signatures | Compliant | `contracts/interfaces/ICrapsGame.sol:4-171` | Present |
| 1.3 | `MockERC20` with 6 decimals, mint, permit | Compliant | `contracts/mocks/MockERC20.sol:5-20` | Uses `ERC20Permit`, overrides `decimals()`, exposes `mint()` |
| 1.4 | `MockVRFCoordinator` with pending requests and test fulfillment | Compliant | `contracts/mocks/MockVRFCoordinator.sol:11-185` | Stores `pendingRequests`, exposes `fulfillRandomWords()` |
| 1.5 | Mock tests present | Compliant | `test/unit/Mocks.test.ts:6-85` | `npx hardhat test test/unit/Mocks.test.ts` → 2 passing |
| Exit criterion | compile zero errors, zero warnings | **Non-compliant** | `pnpm clean && pnpm compile` | Compile succeeds, but emits contract-size warnings for `contracts/CrapsGame.sol` and `contracts/mocks/CrapsGameHarness.sol` |

### Phase 1 assessment
**Implementation is compliant. Exit criterion is not fully compliant because compile is not warning-free.**

---

## Phase 2 — CrapsVault Contract

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 2.1 | Five-bucket accounting in `CrapsGame.sol` | Compliant | `contracts/CrapsGame.sol:50-73` | `_available`, `_inPlay`, `_reserved`, `bankroll`, `accruedFees`, totals present |
| 2.1a | `deposit()` | Compliant | `contracts/CrapsGame.sol:115-129` | Fee charged and credited correctly |
| 2.1b | `withdraw()` | Compliant | `contracts/CrapsGame.sol:132-149` | Not blocked by pause |
| 2.1c | `_debitAvailable()` | Compliant | `contracts/CrapsGame.sol:744-759` | Moves available -> inPlay |
| 2.1d | `_creditAvailable()` | Compliant | `contracts/CrapsGame.sol:761-778` | Moves inPlay -> available |
| 2.1e | `_reserveFromBankroll()` | Compliant | `contracts/CrapsGame.sol:780-793` | Moves bankroll -> reserved |
| 2.1f | `_releaseReserve()` | Compliant | `contracts/CrapsGame.sol:795-812` | Returns unused reserve to bankroll, payout to available |
| 2.1g | `withdrawFees()` | Compliant | `contracts/CrapsGame.sol:152-160` | `onlyOwner` |
| 2.1h | `fundBankroll()` | Compliant | `contracts/CrapsGame.sol:163-170` | `onlyOwner` |
| 2.1i | `withdrawBankroll()` requires pause | Compliant | `contracts/CrapsGame.sol:173-185` | Also adds `pendingVRFRequests == 0` guard, aligning with PLAN |
| 2.1j | invariant helper | Compliant | `contracts/CrapsGame.sol:1082-1105` | `_assertInvariant()` and `DEBUG` path present |
| 2.2 | Vault test harness/scaffold | Compliant | `contracts/mocks/CrapsGameHarness.sol:6-80`, `test/unit/Vault.test.ts:19-419` | Present |
| 2.3 | Vault tests | Compliant | `test/unit/Vault.test.ts` | `npx hardhat test test/unit/Vault.test.ts` → 18 passing |
| Constants | `DEPOSIT_FEE_BPS`, `MIN_BANKROLL`, `INITIAL_BANKROLL` exact | Compliant | `contracts/CrapsGame.sol:16-18` | Match TASKS |
| Exit criterion | Vault selected coverage ≥95% | Compliant | `node scripts/check-vault-coverage.mjs` | Output: 100.00% (124/124) |
| Exit criterion | compile zero warnings | **Non-compliant** | `pnpm clean && pnpm compile` | Same contract-size warnings as Phase 1 |

### PLAN overlay for Phase 2

| PLAN requirement | Status | Evidence | Notes |
|---|---|---|---|
| Single-contract architecture | Compliant | `contracts/CrapsGame.sol` contains vault + game logic | Aligns with PLAN |
| `withdrawBankroll` requires `paused && pendingVRFRequests == 0` | Compliant | `contracts/CrapsGame.sol:173-185` | Aligns with PLAN better than TASKS alone |
| Deployment-tracked `initialBankroll` | **Non-compliant** | `contracts/CrapsGame.sol:18`, `contracts/CrapsGame.sol:735` | Current code returns constant `INITIAL_BANKROLL`, not deployment-funded initial bankroll from PLAN |
| Bankroll health threshold events + auto-pause | **Non-compliant** | no `BankrollWarning` / `BankrollCritical` symbols in `contracts/` | PLAN requires thresholds/events at `PLAN.md:1191-1199`, `1289-1290` |
| Token decimals constructor parameter | **Non-compliant** | `contracts/CrapsGame.sol:80-92` | PLAN token config expects `_tokenDecimals`; current constructor does not accept/store it |

### Phase 2 assessment
**TASKS implementation mostly compliant; compile-warning exit criterion fails. PLAN overlay is not fully satisfied.**

---

## Phase 3 — Session + Core Bets

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 3.1 | Session lifecycle implemented | **TASKS compliant / PLAN conflict** | `contracts/CrapsGame.sol:196-245` | `openSession()` exists and works per TASKS, but PLAN says first bet should start session |
| 3.1e | Session tests | Compliant | `test/unit/Session.test.ts:7-121` | Included in 17-pass run |
| 3.2 | Self-exclusion system | Compliant | `contracts/CrapsGame.sol:248-293` | Uses shared `_expireSession()` path, matching PLAN |
| 3.2e | Exclusion tests | Compliant | `test/unit/Exclusion.test.ts:6-95` | Included in 17-pass run |
| 3.3 | Pass/Don't Pass/Field placement | **Partially compliant** | `contracts/CrapsGame.sol:296-472` | Placement logic is present and tested; removal semantics are affected by TASKS/PLAN conflict on Don't Pass removability |
| 3.4 | `rollDice()` request path | Compliant | `contracts/CrapsGame.sol:687-720` | Uses `PayoutMath.maxPossiblePayout`, reserves bankroll, enters `ROLL_PENDING` |
| 3.5 | `fulfillRandomWords()` callback | **TASKS compliant / PLAN conflict** | `contracts/CrapsGame.sol:1107-1400` | Non-reverting behavior present; die derivation follows TASKS, not PLAN |
| 3.6 | `getPlayerState()` | **Partially compliant** | `contracts/CrapsGame.sol:722-741` | Returns full state, but `initialBankroll` is constant-backed rather than PLAN deployment-backed |
| 3.7 | Core game tests | Compliant | `test/unit/GameCore.test.ts:6-219` | Included in 17-pass run |
| Exit criterion | no `require` in `fulfillRandomWords` | Compliant | `contracts/CrapsGame.sol:1107-1400` | Verified by grep and code inspection |

### Phase 3 assessment
**Functionally compliant to TASKS, but not fully compliant to TASKS+PLAN because session-start semantics and dice-derivation semantics conflict across source docs.**

---

## Phase 4 — Full Bet Suite

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 4.1 | Odds bets | Compliant | `contracts/CrapsGame.sol:326-369`, `test/unit/OddsBets.test.ts` | `npx hardhat test ...` → covered in 22-pass run |
| 4.2 | Come / Don't Come | Compliant | `contracts/CrapsGame.sol:371-402`, callback loops in `1149-1237`, `test/unit/ComeBets.test.ts` | Implemented and tested |
| 4.3 | Place bets | Compliant | `contracts/CrapsGame.sol:404-433`, `673-685`, callback place resolution, `test/unit/PlaceBets.test.ts` | Includes working toggle |
| 4.4 | Hardways | Compliant | `contracts/CrapsGame.sol:445-455`, `1288-1338`, `test/unit/HardwayBets.test.ts` | Implemented and tested |
| 4.5 | One-roll props incl. Horn | Compliant | `contracts/CrapsGame.sol:457-472`, `1340-1388`, `test/unit/PropBets.test.ts` | Implemented and tested |
| 4.6 | Worst-case reserve audit | Compliant | `test/unit/WorstCaseAudit.test.ts:7-56` | 19.6k case verified |
| Exit criterion | all unit test files in `test/unit/` pass | Compliant | `pnpm test` → 78 passing; targeted unit runs all passed | Satisfied |
| Exit criterion | `npx hardhat coverage` ≥95% line coverage across contract files | Compliant | `npx hardhat coverage` output | `CrapsGame.sol` 97.97%, `PayoutMath.sol` 99.17%, all files 98.13% |

### PLAN overlay for Phase 4

| PLAN requirement | Status | Evidence | Notes |
|---|---|---|---|
| All 8 complex resolution scenarios have dedicated integration tests | **Partially compliant** | `test/integration/*.ts`, plus relevant unit tests | Coverage exists across unit+integration, but not as 8 dedicated integration scenarios as PLAN Phase 2 gate specifies (`PLAN.md:396-406`, `1322`) |
| Place OFF bets still swept on 7 | Compliant | `test/unit/PlaceBets.test.ts:103` | Present |
| Pending vs established Come bets resolve oppositely on 7 | Compliant | `test/unit/ComeBets.test.ts:76` | Present |

### Phase 4 assessment
**Compliant to TASKS. Partially compliant to TASKS+PLAN because the PLAN’s dedicated integration-scenario gate is not implemented in that exact form.**

---

## Phase 5 — Integration Tests

| ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| 5.1 | happy path deposit -> play -> withdraw | Compliant | `test/integration/sessionFlows.test.ts` | Present; included in `pnpm test` |
| 5.2 | active session expiry | Compliant | `test/integration/sessionFlows.test.ts` | Present |
| 5.3 | pending session expiry + late callback noop | Compliant | `test/integration/sessionFlows.test.ts` | Present |
| 5.4 | insufficient bankroll mid-session | Compliant | `test/integration/exclusionAndSolvency.test.ts` | Present |
| 5.5 | self-exclusion lifecycle | Compliant | `test/integration/exclusionAndSolvency.test.ts` | Present |
| 5.6 | operator exclusion | Compliant | `test/integration/exclusionAndSolvency.test.ts` | Present |
| 5.7 | multiplayer concurrent sessions | Compliant | `test/integration/multiplayerAndPause.test.ts` | Present |
| 5.8 | emergency pause + bankroll recovery | Compliant | `test/integration/multiplayerAndPause.test.ts` | Present |
| 5.9 | 200-step invariant suite | Compliant | `test/integration/invariantRandom.test.ts:8-347` | `STEP_COUNT = 200` |
| 5.10 | gas profiling baseline committed | Compliant | `gas-report-baseline.json` | File exists and includes `deposit`, `withdraw`, `rollDice`, `expireSession`, `fulfillRandomWords` entries |
| Exit criterion | `npx hardhat test test/integration/` passes | **Non-compliant** | command run directly | Current repo fails this exact documented command with `MODULE_NOT_FOUND` |
| Exit criterion | invariant never violated across 200 random sequences | Compliant | `test/integration/invariantRandom.test.ts`, `pnpm test` | Passes |
| Exit criterion | gas baseline report committed | Compliant | `gas-report-baseline.json` | Present |

### PLAN overlay for Phase 5-equivalent behavior

| PLAN requirement | Status | Evidence | Notes |
|---|---|---|---|
| testnet/mainnet deployment phases | Out of scope here | PLAN phases 3–5 | Not part of TASKS 0–5 review |
| frontend table-health uses real `initialBankroll` context | **Non-compliant / blocked by earlier drift** | `contracts/CrapsGame.sol:735` | Current `initialBankroll` is constant-backed |

### Phase 5 assessment
**Integration behavior is implemented and passing under `pnpm test`, but the exact TASKS exit command is currently non-compliant.**

---

## Additional repo findings relevant to compliance

### Compile warnings
Running `pnpm clean && pnpm compile` emits contract-size warnings for:
- `contracts/CrapsGame.sol`
- `contracts/mocks/CrapsGameHarness.sol`

This keeps Phase 1 and Phase 2 from being literally compliant with their zero-warning exit criteria.

### Coverage results
From `npx hardhat coverage`:
- `contracts/CrapsGame.sol` — **97.97% lines**
- `contracts/libraries/PayoutMath.sol` — **99.17% lines**
- all files — **98.13% lines**

### Current best single-line summary
The repo is **functionally ahead in many areas**, but **strictly against TASKS.md + PLAN.md together** it is only **partially compliant**, because:
- some source requirements conflict,
- some TASKS exit criteria are not literally satisfied,
- and some PLAN-only architectural requirements remain unimplemented.

---

## Recommended next actions

1. **Resolve source-doc conflicts first**
   - choose one source of truth for:
     - session start (`openSession()` vs first bet starts session)
     - Don't Pass removal timing
     - VRF dice derivation formula

2. **Fix literal TASKS non-compliance**
   - make compile warning-free, or update the spec if that is no longer realistic
   - make `npx hardhat test test/integration/` work as documented, or update the documented validation command

3. **Fix PLAN-only drifts**
   - deployment-tracked `initialBankroll`
   - bankroll threshold events / health logic / auto-pause behavior
   - add the missing dedicated complex integration scenarios if PLAN remains authoritative
