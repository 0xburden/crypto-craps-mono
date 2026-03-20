# TASKS.md — On-Chain Craps (BASE) Agent Task Tracking

> **How to use this file:**
> Each phase is a self-contained unit of work designed to be handed to a **leader agent** that
> coordinates a subagent swarm. Assign phases **sequentially** — each phase has hard dependencies
> on the outputs of the one before it. Within a phase, tasks marked with the same dependency tier
> can be parallelized across subagents.
>
> **Status legend:** `[ ]` Not started · `[~]` In progress · `[x]` Complete · `[!]` Blocked
>
> **Key files referenced by all agents:**
> - `PLAN.md` — Full architecture spec, payout tables, invariant derivations, design decisions
> - `TASKS.md` — This file. Update task status as work completes.
> - `.env.example` — Required environment variable template
> - `hardhat.config.ts` — Chain configs, Solidity version, plugin list

---

## Phase 0 — Project Scaffold

**Goal:** Establish the repository skeleton that every subsequent phase builds on. No contract logic.
**Parallelizable:** Tasks 0.3–0.5 can run concurrently once 0.1–0.2 are done.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 0.1 | Initialize Hardhat TypeScript project (`npx hardhat init`) | Scaffold agent | [x] |
| 0.2 | Install all dependencies (see `package.json` spec below) | Scaffold agent | [x] |
| 0.3 | Create directory structure: `contracts/`, `contracts/interfaces/`, `contracts/libraries/`, `contracts/mocks/`, `test/unit/`, `test/integration/`, `ignition/modules/`, `frontend/` | Scaffold agent | [x] |
| 0.4 | Configure `hardhat.config.ts`: Solidity `^0.8.24`, BASE Mainnet + BASE Sepolia networks, Etherscan/Basescan verification, `hardhat-gas-reporter`, `solidity-coverage` | Config agent | [x] |
| 0.5 | Create `.env.example` with all required variables: `DEPLOYER_PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`, `BASE_MAINNET_RPC_URL`, `BASESCAN_API_KEY`, `VRF_SUBSCRIPTION_ID`, `INITIAL_BANKROLL_AMOUNT` | Config agent | [x] |
| 0.6 | Add `slither.config.json` and `mythril` config stubs (to be run in Phase 7) | Config agent | [x] |
| 0.7 | Commit scaffold with CI stub (GitHub Actions: `npm test` on push) | CI agent | [x] |

**Required `package.json` dependencies:**
```json
{
  "devDependencies": {
    "hardhat": "^2.22",
    "@nomicfoundation/hardhat-toolbox": "^5",
    "@nomicfoundation/hardhat-ignition": "^0.15",
    "@nomicfoundation/hardhat-ignition-ethers": "^0.15",
    "hardhat-gas-reporter": "^2",
    "solidity-coverage": "^0.8"
  },
  "dependencies": {
    "@chainlink/contracts": "^1.2",
    "@openzeppelin/contracts": "^5.1"
  }
}
```

**Phase 0 exit criteria:**
- `npx hardhat compile` runs with zero errors on an empty `contracts/` directory
- `npx hardhat test` runs with zero errors (no test files yet, suite reports 0 passing)
- All directories exist as specified

---

## Phase 1 — Core Libraries, Interfaces & Mocks

**Goal:** Produce all shared code that the main contracts depend on. Nothing in this phase has
VRF or vault logic. These files are the foundation — get them right before building on top.
**Parallelizable:** Tasks 1.1, 1.2, and 1.3 are fully independent.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 1.1 | Implement `contracts/libraries/PayoutMath.sol` | Math agent | [x] |
| 1.1a | — `payoutMultiplier(BetType, uint8 point)` — returns numerator/denominator for all bet types; see payout table in PLAN.md | Math agent | [x] |
| 1.1b | — `maxPossiblePayout(BetSlots memory bets, uint8 point)` — iterates all 15 dice outcomes (sums 2–12 with hard/easy distinction for 4,6,8,10), computes total house payout for each outcome, returns the maximum | Math agent | [x] |
| 1.1c | — Unit tests: `test/unit/PayoutMath.test.ts` — verify every payout multiple from table, verify worst-case derivation for a come-out 2, come-out 12, hard 4 on point of 4 (see PLAN.md §Worst-Case Derivations) | Test agent | [x] |
| 1.2 | Implement `contracts/interfaces/ICrapsGame.sol` — all external function signatures, events, errors, enums (`BetType`, `PuckState`, `SessionPhase`), and structs (`Bet`, `PlaceBet`, `HardwayBet`, `OneRollBets`, `BetSlots`, `PlayerState`) | Interface agent | [x] |
| 1.3 | Implement `contracts/mocks/MockERC20.sol` — minimal ERC-20 with 6-decimal default, `mint(address, uint)` permissionless (test use only), EIP-2612 permit support | Mock agent | [x] |
| 1.4 | Implement `contracts/mocks/MockVRFCoordinator.sol` — implements the Chainlink VRF v2.5 coordinator interface (`IVRFCoordinatorV2Plus` in the installed package), stores pending requests, exposes `fulfillRandomWords(requestId, words[])` callable by test runner to simulate VRF callback | Mock agent | [x] |
| 1.5 | Unit tests for `MockERC20` and `MockVRFCoordinator`: `test/unit/Mocks.test.ts` | Test agent | [x] |

