# Phase 9 QA — Frontend Validation Notes

**Generated:** 2026-03-25  
**Reviewer:** delta (QA/docs teammate)  
**Phase:** 9 (Frontend)

---

## Contract vs. TASKS.md Discrepancies

### 1. Event name mismatch — `RollResult` vs `RollResolved`

| Location | Event name |
|---|---|
| TASKS.md task 9.5 | `RollResult` |
| ICrapsGame.sol / CrapsGame.sol | `RollResolved` |

**Finding:** The contract emits `RollResolved(address indexed player, uint256 indexed requestId, uint8 die1, uint8 die2, uint256 payout)`. TASKS.md task 9.5 references `RollResult`. Frontend event subscriptions must use the correct on-chain name `RollResolved`.

**Impact:** Low. Frontend code using the TASKS name would fail to subscribe to any events and silently miss roll results.

**Recommendation:** Fix TASKS.md task 9.5 to read `watch for RollResolved event` instead of `RollResult`.

---

### 2. Indexed bet functions not mentioned in TASKS frontend tasks

TASKS.md Phase 9 tasks cover `placeBet` / `removeBet` but the contract also exposes:

| Function | Purpose |
|---|---|
| `placeIndexedBet(BetType, index, amount)` | Place Come / Don't Come bet at a specific slot index (0–3) |
| `removeIndexedBet(BetType, index)` | Remove a Come / Don't Come bet at a specific slot |
| `setPlaceWorking(placeNumber, working)` | Toggle Place bet ON/OFF |

These are necessary for the full UI — specifically the four Come / Don't Come slots and the Place bet working toggle.

**Recommendation:** Frontend team (alpha/beta/gamma) must implement `placeIndexedBet` / `removeIndexedBet` for Come/Don't Come slots and wire `setPlaceWorking` to the Place bet toggle UI. This is not a contract gap — the functions exist and are tested.

---

### 3. `token()` view function useful for frontend

The contract exposes `token() external view returns (address)`. The frontend should call this to confirm which token the contract is bound to, rather than relying solely on `VITE_SEPOLIA_TOKEN_ADDRESS`. This is especially useful if the contract is ever redeployed with a different token.

**Recommendation:** The `useCrapsGame` hook or a dedicated `useToken` hook should call `token()` on mount and surface a mismatch warning if it differs from the configured `VITE_SEPOLIA_TOKEN_ADDRESS`.

---

### 4. BetType enum indices

The frontend needs the exact integer indices for `placeBet` / `placeIndexedBet`. These are defined in `ICrapsGame.sol`:

```
0  PASS_LINE         13 PLACE_10
1  PASS_LINE_ODDS    14 FIELD
2  DONT_PASS         15 HARD_4
3  DONT_PASS_ODDS    16 HARD_6
4  COME              17 HARD_8
5  COME_ODDS         18 HARD_10
6  DONT_COME         19 ANY_7
7  DONT_COME_ODDS    20 ANY_CRAPS
8  PLACE_4           21 CRAPS_2
9  PLACE_5           22 CRAPS_3
10 PLACE_6           23 YO (11)
11 PLACE_8           24 TWELVE
12 PLACE_9           25 HORN
```

The `frontend/src/abi/CrapsGame.json` will include these as named constants via wagmi's type generation (`wagmi generate`). Manual wiring should reference these by name, not raw integers.

---

### 5. `totalBankroll` returned in `PlayerState` but undocumented in TASKS

`PlayerState` (ICrapsGame.sol) includes `totalBankroll` and `initialBankroll`. The `totalBankroll` field is not mentioned in TASKS.md but is present in the contract struct. It represents the aggregate of all players' `_available` + `_inPlay` + `_reserved` plus the house `bankroll` — i.e., the sum of all fund buckets.

**Note:** `initialBankroll` is currently a constant-backed value (`INITIAL_BANKROLL`), not a deployment-tracked running total as some PLAN.md sections suggest. See `docs/spec-compliance-matrix.md` for full discussion of this drift. Frontend use of `initialBankroll` for bankroll-health display is acceptable but should not be treated as a live tracked value.

---

## TASKS.md Checklist for Phase 9

| ID | Task | Status | Notes |
|---|---|---|---|
| 9.1 | Scaffold React + wagmi v2 + viem v2 + RainbowKit | [~] | Scaffold underway by alpha |
| 9.2 | Wallet & Balance component | [~] | Underway |
| 9.3 | Deposit/Withdraw with approval + fee display | [~] | Underway |
| 9.4 | Game Table component (all bet slots) | [~] | Underway; must also wire indexed bet functions and working toggle |
| 9.5 | Roll + state sync (watch `RollResolved`) | [~] | Underway; **TASKS says `RollResult` — must use `RollResolved`** |
| 9.6 | Session management UI + timer + exclusion | [~] | Underway |
| 9.7 | ABI export + `useCrapsGame` hook | [~] | Underway; `pnpm export:abi` added to root package.json |
| 9.8 | Exclusion / Responsible Gambling panel | [~] | Underway |
| 9.9 | Connect to Sepolia + browser smoke test | [~] | Pending; requires scaffold + component completion first |

---

## Root Package Scripts Added

| Script | Purpose |
|---|---|
| `pnpm export:abi` | Copies `CrapsGame.json` ABI from Hardhat artifacts to `frontend/src/abi/CrapsGame.json` |

Run after any contract change that modifies the ABI:
```bash
pnpm export:abi
```

---

## Spec Compliance Notes (Frontend-relevant drift from `docs/spec-compliance-matrix.md`)

| Item | Status | Frontend Implication |
|---|---|---|
| `initialBankroll` constant-backed | Drift from PLAN | Bankroll health display should use `bankroll / initialBankroll` from PlayerState; do not expect a deployment-tracked live value |
| `BankrollWarning` / `BankrollCritical` events not in contract | Drift from PLAN | These events will never fire; frontend bankroll health bar must be based solely on `PlayerState.bankroll` / `PlayerState.totalBankroll` |
| `getPlayerState` fully implemented | Compliant | Frontend state management relies on this; no additional RPC calls needed |
| `withdraw()` not blocked by `paused()` | Compliant | Exclusion/pause screens can always show a working Withdraw button |

---

## Exit Criteria Assessment (Phase 9)

| Exit Criterion | Assessment |
|---|---|
| Full player flow end-to-end on BASE Sepolia in browser | **Pending** — requires 9.1–9.8 complete |
| All bet types placeable from UI | **Pending** — requires Come/Don't Come indexed slots + working toggle |
| VRF callback reflected without page refresh | **Pending** — requires `RollResolved` event subscription (not `RollResult`) |
| Mobile-responsive layout | **Pending** — landscape gate and responsive table layout |

---

## Summary

Phase 9 frontend scaffold and component work is underway. Key QA findings for the frontend team:

1. **Fix before smoke test:** TASKS.md 9.5 uses `RollResult`; the contract emits `RollResolved`. Fix the event name in all event subscriptions before browser smoke test.
2. **Wire indexed bet functions:** `placeIndexedBet` / `removeIndexedBet` / `setPlaceWorking` must be implemented for Come/Don't Come slots and Place bet toggles.
3. **`pnpm export:abi`** is now available from the repo root after contract changes.
4. **Bankroll health:** The `BankrollWarning`/`BankrollCritical` events are not in the contract. Use `bankroll / initialBankroll` from `PlayerState` for the health indicator.