**Payout table (implement exactly as specified):**

| Bet Type | Payout | Max Bet | Min Bet | Required Multiple |
|---|---|---|---|---|
| Pass Line | 1:1 | $500 | $1 | — |
| Pass Line Odds (3x) | True odds (point-dependent) | 3× pass line bet | — | Must equal multiple of pass line |
| Don't Pass | 1:1 | $500 | $1 | — |
| Don't Pass Odds | Lays true odds | 3× DP bet | — | — |
| Come | 1:1 on come-out win; then point rules | $500 | $1 | — |
| Come Odds | True odds on established come point | 3× come bet | — | — |
| Don't Come | Mirror of Don't Pass | $500 | $1 | — |
| Place 4 / 10 | 9:5 | $500 | $5 | $5 |
| Place 5 / 9 | 7:5 | $500 | $5 | $5 |
| Place 6 / 8 | 7:6 | $500 | $6 | $6 |
| Field | 1:1 (2 and 12 pay 2:1) | $500 | $1 | — |
| Hard 4 / 10 | 7:1 | $100 | $1 | — |
| Hard 6 / 8 | 9:1 | $100 | $1 | — |
| Any 7 | 4:1 | $100 | $1 | — |
| Any Craps (2,3,12) | 7:1 | $100 | $1 | — |
| Craps 2 | 30:1 | $100 | $1 | — |
| Craps 3 | 15:1 | $100 | $1 | — |
| Yo (11) | 15:1 | $100 | $1 | — |
| Twelve | 30:1 | $100 | $1 | — |
| Horn (2+3+11+12) | Per-number odds, 4-unit bet | $100 | $4 | $4 |

**Phase 1 exit criteria:**
- `npx hardhat test test/unit/PayoutMath.test.ts` — all assertions pass including the three worst-case scenarios
- `npx hardhat test test/unit/Mocks.test.ts` — all passing
- `npx hardhat compile` — zero errors, zero warnings

---

## Phase 2 — CrapsVault Contract

**Goal:** Deploy-ready vault with the five-bucket invariant, deposit fee, and full test coverage.
This contract has no knowledge of game logic — it is a guarded accounting ledger.
**Parallelizable:** 2.1 (contract) and 2.2 (test scaffolding) can be started in parallel;
full tests (2.3) require the contract to be complete.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 2.1 | Implement `contracts/CrapsGame.sol` vault section — all five accounting buckets as contract-level mappings and a single `bankroll` + `accruedFees` scalar | Vault agent | [x] |
| 2.1a | — `deposit(uint256 amount)` — transfer token in, deduct `DEPOSIT_FEE_BPS = 50` (0.5%), credit `_available[player]`, accumulate `accruedFees` | Vault agent | [x] |
| 2.1b | — `withdraw(uint256 amount)` — require `amount <= _available[msg.sender]`, transfer out | Vault agent | [x] |
| 2.1c | — `_debitAvailable(address player, uint256 amount)` — internal, moves `_available → _inPlay` | Vault agent | [x] |
| 2.1d | — `_creditAvailable(address player, uint256 amount)` — internal, moves source → `_available` (used for wins and bet returns) | Vault agent | [x] |
| 2.1e | — `_reserveFromBankroll(address player, uint256 amount)` — internal, moves `bankroll → _reserved[player]` | Vault agent | [x] |
| 2.1f | — `_releaseReserve(address player, uint256 paidOut)` — internal, called after VRF callback; moves `paidOut` from `_reserved[player]` to `_available[player]`, remainder back to `bankroll` | Vault agent | [x] |
| 2.1g | — `withdrawFees(address to)` — `onlyOwner`, transfers `accruedFees` to `to`, zeroes accumulator | Vault agent | [x] |
| 2.1h | — `fundBankroll(uint256 amount)` — `onlyOwner`, transfers token in, adds to `bankroll` | Vault agent | [x] |
| 2.1i | — `withdrawBankroll(uint256 amount)` — `onlyOwner`, requires `paused()`, transfers from `bankroll` | Vault agent | [x] |
| 2.1j | — `_assertInvariant()` — internal view, `assert(token.balanceOf(address(this)) == sumAvailable + sumInPlay + sumReserved + bankroll + accruedFees)`; call in every state-mutating function during testing via `DEBUG` flag | Vault agent | [x] |
| 2.2 | Set up `test/unit/Vault.test.ts` with `MockERC20`, `MockVRFCoordinator` harness | Test agent | [x] |
| 2.3 | Unit tests — `test/unit/Vault.test.ts` | Test agent | [x] |
| 2.3a | — Deposit: correct `_available` credit, correct fee to `accruedFees`, invariant holds | Test agent | [x] |
| 2.3b | — Deposit: zero-amount reverts, paused reverts | Test agent | [x] |
| 2.3c | — Withdraw: full and partial withdrawal, invariant holds | Test agent | [x] |
| 2.3d | — Withdraw: exceeds `_available` reverts, paused does NOT block withdrawal | Test agent | [x] |
| 2.3e | — `_debitAvailable` / `_creditAvailable`: correct bucket transfers, invariant holds | Test agent | [x] |
| 2.3f | — Reserve/release cycle: reserve moves bankroll → `_reserved`; release splits back correctly on various payout amounts | Test agent | [x] |
| 2.3g | — `withdrawFees`: only owner, correct amount, zeroes accumulator | Test agent | [x] |
| 2.3h | — `fundBankroll`: correct bucket increase, invariant holds | Test agent | [x] |
| 2.3i | — `withdrawBankroll`: requires paused, correct bucket decrease | Test agent | [x] |
| 2.3j | — Fuzz test: 50 random deposit/withdraw sequences, invariant assertion fires on every step | Test agent | [x] |

**Constant values (use exactly):**
```solidity
uint16 public constant DEPOSIT_FEE_BPS = 50;          // 0.5%
uint256 public constant MIN_BANKROLL    = 10_000e6;    // $10,000 USDC (6 decimals)
uint256 public constant INITIAL_BANKROLL = 50_000e6;  // recommended launch funding
```

**Phase 2 exit criteria:**
- `npx hardhat test test/unit/Vault.test.ts` — 100% pass, `_assertInvariant` never fires
- `npx hardhat coverage --testfiles 'test/unit/Vault.test.ts' && node scripts/check-vault-coverage.mjs` — ≥95% line coverage across the Phase 2 vault-selected functions inside `contracts/CrapsGame.sol`
- `npx hardhat compile` — zero warnings

---

## Phase 3 — CrapsGame: Session + Core Bets

**Goal:** A working, testable game contract supporting Pass Line, Don't Pass, and Field bets only,
with full VRF integration, session lifecycle, self-exclusion, and the `getPlayerState` view function.
This is the vertical slice that validates the entire architecture before the full bet suite is added.
**Parallelizable:** None — this phase is strictly sequential as each component depends on the previous.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 3.1 | Implement session lifecycle in `CrapsGame.sol` | Session agent | [x] |
| 3.1a | — Session struct: `phase` (enum), `point` (uint8), `lastActivityTime` (uint48), `pendingRequestId` (uint256) | Session agent | [x] |
| 3.1b | — `openSession()` — requires no active session, not excluded, not paused; sets `phase = COME_OUT`, `lastActivityTime = block.timestamp` | Session agent | [x] |
| 3.1c | — `closeSession()` — player-callable; requires `phase != ROLL_PENDING`; returns all `_inPlay` to `_available`, resets session struct | Session agent | [x] |
| 3.1d | — `expireSession(address player)` — callable by anyone; requires `block.timestamp - lastActivityTime > SESSION_TIMEOUT` (24 hours); handles `ROLL_PENDING` case (return `_inPlay` + release reserve → `_available`); deletes `requestToPlayer[pendingRequestId]` | Session agent | [x] |
| 3.1e | — Unit tests: `test/unit/Session.test.ts` — open, close, expire (active), expire (pending), expire-then-late-VRF-callback (must silently return) | Test agent | [x] |
| 3.2 | Implement self-exclusion system | Exclusion agent | [x] |
| 3.2a | — `selfExclude()` — sets `selfExcluded[msg.sender] = true`, closes any open session immediately, never blocks withdrawal | Exclusion agent | [x] |
| 3.2b | — `requestSelfReinstatement()` — records `reinstatementEligibleAt[msg.sender] = block.timestamp + 7 days` | Exclusion agent | [x] |
| 3.2c | — `completeSelfReinstatement()` — requires `block.timestamp >= reinstatementEligibleAt[msg.sender]`, clears exclusion | Exclusion agent | [x] |
| 3.2d | — `operatorExclude(address player)` / `operatorReinstate(address player)` — `onlyOwner` | Exclusion agent | [x] |
| 3.2e | — Unit tests: `test/unit/Exclusion.test.ts` — all four flows, withdrawal-still-works-while-excluded | Test agent | [x] |
| 3.3 | Implement Pass Line, Don't Pass, and Field bet placement | Betting agent | [x] |
| 3.3a | — `placeBet(BetType betType, uint256 amount)` — validates amount (min/max/required-multiple), puck state, session active and not pending; moves `_available → _inPlay` | Betting agent | [x] |
| 3.3b | — `removeBet(BetType betType)` — only for bets that may be taken down (Don't Pass line bets after point established); returns `_inPlay → _available` | Betting agent | [x] |
| 3.3c | — Validate bet availability by puck state (OFF vs ON) per PLAN.md §Puck Behavior | Betting agent | [x] |
| 3.4 | Implement `rollDice()` and VRF request path | VRF agent | [x] |
| 3.4a | — Require: session active, `phase != ROLL_PENDING`, at least one bet placed, not excluded | VRF agent | [x] |
| 3.4b | — Call `PayoutMath.maxPossiblePayout(activeBets, point)` and `_reserveFromBankroll(player, worstCase)` — revert with `InsufficientBankroll` if bankroll < worstCase | VRF agent | [x] |
| 3.4c | — Call `vrfCoordinator.requestRandomWords(...)`, store `requestToPlayer[requestId] = msg.sender`, set `session.pendingRequestId = requestId`, set `phase = ROLL_PENDING` | VRF agent | [x] |
| 3.5 | Implement `fulfillRandomWords()` VRF callback | VRF agent | [x] |
| 3.5a | — Look up player from `requestToPlayer`; if `address(0)`, silently return | VRF agent | [x] |
| 3.5b | — Derive two dice values: `die1 = (randomWord % 6) + 1`, `die2 = ((randomWord >> 8) % 6) + 1`, `sum = die1 + die2` | VRF agent | [x] |
| 3.5c | — Resolve Pass Line and Don't Pass according to come-out vs point phase rules; apply payout via `_releaseReserve` | VRF agent | [x] |
| 3.5d | — Resolve Field bet (win: 3,4,9,10,11; 2×: 2,12) | VRF agent | [x] |
| 3.5e | — Update puck state (COME_OUT→point established, point→COME_OUT on 7-out or point hit) | VRF agent | [x] |
| 3.5f | — Set `phase = COME_OUT` or `POINT` as appropriate; clear `pendingRequestId`; delete `requestToPlayer[requestId]`; update `lastActivityTime` | VRF agent | [x] |
| 3.5g | — **Zero reverts anywhere in this function.** Use soft returns, not `require`. | VRF agent | [x] |
| 3.6 | Implement `getPlayerState(address player)` view function | State agent | [x] |
| 3.6a | — Returns full `PlayerState` struct: session fields, all balance buckets, all bet slots, exclusion status, house context (`bankroll`, `totalBankroll`, `initialBankroll`, `paused`) | State agent | [x] |
| 3.7 | Unit tests: `test/unit/GameCore.test.ts` | Test agent | [x] |
| 3.7a | — Come-out: natural (7, 11) → Pass Line wins, Don't Pass loses | Test agent | [x] |
| 3.7b | — Come-out: craps (2, 3, 12) → Pass Line loses; Don't Pass wins on 2/3, push on 12 | Test agent | [x] |
| 3.7c | — Come-out: point established, then point hit → Pass Line wins | Test agent | [x] |
| 3.7d | — Come-out: point established, then 7-out → Pass Line loses, Don't Pass wins | Test agent | [x] |
| 3.7e | — Field wins on 3,4,9,10,11; Field 2:1 on 2; Field 2:1 on 12; Field loses on 5,6,7,8 | Test agent | [x] |
| 3.7f | — Reserve correctly computed before roll; released correctly after; invariant holds | Test agent | [x] |
| 3.7g | — Roll reverts with `InsufficientBankroll` when bankroll < worstCase | Test agent | [x] |
| 3.7h | — Late VRF callback after session expiry: no state change, no revert | Test agent | [x] |
| 3.7i | — `getPlayerState` returns correct values at each session phase | Test agent | [x] |

**VRF configuration constants:**
```solidity
uint32  constant CALLBACK_GAS_LIMIT    = 500_000;
uint16  constant REQUEST_CONFIRMATIONS = 3;
uint32  constant NUM_WORDS             = 1;        // single uint256, derive both dice from it
uint256 constant SESSION_TIMEOUT       = 24 hours;
uint256 constant VRF_TIMEOUT_BLOCKS    = 100;      // informational only; not used for cancel logic
```

**Phase 3 exit criteria:**
- `npx hardhat test test/unit/Session.test.ts test/unit/Exclusion.test.ts test/unit/GameCore.test.ts` — 100% pass
- `_assertInvariant()` never fires across all test scenarios
- `fulfillRandomWords` contains no `require` statements (grep-verified)

---

## Phase 4 — CrapsGame: Full Bet Suite

**Goal:** Add all remaining bet types to the working game core from Phase 3. Each bet type can be
implemented and tested by a parallel subagent against the mock VRF harness.
**Parallelizable:** Tasks 4.1–4.5 are fully parallel once Phase 3 is merged.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 4.1 | **Odds Bets** — Pass Line Odds, Don't Pass Odds | Odds agent | [x] |
| 4.1a | — Placement: only allowed after point established; amount ≤ 3× line bet; required multiple enforced | Odds agent | [x] |
| 4.1b | — Payout: true odds by point (4/10: 2:1, 5/9: 3:2, 6/8: 6:5); Don't Pass lays (reverses ratio) | Odds agent | [x] |
| 4.1c | — Odds bets are always working and always off on 7-out (returned) | Odds agent | [x] |
| 4.1d | — Tests: `test/unit/OddsBets.test.ts` — all six points, both sides, 7-out return | Test agent | [x] |
| 4.2 | **Come / Don't Come Bets** (4 slots each) | Come agent | [x] |
| 4.2a | — Come bet placement: only when puck is ON; bet placed in "traveling" state until next roll | Come agent | [x] |
| 4.2b | — Come-out roll for come bet: natural wins (7/11), craps loses (2/3/12) | Come agent | [x] |
| 4.2c | — Point established for come bet: moves to numbered slot; persists until that number or 7-out | Come agent | [x] |
| 4.2d | — Come Odds: placed on established come bet number; 3× limit; same true-odds payout table | Come agent | [x] |
| 4.2e | — Don't Come: mirror of Don't Pass but initiated while puck is ON | Come agent | [x] |
| 4.2f | — Tests: `test/unit/ComeBets.test.ts` — come natural, come craps, establish + hit, establish + 7-out, all 4 slots, DC mirror | Test agent | [x] |
| 4.3 | **Place Bets** (4/5/6/8/9/10) | Place agent | [x] |
| 4.3a | — Placement: only when puck is ON; required multiples enforced ($5 for 4/5/9/10, $6 for 6/8) | Place agent | [x] |
| 4.3b | — Win: number rolled before 7; Lose: 7 out | Place agent | [x] |
| 4.3c | — Payouts: 9:5 for 4/10, 7:5 for 5/9, 7:6 for 6/8 | Place agent | [x] |
| 4.3d | — Place bets remain after a win (press or leave — no auto-removal; player must `removeBet`) | Place agent | [x] |
| 4.3e | — Tests: `test/unit/PlaceBets.test.ts` — all six numbers, win/lose, 7-out removes all, payout multiples | Test agent | [x] |
| 4.4 | **Hardway Bets** (Hard 4/6/8/10) | Hardway agent | [x] |
| 4.4a | — Win condition: dice show the hard pair (e.g., 2+2 for Hard 4) | Hardway agent | [x] |
| 4.4b | — Loss condition: 7 rolled, OR easy way (e.g., 1+3, 3+1 for Hard 4) | Hardway agent | [x] |
| 4.4c | — Payouts: 7:1 for Hard 4/10, 9:1 for Hard 6/8 | Hardway agent | [x] |
| 4.4d | — Hardways persist across multiple rolls until resolved | Hardway agent | [x] |
| 4.4e | — Tests: `test/unit/HardwayBets.test.ts` — each hard number, win, easy-way loss, 7-out loss, persistence | Test agent | [x] |
| 4.5 | **One-Roll Props** (Any 7, Any Craps, Craps 2/3/12, Yo, Twelve, Horn) | Props agent | [x] |
| 4.5a | — All prop bets resolve on the very next roll regardless of puck state | Props agent | [x] |
| 4.5b | — Horn: 4-unit bet split across 2/3/11/12; losing units subtracted from winning payout | Props agent | [x] |
| 4.5c | — Tests: `test/unit/PropBets.test.ts` — each prop type wins, each prop type loses, Horn net payout math | Test agent | [x] |
| 4.6 | **Worst-case reserve audit** — run `maxPossiblePayout` against a maximally-loaded session (all bets at max, all odds at 3×) and verify the reserve amount matches manual derivation from PLAN.md §Bankroll Sizing | Audit agent | [x] |

**Phase 4 exit criteria:**
- All unit test files in `test/unit/` pass
- `npx hardhat coverage` — ≥95% line coverage across all contract files
- Worst-case reserve audit (4.6) documented in `test/unit/WorstCaseAudit.test.ts`

---

## Phase 5 — Integration Tests

**Goal:** End-to-end session scenarios exercising the full contract stack together. No mocked
internal functions — only `MockERC20` and `MockVRFCoordinator` are permitted.
**Parallelizable:** Scenarios 5.1–5.8 can be written in parallel; 5.9 (invariant suite) is last.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 5.1 | **Scenario: Happy path deposit → play → withdraw** — deposit $500, play 10 rounds (mix of wins/losses), withdraw remaining balance; verify fee accrual and bankroll changes | Integration agent | [ ] |
| 5.2 | **Scenario: Session expiry during active play** — place bets, simulate 24-hour timeout, call `expireSession`, verify all `_inPlay` returned to `_available`, verify player can withdraw | Integration agent | [ ] |
| 5.3 | **Scenario: Session expiry during ROLL_PENDING** — place bets, call `rollDice`, advance time 24h, call `expireSession`, verify reserve released back to bankroll, verify late callback is a no-op | Integration agent | [ ] |
| 5.4 | **Scenario: Bankroll runs out mid-session** — fund minimal bankroll, load session with max bets, verify `rollDice` reverts with `InsufficientBankroll` when reserve requirement exceeds available bankroll | Integration agent | [ ] |
| 5.5 | **Scenario: Self-exclusion lifecycle** — play, self-exclude (session closed immediately), attempt bet (fails), withdraw (succeeds), reinstatement request, advance 7 days, complete reinstatement, resume play | Integration agent | [ ] |
| 5.6 | **Scenario: Operator exclusion** — operator excludes player mid-session, verify session closed, verify withdrawal still works, operator reinstates, player resumes | Integration agent | [ ] |
| 5.7 | **Scenario: Multi-player concurrent sessions** — three players each open sessions, place bets, request rolls simultaneously; fulfill VRF in different orders; verify each player's state is isolated and invariant holds across all callbacks | Integration agent | [ ] |
| 5.8 | **Scenario: Emergency pause and bankroll recovery** — pause contract, verify no deposits/bets/rolls; verify withdrawals still work; owner withdraws fees; owner withdraws bankroll (requires paused) | Integration agent | [ ] |
| 5.9 | **Invariant test suite** — property-based test that runs 200 random action sequences (random deposit/bet/roll/withdraw by random players) and asserts the five-bucket invariant holds after every action | Fuzzing agent | [ ] |
| 5.10 | **Gas profiling baseline** — run all integration scenarios with `hardhat-gas-reporter`, document gas cost for: `deposit`, `withdraw`, `rollDice`, `fulfillRandomWords` (best/worst case), `expireSession`; save baseline to `gas-report-baseline.json` | Gas agent | [ ] |

**Phase 5 exit criteria:**
- `npx hardhat test test/integration/` — 100% pass
- Invariant never violated across all 200 random sequences
- Gas baseline report committed

---

## Phase 6 — Deployment Infrastructure

**Goal:** Hardhat Ignition modules and scripts that deploy the full system atomically and reproducibly.
**Parallelizable:** 6.1 and 6.2 can be written in parallel.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 6.1 | Implement `ignition/modules/CrapsGame.ts` — Ignition module that: deploys `CrapsGame` with constructor params (token address, VRF coordinator, subscription ID, key hash, token decimals), transfers `INITIAL_BANKROLL_AMOUNT` from deployer to contract via `fundBankroll`, emits deployment parameters to `deployments/` directory | Deploy agent | [ ] |
| 6.2 | Implement `scripts/verify.ts` — post-deployment Basescan verification script that reads deployment artifact and calls Hardhat verify task | Deploy agent | [ ] |
| 6.3 | Document BASE Sepolia deployment parameters in `deployments/sepolia-params.json` | Deploy agent | [ ] |
| 6.3a | — VRF Coordinator v2.5: `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE` | Deploy agent | [ ] |
| 6.3b | — LINK token (Sepolia): `0xE4aB69C077896252FAFBD49EFD26B5D171A32410` | Deploy agent | [ ] |
| 6.3c | — USDC (BASE Sepolia, Circle): `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Deploy agent | [ ] |
| 6.3d | — Key hash (BASE Sepolia, 30 gwei lane): `0x9e9e46732b32662b9adc6f3abdf6c5e926a666d6b7a39d3a50b33ff4f6f56f9` | Deploy agent | [ ] |
| 6.4 | Create VRF subscription setup guide in `docs/vrf-setup.md` — how to create subscription on vrf.chain.link, add consumer contract address, fund with LINK | Docs agent | [ ] |
| 6.5 | Add `npm run deploy:sepolia` and `npm run deploy:mainnet` scripts to `package.json` | Deploy agent | [ ] |

**Phase 6 exit criteria:**
- `npx hardhat ignition deploy ignition/modules/CrapsGame.ts --network hardhat` completes without error
- Deployment artifact written to `deployments/` directory
- All network params verified against official Chainlink and Circle documentation

---

## Phase 7 — Security & Static Analysis

**Goal:** Catch vulnerabilities before any testnet deployment. This phase is a **hard gate** — nothing
deploys until Slither and Mythril pass with no high/critical findings.
**Parallelizable:** 7.1 and 7.2 run concurrently; 7.3 starts after both complete.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 7.1 | Run Slither: `slither . --config-file slither.config.json` — fix all High and Medium findings; document any acknowledged Low findings with rationale in `audit/slither-notes.md` | Security agent | [ ] |
| 7.2 | Run Mythril: `myth analyze contracts/CrapsGame.sol --execution-timeout 120` — fix all detected vulnerabilities; document analysis in `audit/mythril-notes.md` | Security agent | [ ] |
| 7.3 | Manual security review checklist — complete `audit/security-checklist.md` covering: | Security agent | [ ] |
| 7.3a | — Reentrancy: all vault mutations guarded by `ReentrancyGuard` | Security agent | [ ] |
| 7.3b | — VRF manipulation: only VRF coordinator can call `fulfillRandomWords` (verify `onlyVRFCoordinator` modifier) | Security agent | [ ] |
| 7.3c | — Callback revert impossibility: grep for `require`/`revert` inside `fulfillRandomWords` (must be zero) | Security agent | [ ] |
| 7.3d | — Access control: `onlyOwner` on all administrative functions | Security agent | [ ] |
| 7.3e | — Integer overflow: all arithmetic uses Solidity `^0.8.24` built-in overflow protection | Security agent | [ ] |
| 7.3f | — No floating point: `PayoutMath.sol` uses only integer arithmetic | Security agent | [ ] |
| 7.3g | — Invariant: manual trace through deposit → bet → roll → fulfill → withdraw confirms no bucket leakage | Security agent | [ ] |
| 7.3h | — Exclusion: excluded players cannot bypass via `openSession` or `placeBet` | Security agent | [ ] |
| 7.3i | — Withdrawal: `paused()` does NOT block `withdraw()` | Security agent | [ ] |
| 7.4 | Gas optimization pass — review `fulfillRandomWords` and `rollDice` for: storage read/write minimization, event emission efficiency, unnecessary SLOAD in loops | Gas agent | [ ] |
| 7.5 | Re-run full test suite post-optimization; confirm no regressions | Test agent | [ ] |
| 7.6 | Update `gas-report-baseline.json` with optimized figures | Gas agent | [ ] |

**Phase 7 exit criteria:**
- Slither: zero High/Critical findings
- Mythril: zero vulnerabilities detected
- Security checklist: all 9 items verified and documented
- All tests still passing after gas optimization

---

## Phase 8 — BASE Sepolia Testnet Deployment

**Goal:** Live deployment on BASE Sepolia, verified on Basescan, smoke-tested end-to-end.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 8.1 | Create VRF subscription on BASE Sepolia via vrf.chain.link, fund with testnet LINK, record `VRF_SUBSCRIPTION_ID` in `.env` | Deploy agent | [ ] |
| 8.2 | Run `npm run deploy:sepolia` — confirm deployment succeeds, record contract address in `deployments/sepolia-deployment.json` | Deploy agent | [ ] |
| 8.3 | Add deployed contract as VRF consumer to subscription (via vrf.chain.link UI) | Deploy agent | [ ] |
| 8.4 | Run `npm run verify:sepolia` — confirm contract is verified on Basescan | Deploy agent | [ ] |
| 8.5 | Smoke test checklist (manual or scripted): | Test agent | [ ] |
| 8.5a | — Acquire testnet USDC via Circle faucet, confirm wallet balance | Test agent | [ ] |
| 8.5b | — `deposit(100e6)` → confirm `_available` balance and fee accrual in `getPlayerState` | Test agent | [ ] |
| 8.5c | — `openSession()` → confirm session phase is `COME_OUT` | Test agent | [ ] |
| 8.5d | — `placeBet(PASS_LINE, 10e6)` → confirm `_inPlay` updated | Test agent | [ ] |
| 8.5e | — `rollDice()` → confirm `phase = ROLL_PENDING`, VRF request emitted | Test agent | [ ] |
| 8.5f | — Wait for Chainlink VRF fulfillment (typically 1–3 minutes on Sepolia) | Test agent | [ ] |
| 8.5g | — Confirm `phase` has advanced, balances updated correctly | Test agent | [ ] |
| 8.5h | — `withdraw(amount)` → confirm token received in wallet | Test agent | [ ] |
| 8.5i | — Trigger session expiry: advance block.timestamp (via time manipulation in a fork test or wait 24h on live testnet) | Test agent | [ ] |
| 8.6 | Document any testnet findings in `deployments/sepolia-findings.md` | Deploy agent | [ ] |

**Phase 8 exit criteria:**
- Contract live and verified on Basescan
- All 9 smoke test steps pass
- VRF fulfillment confirmed on-chain (transaction visible in Basescan)

---

## Phase 9 — Frontend

**Goal:** Minimal production-quality React frontend using wagmi v2 + viem v2. The UI should support
the full player flow: connect wallet → deposit → play → withdraw.
**Parallelizable:** 9.2–9.5 can be developed in parallel; 9.6 (integration) is last.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 9.1 | Scaffold React app in `frontend/` with wagmi v2 + viem v2 + RainbowKit; configure BASE Sepolia as primary chain, BASE Mainnet as secondary | Frontend agent | [ ] |
| 9.2 | **Wallet & Balance component** — connect/disconnect wallet, display `_available` balance and `accruedFees` from `getPlayerState` | Frontend agent | [ ] |
| 9.3 | **Deposit/Withdraw component** — token approval + `deposit(amount)`; `withdraw(amount)`; display deposit fee clearly before confirming | Frontend agent | [ ] |
| 9.4 | **Game Table component** — craps table layout; all bet slots clickable; displays active bets, bet amounts, current point, puck state (ON/OFF) | Frontend agent | [ ] |
| 9.5 | **Roll & State Sync** — `rollDice()` button; poll `getPlayerState` after each transaction; display pending state while VRF resolves; update UI when callback fires (watch for `RollResult` event) | Frontend agent | [ ] |
| 9.6 | **Session management UI** — open/close session buttons; session timer showing time until expiry; self-exclusion option in settings panel | Frontend agent | [ ] |
| 9.7 | Export ABI from Hardhat artifacts into `frontend/src/abi/CrapsGame.json`; wire all contract interactions through a single `useCrapsGame` hook | Frontend agent | [ ] |
| 9.8 | **Exclusion / Responsible Gambling panel** — self-exclusion button with clear warning UX; 7-day reinstatement countdown; responsible gambling disclaimer | Frontend agent | [ ] |
| 9.9 | Connect frontend to BASE Sepolia deployment; end-to-end smoke test in browser | Frontend agent | [ ] |

**Phase 9 exit criteria:**
- Full player flow works end-to-end on BASE Sepolia in browser
- All bet types placeable from the UI
- VRF callback reflected in UI without page refresh
- Mobile-responsive layout

---

## Phase 10 — Mainnet Readiness

**Goal:** Final checklist and deployment to BASE Mainnet. Do not proceed until all prior phases pass.

| ID | Task | Subagent hint | Status |
|----|------|---------------|--------|
| 10.1 | Pre-mainnet review: confirm all Phase 7 security findings resolved and documented | Lead agent | [ ] |
| 10.2 | Confirm BASE Mainnet contract addresses in `deployments/mainnet-params.json` (VRF Coordinator, USDC, key hash) | Deploy agent | [ ] |
| 10.3 | Create mainnet VRF subscription on vrf.chain.link; fund with LINK; record `VRF_SUBSCRIPTION_ID_MAINNET` | Deploy agent | [ ] |
| 10.4 | Run `npm run deploy:mainnet` — confirm deployment; record address in `deployments/mainnet-deployment.json` | Deploy agent | [ ] |
| 10.5 | Verify contract on Basescan (mainnet) | Deploy agent | [ ] |
| 10.6 | Add deployed contract as VRF consumer to mainnet subscription | Deploy agent | [ ] |
| 10.7 | Fund bankroll: `fundBankroll(INITIAL_BANKROLL_AMOUNT)` — confirm bankroll balance in `getPlayerState` | Deploy agent | [ ] |
| 10.8 | Update frontend environment to include BASE Mainnet and redeploy frontend | Frontend agent | [ ] |
| 10.9 | Mainnet smoke test (small bets with real USDC) — replicate Phase 8 smoke test checklist | Lead agent | [ ] |
| 10.10 | Document mainnet deployment in `docs/mainnet-deployment.md` — contract address, deployment tx, initial bankroll amount, VRF subscription ID | Docs agent | [ ] |

**BASE Mainnet configuration:**
```json
{
  "vrfCoordinator": "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634",
  "usdcAddress":    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "keyHash30Gwei":  "0x00456d8a57dbabf4e48f22dfb60c6c4e5f82b81c3d1ecc28b98f4c67e0a2f9b9",
  "chainId":        8453
}
```

**Phase 10 exit criteria:**
- Contract live on BASE Mainnet, verified on Basescan
- Bankroll funded, smoke test passed
- All documentation committed

---

## Cross-Phase Invariants

These properties must hold **at every phase** and are checked by any agent touching contract state:

```
1. token.balanceOf(vault) == Σ_available[all] + Σ_inPlay[all] + Σ_reserved[all] + bankroll + accruedFees
2. _reserved[player] > 0  iff  session.phase == ROLL_PENDING
3. _inPlay[player] == sum of all active bet amounts for player
4. fulfillRandomWords contains zero `require` or `revert` statements
5. withdraw() is never blocked by paused() state
6. Any excluded player can always withdraw, never bet
```

---

## Quick Reference: Key Contract Constants

| Constant | Value | Notes |
|---|---|---|
| `DEPOSIT_FEE_BPS` | 50 | 0.5% |
| `MIN_BANKROLL` | 10,000e6 | $10k USDC, 6 decimals |
| `INITIAL_BANKROLL` | 50,000e6 | Recommended launch funding |
| `MAX_ODDS_MULTIPLIER` | 3 | 3× odds max |
| `SESSION_TIMEOUT` | 86400 | 24 hours in seconds |
| `SELF_EXCLUSION_DELAY` | 604800 | 7 days in seconds |
| `CALLBACK_GAS_LIMIT` | 500,000 | VRF callback gas |
| `REQUEST_CONFIRMATIONS` | 3 | VRF confirmations |
| `MAX_LINE_BET` | 500e6 | $500 |
| `MAX_PROP_BET` | 100e6 | $100 |

---

## Dependency Graph

```
Phase 0 (Scaffold)
    └── Phase 1 (Libraries, Interfaces, Mocks)
            └── Phase 2 (Vault)
                    └── Phase 3 (Game Core: Session + Pass/Don't/Field)
                            └── Phase 4 (Full Bet Suite) ──┐
                                                            ▼
                                                    Phase 5 (Integration Tests)
                                                            └── Phase 6 (Deploy Infra)
                                                                        └── Phase 7 (Security)
                                                                                    └── Phase 8 (Sepolia)
                                                                                                └── Phase 9 (Frontend)
                                                                                                            └── Phase 10 (Mainnet)
```

Within phases, tasks at the same level in the table may be executed concurrently by subagents.
A leader agent should confirm phase exit criteria before handing off to the next phase.
