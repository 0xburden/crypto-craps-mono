# Craps on BASE — Implementation Plan

## Overview

A fully on-chain implementation of bubble craps (per-player, self-paced sessions) deployed on BASE (Coinbase's L2) for low gas costs and fast confirmations. Each player gets their own independent session — no shared table, no waiting for other players. The game accepts ERC-20 stablecoin deposits (one token per deployment), manages house bankroll with a reserve-on-roll solvency system, and uses Chainlink VRF for provably fair dice rolls. All logic lives in a single `CrapsGame.sol` contract with `PayoutMath.sol` as a pure library.

### Why BASE

- ~2-second block times (vs. 12s on L1) — drastically better UX for dice roll resolution
- Sub-cent gas fees — players can bet small without fees eating their stack
- Native USDC support (Coinbase-backed, canonical USDC on BASE)
- Chainlink VRF v2.5 is live on BASE mainnet and BASE Sepolia
- Large existing DeFi user base with bridged funds ready to play

---

## Toolchain

| Tool | Purpose |
|---|---|
| **Hardhat** | Compile, test, deploy |
| **ethers.js v6** | Contract interaction |
| **Chainlink VRF v2.5** | Verifiable randomness for dice rolls |
| **OpenZeppelin 5.x** | `Ownable`, `ReentrancyGuard`, `Pausable` |
| **Hardhat Ignition** | Deployment modules |
| **TypeScript** | Typed tests and scripts |
| **Hardhat Gas Reporter** | Gas profiling |
| **Slither** | Static analysis (required gate before any deployment) |

### Chain Configuration

| Network | Chain ID | RPC | VRF Coordinator |
|---|---|---|---|
| BASE Sepolia (testnet) | 84532 | `https://sepolia.base.org` | Chainlink VRF v2.5 on BASE Sepolia |
| BASE Mainnet (production) | 8453 | `https://mainnet.base.org` | Chainlink VRF v2.5 on BASE |

---

## Project Structure

```
craps/
├── contracts/
│   ├── CrapsGame.sol              # All game logic: vault, sessions, VRF, exclusion
│   ├── PayoutMath.sol             # All payout calculations + max payout (pure library)
│   └── interfaces/
│       └── ICrapsGame.sol
├── test/
│   ├── unit/
│   │   ├── CrapsGame.test.ts      # Session state machine tests
│   │   ├── ComeBets.test.ts       # Come/Don't Come lifecycle tests
│   │   ├── PuckState.test.ts      # Bet availability by puck ON/OFF phase
│   │   ├── PayoutMath.test.ts     # Payout math edge cases + maxPossiblePayout
│   │   ├── Vault.test.ts          # Deposit, withdraw, fee, invariant, timeout tests
│   │   └── Reserve.test.ts        # Reserve-on-roll, release-on-callback tests
│   └── integration/
│       ├── FullSession.test.ts    # Full session flow w/ mock VRF
│       ├── SessionTimeout.test.ts # 24h expiry, fund return, edge cases
│       └── ConcurrentSessions.test.ts  # Multiple players rolling simultaneously
├── ignition/
│   └── modules/
│       └── CrapsModule.ts
├── scripts/
│   ├── fund-vrf.ts                # Fund VRF subscription
│   ├── verify.ts                  # Basescan verification
│   ├── check-pending.ts           # Query pending VRF request count
│   └── check-link-balance.ts      # Query VRF subscription LINK balance, warn if low
├── slither.config.json
├── hardhat.config.ts
└── .env
```

---

## Game Rules — Standard Bubble Craps

### Session Model — Bubble Craps (Per-Player)

Each player has their own independent session. There is no shared table — just like a physical bubble craps machine, the player sits down, deposits, and rolls at their own pace. No coordination with other players, no waiting for a shared betting round.

```solidity
struct Session {
    SessionPhase phase;        // INACTIVE, COME_OUT, POINT, ROLL_PENDING
    uint8 point;               // 0 if no point established, else 4/5/6/8/9/10
    uint256 vrfRequestId;      // Active VRF request (0 if none)
    uint256 lastActivityTime;  // block.timestamp of last roll resolution (for 24h expiry)

    // Fixed-size bet storage — zero amount means no bet
    Bet passLine;
    Bet dontPass;
    ComeBet[4] comeBets;       // Max 4 concurrent Come/Don't Come bets
    PlaceBet[6] placeBets;     // Indexed: [4, 5, 6, 8, 9, 10]
    HardwayBet[4] hardways;    // Indexed: [4, 6, 8, 10]
    OneRollBets oneRolls;      // Struct: field, any7, anyCraps, yo, hiLo, aces, boxcars
}
```

**Fixed-size storage rationale:** All bet slots are fixed-size structs or fixed-length arrays, never dynamic arrays. An empty bet is represented by a zero amount. The VRF callback iterates all slots and skips zeros. This eliminates dynamic array management costs (push, delete, compaction) and makes gas consumption predictable. The `maxPossiblePayout()` function iterates the same fixed structures.

### Bet Struct Definitions

```solidity
struct Bet {
    uint256 amount;         // 0 means no bet
    uint256 oddsAmount;     // Attached odds bet amount (0 if none). Used for Pass/Don't Pass only
}

struct ComeBet {
    uint256 amount;         // Base Come/Don't Come amount (0 means empty slot)
    uint256 oddsAmount;     // Attached Come/Don't Come Odds (0 if none)
    uint8 point;            // 0 = COME_PENDING (no point yet), 4/5/6/8/9/10 = established point
    bool isDontCome;        // false = Come bet, true = Don't Come bet
}

struct PlaceBet {
    uint256 amount;         // 0 means no bet
    bool active;            // ON/OFF toggle. Only affects win resolution; a 7 kills regardless
}

struct HardwayBet {
    uint256 amount;         // 0 means no bet
}

struct OneRollBets {
    uint256 field;
    uint256 any7;
    uint256 anyCraps;
    uint256 yo;
    uint256 hiLo;
    uint256 aces;
    uint256 boxcars;
}
```

**Notes:**
- `Bet` is used for both Pass Line and Don't Pass. The session has separate `passLine` and `dontPass` fields, so the type is implicit from the field name.
- `ComeBet.isDontCome` distinguishes Come from Don't Come within the same array. Both share the 4-slot `comeBets` array.
- `PlaceBet.active` is the ON/OFF toggle. Defaults to OFF when first placed during puck OFF phase.
- All `amount` fields are in token units (scaled to `tokenDecimals`).

**Index-to-number mappings:**
- `placeBets[0..5]` → numbers `[4, 5, 6, 8, 9, 10]` (note the gap at 7)
- `hardways[0..3]` → targets `[4, 6, 8, 10]`
- `comeBets[0..3]` → first empty slot (amount == 0) is used when a new Come bet is placed

#### Session Lifecycle

```
player calls deposit()
        ↓
    INACTIVE → player places first bet → COME_OUT
        ↓
    player calls rollDice() → ROLL_PENDING (VRF requested, bankroll reserved)
        ↓
    VRF callback fires → resolve all bets → release reserve → determine new phase:
        ↓
    ┌─ no point established after roll → COME_OUT (player can bet + roll again)
    ├─ point established → POINT (player can add odds/come/place bets, then roll)
    └─ player has no remaining bets and no balance → INACTIVE
```

**Four phases:**
- `INACTIVE` — no session. Player can deposit and place first bet to start
- `COME_OUT` — puck OFF, no point established. Player places Pass/Don't Pass and other bets, then rolls
- `POINT` — puck ON, point established. Player can add Odds, Come/Don't Come, adjust Place bets, then rolls
- `ROLL_PENDING` — VRF request in flight. All bet placement and removal blocked until callback resolves

**`lastActivityTime` initialization:** When the session transitions from `INACTIVE` to `COME_OUT` (first bet placed), `lastActivityTime` is set to `block.timestamp`. This starts the 24-hour expiry clock. Each completed roll (VRF callback resolution) resets `lastActivityTime` to `block.timestamp`.

The player controls the pace entirely. They place bets, hit roll, wait ~6 seconds for VRF, see the result, adjust bets, and roll again. No other player affects their session.

#### Pass Line Progression (Per Session)

```
NO_POINT → come-out roll:
  → 7 or 11: Pass wins, stays NO_POINT
  → 2, 3, or 12: Pass loses, stays NO_POINT
  → 4/5/6/8/9/10: Point established → POINT phase
    → roll point again: Pass wins, back to NO_POINT
    → roll 7: Pass loses (seven-out), back to NO_POINT
```

### Come Bet Sub-State Machines

Each active Come/Don't Come bet within a player's session has its own independent lifecycle that mirrors the pass line:

```
COME_PENDING → (next roll is its "come-out")
  → 7 or 11: Come wins immediately
  → 2, 3, or 12: Come loses immediately (Don't Come: 2/3 win, 12 pushes)
  → anything else: COME_POINT_ESTABLISHED(N)
    → subsequent roll of N: Come wins
    → subsequent roll of 7: Come loses
```

Come bets are stored within the player's `Session.comeBets` fixed array (max 4 slots), each tracking its own point and amount. Come Odds bets attach to a specific Come bet by index.

**Max concurrent Come bets per session: 4** (to bound callback gas).

### Hardway Resolution Logic

Hardway bets resolve on every roll. They are not one-roll bets (they persist across rolls), but they must be checked against every dice outcome. There are three possible outcomes per roll:

**Win:** The target number is rolled as a pair. Hardway 4 wins on 2+2. Hardway 6 wins on 3+3. Hardway 8 wins on 4+4. Hardway 10 wins on 5+5. Both `die1` and `die2` must be checked — the condition is `die1 == die2 && die1 + die2 == target`.

**Lose — easy way:** The target number is rolled but not as a pair. Hardway 6 loses on 1+5, 2+4, 4+2, 5+1. The condition is `die1 + die2 == target && die1 != die2`.

**Lose — seven out:** Any 7 is rolled (`die1 + die2 == 7`). This kills all active hardway bets simultaneously, regardless of their target number.

**No action:** Any other roll. The bet persists.

Complete resolution check per active hardway bet:

```
sum = die1 + die2

if sum == target && die1 == die2:
    WIN — pay hardway odds, remove bet
else if sum == target && die1 != die2:
    LOSE — house takes bet, remove bet
else if sum == 7:
    LOSE — house takes bet, remove bet
else:
    NO ACTION — bet stays active
```

**Implementation note:** On a seven-out during the point phase, the callback resolves Pass Line losses, Come bet losses, Place bet losses, AND all active hardway losses on the same roll. The callback must iterate all bet types — it cannot skip hardways just because seven-out triggers other cleanup. Resolution order within the callback does not matter for correctness (all bets resolve against the same dice outcome).

### Complex Resolution Scenarios

These scenarios document the most subtle callback interactions. Each must have a dedicated integration test verifying every bet slot's outcome.

**CRITICAL IMPLEMENTATION RULE:** The callback does NOT branch on session phase to decide which bet types to check. It iterates ALL bet slots on EVERY roll. Each bet type has its own resolution logic that internally checks whether the roll is relevant to it. The phase only matters for determining the post-resolution state transition (does a point get established, does the puck go OFF, etc.), not for deciding which bets to evaluate. There is no shortcut of "skip Come bets during come-out" or "skip Place bets during come-out."

#### Scenario 1 — Seven-Out During Point Phase (Most Complex Callback Path)

A 7 is rolled while the puck is ON. This is the single most complex resolution because almost every bet type resolves simultaneously, and some resolve in opposite directions.

| Bet | Outcome | Notes |
|---|---|---|
| Pass Line | **Loses** | House takes bet |
| Pass Odds | **Loses** | House takes bet |
| Don't Pass | **Wins** | Pays 1:1 |
| Don't Pass Odds | **Wins** | Pays true odds based on point |
| Come bet WITH established point | **Loses** | House takes base AND attached Come Odds |
| Come bet WITHOUT established point (COME_PENDING) | **Wins** | 7 is a winner on its "come-out." Pays 1:1. Come Odds cannot exist on a pending Come bet |
| Don't Come WITH established point | **Wins** | Pays 1:1. Don't Come Odds also win at true odds |
| Don't Come WITHOUT established point (pending) | **Loses** | 7 on Don't Come "come-out" is a loss |
| Place bets — ON | **Loses** | House takes bet |
| Place bets — OFF | **Loses** | Seven-out sweeps ALL Place bets regardless of toggle |
| All Hardways | **Loses** | 7 kills all active hardways |
| Field | **Loses** | 7 is not a field number |
| Any 7 | **Wins** | Pays 4:1 |
| Any Craps | **Loses** | 7 is not 2, 3, or 12 |
| Yo | **Loses** | 7 is not 11 |
| Hi-Lo | **Loses** | 7 is not 2 or 12 |
| Aces | **Loses** | |
| Boxcars | **Loses** | |

**After resolution:** Point resets to 0. Puck goes OFF. Phase becomes COME_OUT. All bet slots should be cleared (no bets survive a seven-out).

**Critical trap:** Pending Come bets WIN on 7 while established Come bets LOSE on 7. These are opposite outcomes resolved in the same callback iteration. The `comeBets` loop must check each slot's state — if `comeBet.point == 0` it's pending (7 wins), if `comeBet.point != 0` it's established (7 loses). Same logic inverted for Don't Come.

#### Scenario 2 — Pass Line Wins on Point, Surviving Come Bets Carry Over

When the Pass Line wins by hitting the point, the puck goes OFF, but existing Come bets with established points SURVIVE into the next come-out phase. They are still live, still waiting for their number or a 7.

**Roll sequence:**

**State:** Point is 6. Player has Pass Line $500, Pass Odds $1500, Come bet on 9 with Come Odds, Place 4 ON, Hardway 4 active.

**Roll: 6 (easy, 2+4).** Hits the point.

| Bet | Outcome |
|---|---|
| Pass Line | **Wins.** 1:1. Cleared |
| Pass Odds | **Wins.** 6:5. Cleared |
| Come bet on 9 | **No action.** 6 is not 9 or 7. Survives |
| Come Odds on 9 | **No action.** Survives |
| Place 4 | **No action.** 6 is not 4. Survives |
| Hardway 4 | **No action.** 6 is not 4 or 7. Survives |
| Field | **Loses.** 6 is not a field number |

**After resolution:** Point resets to 0. Puck goes OFF. Phase becomes COME_OUT. But Come bet on 9, Come Odds on 9, Place 4, and Hardway 4 are all still active.

**Player places new Pass Line $500 and rolls again.**

**Roll: 7.**

This is a come-out 7, NOT a seven-out. But surviving bets from the previous round still resolve:

| Bet | Outcome |
|---|---|
| New Pass Line | **Wins.** 7 on come-out. 1:1 |
| Don't Pass (if placed) | **Loses.** 7 on come-out |
| Surviving Come bet on 9 | **Loses.** 7 kills established Come bets regardless of phase |
| Surviving Come Odds on 9 | **Loses.** House takes |
| Surviving Don't Come on 9 (if existed) | **Wins.** 7 against established Don't Come |
| Place 4 (ON or OFF) | **Loses.** Any 7 kills Place bets |
| Hardway 4 | **Loses.** Any 7 kills Hardways |
| Any 7 | **Wins.** 4:1 |
| All other one-rolls | Resolve normally against 7 |

**After resolution:** Puck stays OFF. Phase stays COME_OUT. All bets now cleared.

**Why this matters:** An implementer might assume come-out rolls only need to resolve Pass/Don't Pass and one-roll bets, since Come bets "can't be placed" when puck is OFF. But they can SURVIVE from the previous round. The callback must always iterate all slots.

**Extended variant — surviving bets across multiple come-out rolls:**

If instead of a 7, the come-out roll was 12:

| Bet | Outcome |
|---|---|
| Pass Line | **Loses.** Cleared |
| Don't Pass | **Pushes (bar 12).** Stays in `_inPlay`, NOT cleared |
| Surviving Come bet on 9 | **No action.** 12 is not 9 or 7. Still survives |
| Place bets | **No action.** 12 is not 4/5/6/8/9/10 |
| Hardways | **No action.** 12 is not 4/6/8/10 and not 7 |

The Come bet on 9 is STILL alive. The Don't Pass STILL alive (pushed). Player can place a new Pass Line and roll again. Surviving bets can persist across multiple come-out rolls if the player keeps rolling craps or naturals without establishing a new point.

#### Scenario 3 — Don't Pass / Don't Come Push on 12

These bets have a third outcome beyond win/lose. On a come-out roll of 12, Don't Pass neither wins nor loses. The resolution code must have three branches:

**Don't Pass on come-out roll:**

```
if sum == 7:
    LOSE — house takes bet, clear slot
else if sum == 2 or sum == 3:
    WIN — pay 1:1, clear slot
else if sum == 12:
    PUSH — do nothing. Bet stays in _inPlay, slot unchanged
else:
    Point established, bet persists into point phase
```

**Don't Come on its pending roll (same logic):**

```
if sum == 7:
    LOSE — house takes bet, clear slot
else if sum == 2 or sum == 3:
    WIN — pay 1:1, clear slot
else if sum == 12:
    PUSH — do nothing. Bet stays, no Come point established
else:
    Come point established at sum, bet persists
```

**Implementation trap:** An implementer writing `if win → pay, else → house takes` will accidentally confiscate the bet on a push. The push case must be an explicit no-op — no funds move between any buckets.

**Full come-out roll of 12 resolution:**

| Bet | Outcome |
|---|---|
| Pass Line | **Loses** |
| Don't Pass | **Pushes.** No action |
| Field | **Wins** at 3:1 |
| Any Craps | **Wins** at 7:1 |
| Boxcars (12) | **Wins** at 30:1 |
| Hi-Lo | **Wins** at 15:1 |
| Aces | **Loses** (12 is not 2) |
| Yo | **Loses** (12 is not 11) |
| Any 7 | **Loses** |
| Surviving Come bets | Resolve per their own state (12 is not 7, may or may not match their point) |
| Place/Hardway | No action (12 is not relevant) |

#### Scenario 4 — Come-Out Roll of 7 With Place Bets and Hardways Active

This is NOT a seven-out (seven-out only happens during the point phase), but a 7 on come-out still kills Place bets and Hardways. An implementer might only handle Place/Hardway losses inside a "seven-out" code path and miss this case.

**The rule is universal:** Any time a 7 is rolled — come-out or point phase — all active Place bets and all active Hardways lose. No phase check needed for this logic.

| Bet | Outcome |
|---|---|
| Pass Line | **Wins.** 7 on come-out |
| Don't Pass | **Loses** |
| Place bets (ON) | **Loses.** Any 7 kills them |
| Place bets (OFF) | **Loses.** Any 7 kills them regardless of toggle |
| All Hardways | **Loses.** Any 7 kills them |
| Any 7 | **Wins** at 4:1 |
| Field | **Loses** |
| All other one-rolls | Resolve normally |

**After resolution:** Puck stays OFF. Phase stays COME_OUT. No point established.

### Required Integration Tests for Complex Scenarios

The following tests must exist and pass before Phase 2 is considered complete:

1. **Seven-out with all bet types active** — verify every slot resolves correctly, especially pending vs. established Come/Don't Come bets resolving in opposite directions
2. **Pass Line wins on point with surviving Come bets** — verify Come bets carry over into COME_OUT phase, then resolve correctly on subsequent roll
3. **Surviving bets across multiple come-out rolls** — verify Come bets and Place bets persist through craps rolls (2, 3, 12) and naturals (7, 11) on come-out without being incorrectly cleared
4. **Don't Pass push on 12** — verify bet stays in `_inPlay`, slot not cleared, funds don't move
5. **Don't Come push on 12** — same verification for Don't Come in COME_PENDING state
6. **Come-out 7 with Place bets and Hardways** — verify all Place/Hardway bets lose even though this is not a seven-out
7. **Come-out 7 with OFF Place bets** — verify OFF Place bets are still swept
8. **Callback iterates all slots regardless of phase** — a structural test that places bets in every slot, transitions through phases, and confirms no slot is skipped during resolution

### Bet Types

| Bet | Payout | House Edge | Notes |
|---|---|---|---|
| Pass Line | 1:1 | 1.41% | Puck OFF only |
| Don't Pass | 1:1 | 1.36% | Puck OFF only, bar 12 (push on 12) |
| Come | 1:1 | 1.41% | Puck ON only |
| Don't Come | 1:1 | 1.36% | Puck ON only, bar 12 |
| Pass Odds | True odds | 0% | Puck ON only, max 3x flat bet |
| Don't Pass Odds | True odds | 0% | Puck ON only, max 3x |
| Come Odds | True odds | 0% | Puck ON only, max 3x, attached to specific Come bet |
| Don't Come Odds | True odds | 0% | Puck ON only, max 3x |
| Place 6, Place 8 | 7:6 | 1.52% | Either phase, player toggles ON/OFF |
| Place 5, Place 9 | 7:5 | 4.00% | Either phase, player toggles ON/OFF |
| Place 4, Place 10 | 9:5 | 6.67% | Either phase, player toggles ON/OFF |
| Field | 1:1 (2 pays 2:1, 12 pays 3:1) | 5.56% | Either phase, one-roll bet |
| Hardway 6, Hardway 8 | 9:1 | 9.09% | Either phase, max $100 |
| Hardway 4, Hardway 10 | 7:1 | 11.11% | Either phase, max $100 |
| Any 7 | 4:1 | 16.67% | Either phase, one-roll, max $100 |
| Any Craps | 7:1 | 11.11% | Either phase, one-roll (2, 3, or 12), max $100 |
| Yo (11) | 15:1 | 11.11% | Either phase, one-roll, max $100 |
| Hi-Lo (2 or 12) | 15:1 | 11.11% | Either phase, one-roll, max $100 |
| Aces (2) | 30:1 | 13.89% | Either phase, one-roll, max $100 |
| Boxcars (12) | 30:1 | 13.89% | Either phase, one-roll, max $100 |

**Excluded:** Big 6 / Big 8 — these are strictly inferior to Place 6/8 (same outcome, worse payout). Removing them reduces contract complexity with zero loss of meaningful gameplay.

### Tiered Bet Limits

Just like a real casino, proposition and one-roll bets have lower maximums than line bets. This is standard risk management — the 30:1 prop bets drive worst-case exposure far more than 1:1 line bets.

| Bet Category | Minimum | Maximum |
|---|---|---|
| Pass / Don't Pass | $5 | $500 |
| Come / Don't Come | $5 | $500 |
| Odds (Pass, Don't Pass, Come, Don't Come) | See multiples table below | 3× flat bet |
| Place 4, 5, 9, 10 | $5 | $500 |
| Place 6, 8 | $6 | $500 (must be multiple of 6; effective max $498) |
| Field | $5 | $500 |
| Hardways | $5 | $100 |
| Proposition / One-Roll (Any 7, Any Craps, Yo, Hi-Lo, Aces, Boxcars) | $5 | $100 |

These limits are set as immutable constructor parameters per deployment. Different limit tiers require deploying separate contract instances.

### Payout Multiples Validation

All bets with fractional payouts must be placed in exact multiples to ensure clean integer math. The contract validates these constraints at bet placement time — no rounding, no truncation, no dust. If a bet amount fails the multiple check, the transaction reverts before any state changes.

**Line bets (1:1 payouts — no multiple constraints):**

| Bet | Payout | Math | Required Multiple | Minimum |
|---|---|---|---|---|
| Pass Line | 1:1 | `amount * 1` | 1 (any) | $5 |
| Don't Pass | 1:1 | `amount * 1` | 1 (any) | $5 |
| Come | 1:1 | `amount * 1` | 1 (any) | $5 |
| Don't Come | 1:1 | `amount * 1` | 1 (any) | $5 |

**Pass / Come Odds (payout depends on point):**

| Point | Payout | Math | Required Multiple | Minimum |
|---|---|---|---|---|
| 4 or 10 | 2:1 | `amount * 2` | 1 (any) | $5 |
| 5 or 9 | 3:2 | `amount * 3 / 2` | 2 | $6 |
| 6 or 8 | 6:5 | `amount * 6 / 5` | 5 | $5 |

**Don't Pass / Don't Come Odds (payout depends on point):**

| Point | Payout | Math | Required Multiple | Minimum |
|---|---|---|---|---|
| 4 or 10 | 1:2 | `amount / 2` | 2 | $6 |
| 5 or 9 | 2:3 | `amount * 2 / 3` | 3 | $6 |
| 6 or 8 | 5:6 | `amount * 5 / 6` | 6 | $6 |

**Place bets:**

| Bet | Payout | Math | Required Multiple | Minimum |
|---|---|---|---|---|
| Place 4 or 10 | 9:5 | `amount * 9 / 5` | 5 | $5 |
| Place 5 or 9 | 7:5 | `amount * 7 / 5` | 5 | $5 |
| Place 6 or 8 | 7:6 | `amount * 7 / 6` | 6 | $6 |

**All other bets (integer multiplier payouts — no multiple constraints):**

| Bet | Payout | Math | Required Multiple | Minimum | Maximum |
|---|---|---|---|---|---|
| Field (base) | 1:1 | `amount * 1` | 1 (any) | $5 | $500 |
| Field (on 2) | 2:1 | `amount * 2` | 1 (any) | — | — |
| Field (on 12) | 3:1 | `amount * 3` | 1 (any) | — | — |
| Hardway 6/8 | 9:1 | `amount * 9` | 1 (any) | $5 | $100 |
| Hardway 4/10 | 7:1 | `amount * 7` | 1 (any) | $5 | $100 |
| Any 7 | 4:1 | `amount * 4` | 1 (any) | $5 | $100 |
| Any Craps | 7:1 | `amount * 7` | 1 (any) | $5 | $100 |
| Yo (11) | 15:1 | `amount * 15` | 1 (any) | $5 | $100 |
| Hi-Lo | 15:1 | `amount * 15` | 1 (any) | $5 | $100 |
| Aces (2) | 30:1 | `amount * 30` | 1 (any) | $5 | $100 |
| Boxcars (12) | 30:1 | `amount * 30` | 1 (any) | $5 | $100 |

**Odds bet interaction with 3x cap:** Odds bets are capped at 3x the flat bet. A player with a $5 Pass Line on a point of 5 can take up to $15 in odds, but the odds amount must be a multiple of 2. So their valid choices are $6, $8, $10, $12, or $14 — not $15. The contract validates both constraints independently: `amount <= 3 * flatBet` and `amount % requiredMultiple == 0`. The effective max is the largest valid multiple at or below the 3x cap, but the contract does not compute that — it just rejects invalid amounts.

### Bet Stacking Behavior

When a player places a bet on a slot that already has a bet, the behavior depends on the bet type:

| Bet Type | Stacking Behavior |
|---|---|
| Pass Line | **Reject.** Only one bet allowed. Reverts if slot is occupied |
| Don't Pass | **Reject.** Only one bet allowed. Reverts if slot is occupied |
| Come | **New slot.** Each placement uses the next empty `comeBets` slot. If all 4 are full, reverts |
| Don't Come | **New slot.** Same as Come — uses next empty slot |
| Pass Odds | **Additive.** Adds to existing odds amount. Validates new total against 3x cap and required multiple |
| Don't Pass Odds | **Additive.** Same as Pass Odds |
| Come Odds | **Additive.** Adds to existing odds on the specified Come bet. Validates new total against 3x cap and required multiple |
| Don't Come Odds | **Additive.** Same as Come Odds |
| Place bets | **Additive.** Adds to existing amount. Validates new total against $500 max and required multiple for that number |
| Hardways | **Additive.** Adds to existing amount. Validates new total against $100 max |
| One-roll bets | **Additive.** Adds to existing amount. Validates new total against relevant max ($500 for Field, $100 for props) |

For additive bets, the contract validates that the NEW TOTAL (existing + added) satisfies the max limit and the required multiple, then moves only the added amount from `_available` to `_inPlay`.

### Bet Removal Mechanics

Certain bets can be taken down (removed) by the player, returning funds from `_inPlay` to `_available`. Other bets are locked once placed, matching standard casino rules.

**Locked (cannot be removed):**

| Bet | Lock Rule |
|---|---|
| Pass Line | Locked from the moment of placement. Cannot be removed at any time |
| Come | Locked from the moment of placement. Cannot be removed at any time |

**Removable at any time:**

| Bet | Notes |
|---|---|
| Don't Pass | Removable (disadvantageous to player — casino allows it) |
| Don't Come | Removable (same rationale) |
| Pass Odds | Always removable |
| Don't Pass Odds | Always removable |
| Come Odds | Always removable |
| Don't Come Odds | Always removable |
| Place bets | Can be toggled OFF or removed entirely |
| Hardways | Always removable |
| One-roll bets | Removable before rolling (no window to remove between roll and resolution) |

Removal is handled by the explicit per-bet-type removal functions defined in the Bet Placement Functions section (e.g., `removeDontPass()`, `removePlace(placeIndex)`, `removeHardway(hardwayIndex)`). There is no generic `removeBet()` function.

The removal function validates that the bet type is removable per the rules above, moves the bet amount from `_inPlay` back to `_available`, and zeros the slot. For Odds bets, removing the odds does not affect the parent bet. Removing a Don't Pass or Don't Come bet also removes any attached odds.

**No bet removal during `ROLL_PENDING`:** All bet modifications (placement and removal) are blocked while the session is in `ROLL_PENDING`. The player must wait for the VRF callback to resolve before adjusting bets.

### Bet Availability by Puck State

The player can turn on any or all of their bets when the puck is off, matching a real bubble craps machine. The contract enforces which bets are valid in each phase:

**Puck OFF (no point established — come-out roll):**

| Bet | Available | Notes |
|---|---|---|
| Pass Line | ✅ | Must be placed before come-out |
| Don't Pass | ✅ | Must be placed before come-out |
| Place Bets | ✅ | Player can toggle ON for come-out (default OFF) |
| Field | ✅ | One-roll, resolves immediately |
| Hardways | ✅ | Persist until they hit or 7-out |
| Any 7 / Any Craps / Yo / Hi-Lo / Aces / Boxcars | ✅ | One-roll, resolve immediately |
| Come / Don't Come | ❌ | Requires a point to be established |
| Odds | ❌ | Requires a point to be established |

**Puck ON (point established):**

| Bet | Available | Notes |
|---|---|---|
| Come / Don't Come | ✅ | Now available |
| Odds (Pass, Don't Pass, Come, Don't Come) | ✅ | Now available, max 3× flat bet |
| Place Bets | ✅ | Can add/remove/change at any time |
| Field | ✅ | One-roll |
| Hardways | ✅ | Can add if not already active |
| Any 7 / Any Craps / Yo / Hi-Lo / Aces / Boxcars | ✅ | One-roll |
| Pass Line | ❌ | Cannot be placed mid-round |
| Don't Pass | ❌ | Cannot be placed mid-round |

**Place Bet Toggle:** Place bets have an `active` flag per session. When puck is OFF, the player can toggle individual Place bets ON or OFF before rolling. When toggled OFF, the bet stays on the layout (funds remain in `_inPlay`) but does not win on its number. However, a 7 kills ALL Place bets regardless of toggle state — ON or OFF, come-out or point phase. This mirrors standard casino rules where a seven-out sweeps the entire layout. Players may also remove Place bets entirely (returning funds to `_available`).

### Odds Payout Table (3x Max)

| Point | Pass Odds Payout | Don't Pass Odds Payout |
|---|---|---|
| 4 or 10 | 2:1 | 1:2 |
| 5 or 9 | 3:2 | 2:3 |
| 6 or 8 | 6:5 | 5:6 |

With 3x max odds and a table max of $500, the worst-case single-roll odds exposure is: $500 × 3 = $1,500 at 2:1 = $3,000 payout (on a 4 or 10 point). Combined with the Pass Line win, pass line + odds max win = $3,500.

However, total worst-case per session per roll includes all concurrent bets. See **Bankroll Sizing** section for the full derivation.

---

## Vault Design (within `CrapsGame.sol`)

### Contract Architecture

All game logic — vault accounting, session management, VRF integration, and exclusion — lives in a single `CrapsGame.sol` contract. `PayoutMath.sol` remains a separate pure library with no state.

**Rationale:** The VRF callback needs to modify `_available`, `_inPlay`, `_reserved`, and `bankroll` atomically during bet resolution. Separating vault and game into different contracts would require external calls inside the callback (which must never revert) and additional access control plumbing (`onlyGame` modifiers). A single contract keeps all state modifications internal, simplifies access control, and eliminates external call risk in the callback.

The contract inherits from:
- `VRFConsumerBaseV2Plus` (Chainlink VRF)
- `Ownable` (OpenZeppelin — owner functions)
- `ReentrancyGuard` (OpenZeppelin — deposit/withdrawal safety)
- `Pausable` (OpenZeppelin — emergency pause)

### Five-Bucket Invariant

The vault's token balance must **always** satisfy:

```
token.balanceOf(vault) == _available[all players] + _inPlay[all players] + _reserved[all players] + bankroll + accruedFees
```

This invariant is enforced by an `assertInvariant()` helper called in every test. Any code path that moves tokens in or out must maintain it.

### Buckets

| Bucket | Description |
|---|---|
| `_available[player]` | Player's withdrawable balance (deposited minus fees, plus winnings) |
| `_inPlay[player]` | Player's funds currently locked in active bets |
| `_reserved[player]` | Worst-case house payout reserved from bankroll for this player's pending roll (0 if no roll pending) |
| `bankroll` | House funds that pay player wins; grows from player losses. Reduced by active reserves |
| `accruedFees` | Accumulated 0.5% deposit fees, withdrawable by owner only |

### Token Configuration

The contract accepts a single ERC-20 token, specified as a constructor parameter. Each deployment is bound to one token. To support multiple stablecoins (e.g., USDC and DAI), deploy separate contract instances.

```solidity
constructor(
    address _token,
    uint8 _tokenDecimals,
    // ... other params
) {
    token = IERC20(_token);
    tokenDecimals = _tokenDecimals;
    // all constant amounts (bet limits, bankroll thresholds) are denominated
    // in token units scaled to _tokenDecimals
}
```

The contract exposes `token()` and `tokenDecimals()` view functions for frontend and block explorer transparency.

**Rationale:** This avoids the complexity of multi-token accounting while providing flexibility to operate USDC, DAI, or other stablecoin instances independently. If Circle blocklists a USDC deployment, other token instances are unaffected.

**Token compatibility constraint:** The contract is designed for standard ERC-20 tokens only. Fee-on-transfer tokens, rebasing tokens, and tokens with transfer hooks will break the five-bucket invariant (the vault credits the full amount but receives less on transfer). The operator is responsible for deploying only with compatible tokens. USDC, DAI, and USDT on BASE are all standard ERC-20 and compatible.

### Deposit Flow

1. Player approves token spend to vault
2. Player calls `deposit(amount)`
3. Fee = `amount * 50 / 10000` (0.5%, `DEPOSIT_FEE_BPS = 50`)
4. `_available[player] += amount - fee`
5. `accruedFees += fee`

### Withdrawal Flow

1. Player calls `withdraw(amount)` where `amount <= _available[player]`
2. `_available[player] -= amount`
3. Token transferred to player

### Bet Placement Functions

Each bet type has its own dedicated function. This keeps validation explicit and avoids a monolithic switch statement with unused parameters.

**Bet placement functions:**

```solidity
// Line bets
function placePassLine(uint256 amount) external;
function placeDontPass(uint256 amount) external;
function placeCome(uint256 amount) external;
function placeDontCome(uint256 amount) external;

// Odds bets (attach to parent)
function placePassOdds(uint256 amount) external;
function placeDontPassOdds(uint256 amount) external;
function placeComeOdds(uint8 comeBetIndex, uint256 amount) external;
function placeDontComeOdds(uint8 comeBetIndex, uint256 amount) external;

// Place bets (index 0-5 → numbers [4, 5, 6, 8, 9, 10])
function placePlace(uint8 placeIndex, uint256 amount) external;

// One-roll and proposition bets
function placeField(uint256 amount) external;
function placeHardway(uint8 hardwayIndex, uint256 amount) external; // index 0-3 → [4, 6, 8, 10]
function placeAny7(uint256 amount) external;
function placeAnyCraps(uint256 amount) external;
function placeYo(uint256 amount) external;
function placeHiLo(uint256 amount) external;
function placeAces(uint256 amount) external;
function placeBoxcars(uint256 amount) external;
```

**Bet removal functions (removable bet types only):**

```solidity
function removeDontPass() external;
function removeDontCome(uint8 comeBetIndex) external;
function removePassOdds() external;
function removeDontPassOdds() external;
function removeComeOdds(uint8 comeBetIndex) external;
function removeDontComeOdds(uint8 comeBetIndex) external;
function removePlace(uint8 placeIndex) external;
function removeHardway(uint8 hardwayIndex) external;
function removeField() external;
function removeAny7() external;
function removeAnyCraps() external;
function removeYo() external;
function removeHiLo() external;
function removeAces() external;
function removeBoxcars() external;
```

**Place bet toggle:**

```solidity
function togglePlace(uint8 placeIndex, bool active) external;
```

**Common validation for all placement functions:**
1. `whenNotPaused` modifier (OpenZeppelin Pausable)
2. `notExcluded` modifier
3. `session.phase != ROLL_PENDING`
4. `session.phase != INACTIVE` (except for the first bet, which transitions INACTIVE → COME_OUT)
5. `amount <= _available[player]`
6. Amount meets minimum, does not exceed maximum, satisfies required multiple for bet type
7. Bet type is allowed in current puck state (COME_OUT vs POINT)
8. Stacking rules: Pass/Don't Pass reject if slot occupied; Come/Don't Come use next empty slot; all others are additive up to cap

**Common validation for all removal functions:**
1. `session.phase != ROLL_PENDING`
2. Bet exists (amount > 0)
3. Bet type is removable (Pass Line and Come bets have no removal function)

On removal, the bet amount moves from `_inPlay` back to `_available` and the slot is zeroed. Removing a Don't Pass or Don't Come also removes any attached odds.

### Reserve-on-Roll Flow

When a player calls `rollDice()`, the contract pre-reserves the worst-case house payout from the bankroll to guarantee solvency:

1. Player calls `rollDice()`
2. `worstCase = PayoutMath.maxPossiblePayout(session)` — exact worst case across all 15 dice outcomes
3. `require(bankroll >= worstCase, "Insufficient bankroll")`
4. `bankroll -= worstCase`
5. `_reserved[player] = worstCase`
6. `totalReserved += worstCase`
7. VRF request submitted, session enters `ROLL_PENDING`

### Bet Resolution Flow (inside VRF callback)

The callback resolves all bets and releases the reserve:

```
// Track total winnings paid out during this callback
uint256 actualPayoutTotal = 0;

// For each active bet in the session:
if bet wins:
    payout = PayoutMath.calculate(betType, amount, diceResult)
    _inPlay[player] -= amount
    _available[player] += amount + payout   // original bet + winnings
    actualPayoutTotal += payout

if bet loses:
    _inPlay[player] -= amount
    bankroll += amount

// After all bets resolved — release unused reserve:
bankroll += (_reserved[player] - actualPayoutTotal)
totalReserved -= _reserved[player]
_reserved[player] = 0
```

The invariant holds at every step, and the callback can never overdraw the bankroll because the worst case was pre-funded in `_reserved`.

### maxPossiblePayout Calculation

This function lives in `PayoutMath.sol` and computes the exact worst-case house payout for a given session's active bets:

```solidity
function maxPossiblePayout(Session storage session) internal view returns (uint256)
```

**Algorithm:** Iterate all 15 distinct dice outcomes (sums 2–12, splitting 4/6/8/10 into hard and easy variants). For each outcome, walk the player's active bets and sum only the winnings the house would owe (not the original bet amount, which is already in `_inPlay`). Return the maximum across all 15 outcomes.

**Critical:** Within a single outcome, some bets win while others lose. For example on a 7 during the point phase, Pass Line loses and Don't Pass wins. The function must only sum the winning side's payout for that outcome, not both.

**Come bet handling:** A pending Come bet (no point yet) resolves on this roll's outcome. A Come bet with an established point of 6 only resolves if this roll is a 6 or a 7. The function handles both states per Come bet.

The 15 outcomes to evaluate:

| Outcome | Sum | die1 | die2 | Notes |
|---|---|---|---|---|
| 2 (Aces) | 2 | 1 | 1 | Hard only (always a pair) |
| 3 | 3 | 1 | 2 | |
| Hard 4 | 4 | 2 | 2 | |
| Easy 4 | 4 | 1 | 3 | |
| 5 | 5 | 2 | 3 | |
| Hard 6 | 6 | 3 | 3 | |
| Easy 6 | 6 | 2 | 4 | |
| 7 | 7 | 3 | 4 | |
| Hard 8 | 8 | 4 | 4 | |
| Easy 8 | 8 | 3 | 5 | |
| 9 | 9 | 4 | 5 | |
| Hard 10 | 10 | 5 | 5 | |
| Easy 10 | 10 | 4 | 6 | |
| 11 (Yo) | 11 | 5 | 6 | |
| 12 (Boxcars) | 12 | 6 | 6 | Hard only (always a pair) |

### Owner Functions

- `withdrawFees(amount)` — draws only from `accruedFees`, requires `amount <= accruedFees`
- `withdrawBankroll(amount)` — requires `paused == true` AND `pendingVRFRequests == 0`, draws from `bankroll`
- `depositBankroll()` — owner adds to `bankroll` at any time

### Stablecoin Proxy Considerations

USDC on BASE is a proxy contract with upgradeable logic. Circle can also blocklist addresses, freezing their USDC balance. Mitigations:

- Use pull-based withdrawals (players call `withdraw`, never push payments)
- Never rely on USDC `transfer` return value semantics staying constant
- Use OpenZeppelin `SafeERC20` for all transfers
- Monitor Circle announcements for proxy upgrades
- Keep bankroll lean — don't over-capitalize beyond operational needs
- Accepted risk: if the vault contract address is blocklisted, all funds in that instance are frozen. Separate deployments for different stablecoins isolate this risk

### Session Timeout (24-Hour Expiry)

Sessions expire after 24 hours of inactivity to prevent stale sessions from locking funds against the bankroll indefinitely. The timeout is measured from the last completed roll (or session creation if no rolls have occurred).

```solidity
uint256 public constant SESSION_TIMEOUT = 24 hours;
```

**Expiry flow:**

1. Any call to `rollDice()` or `placeBet()` checks `block.timestamp > session.lastActivityTime + SESSION_TIMEOUT`
2. If expired, the session cannot accept new rolls
3. Anyone can call `expireSession(playerAddress)` for sessions past the timeout
4. On expiry:
   - All `_inPlay` funds for that session move back to `_available` (bets are returned, not forfeited)
   - If the session is in `ROLL_PENDING`, the `requestToPlayer` mapping is deleted, `_reserved` is returned to `bankroll`, `totalReserved` is decremented, and `pendingVRFRequests` is decremented. If the VRF callback later arrives for this request, it finds `address(0)` and silently returns.
   - Session phase resets to `INACTIVE`
   - All bet slots (passLine, dontPass, all comeBets, all placeBets, all hardways, oneRolls) are zeroed
   - Event `SessionExpired(player, returnedAmount)` emitted
5. The player can then call `withdraw()` to recover their full `_available` balance
6. The player can also start a new session by placing a new bet

**Session expiry cleanup for Come bets:** The expiry function must iterate all 4 Come bet slots. Each slot may have a base Come/Don't Come amount plus an attached Come Odds amount. Both must be summed and returned from `_inPlay` to `_available`. The fixed-size struct makes this straightforward — iterate all slots, skip zeros.

**Why return funds, not forfeit:** Forfeiting expired bets would be punitive and erode player trust. The operator's interest is capital efficiency (freeing bankroll exposure), not confiscating player funds. Returning bets achieves this.

---

## Responsible Gambling

### Voluntary Self-Exclusion

A player can call `selfExclude()` to immediately block themselves from all gameplay. This is designed as a cooling-off mechanism for players who recognize they need to stop.

```solidity
mapping(address => bool) public selfExcluded;
mapping(address => uint256) public reinstatementRequestTime;

uint256 public constant REINSTATEMENT_DELAY = 7 days;
```

**`selfExclude()`** — sets `selfExcluded[msg.sender] = true` immediately. Any active session is expired (bets returned to `_available`). Player can still call `withdraw()`. Emits `SelfExcluded(player)`.

**`requestReinstatement()`** — requires `selfExcluded[msg.sender] == true`. Sets `reinstatementRequestTime[msg.sender] = block.timestamp`. Emits `ReinstatementRequested(player, eligibleAt)`.

**`completeReinstatement()`** — requires `selfExcluded` is true, `reinstatementRequestTime` is nonzero, and `block.timestamp >= reinstatementRequestTime + REINSTATEMENT_DELAY`. Clears both flags. Emits `ReinstatementCompleted(player)`.

If a player calls `selfExclude()` again while a reinstatement is pending, it cancels the reinstatement and resets the timer. This prevents gaming the cooloff period.

### Operator-Imposed Exclusion

The operator can exclude a player's address for legal, compliance, or other reasons.

```solidity
mapping(address => bool) public operatorExcluded;
```

**`excludePlayer(address player)`** — `onlyOwner`. Same effect as self-exclusion: active session expired, bets returned, deposits and new sessions blocked. Withdrawal stays open. Emits `OperatorExcluded(player)`.

**`reinstatePlayer(address player)`** — `onlyOwner`. Clears the flag immediately, no delay (the operator is trusted to make this call deliberately). Emits `OperatorReinstated(player)`.

### Enforcement

Every call to `deposit()`, all bet placement functions, and `rollDice()` applies both modifiers:

```solidity
modifier notExcluded() {
    require(!selfExcluded[msg.sender] && !operatorExcluded[msg.sender], "Excluded");
    _;
}
// Also: whenNotPaused (from OpenZeppelin Pausable) on deposit, all placement, and rollDice
```

`withdraw()` is never gated by exclusion or pause — excluded and paused players can always recover their funds.

### Shared Session Expiry Path

**Critical implementation detail:** `selfExclude()`, `excludePlayer()`, and `expireSession()` must all call the same internal `_expireSession(address player)` function. This single code path handles every cleanup scenario including ROLL_PENDING:

```solidity
function _expireSession(address player) internal {
    Session storage session = sessions[player];
    if (session.phase == SessionPhase.INACTIVE) return;

    // If ROLL_PENDING, clean up VRF request and reserve
    if (session.phase == SessionPhase.ROLL_PENDING) {
        delete requestToPlayer[session.vrfRequestId];
        pendingVRFRequests--;
        bankroll += _reserved[player];
        totalReserved -= _reserved[player];
        _reserved[player] = 0;
    }

    // Return all inPlay to available (iterate all fixed-size bet slots, sum amounts)
    uint256 returnedAmount = _inPlay[player];
    _available[player] += returnedAmount;
    _inPlay[player] = 0;

    // Zero all bet slots, reset session
    // ... clear passLine, dontPass, comeBets[0..3], placeBets[0..5], hardways[0..3], oneRolls
    session.phase = SessionPhase.INACTIVE;
    session.point = 0;
    session.vrfRequestId = 0;
    activeSessions--;

    emit SessionExpired(player, returnedAmount);
}
```

Using a single function ensures the reserve return, `totalReserved` decrement, `pendingVRFRequests` decrement, and bet cleanup are never accidentally omitted in any expiry path.

---

## Chainlink VRF Integration

### BASE-Specific Configuration

| Parameter | BASE Sepolia | BASE Mainnet |
|---|---|---|
| VRF Coordinator | See Chainlink docs for current address | See Chainlink docs for current address |
| Key Hash | Use 150 gwei lane | Use appropriate gas lane |
| Subscription | Fund with LINK on BASE | Fund with LINK on BASE |
| Confirmations | 3 blocks (~6 seconds) | 3 blocks (~6 seconds) |
| Callback Gas Limit | See gas budget below | See gas budget below |

### VRF Request Flow

1. Player places bets during `COME_OUT` / `POINT` phase
2. Player calls `rollDice()` — only the session owner can roll their own session
3. Contract computes `maxPossiblePayout(session)` and reserves that from bankroll
4. Contract calls `requestRandomWords()` → session phase becomes `ROLL_PENDING`
5. Chainlink VRF callback fires `fulfillRandomWords(requestId, randomWords)`
6. Contract derives two dice values: `die1 = (random % 6) + 1`, `die2 = (random / 6 % 6) + 1`
7. All active bets **for that player's session only** are resolved in the callback
8. Unused reserve is returned to bankroll
9. Session phase updates based on result (back to `COME_OUT` or `POINT`)
10. Player can place new bets and roll again at their own pace

### Callback Gas Budget

Since each VRF callback resolves only a **single player's session**, the gas budget is much more predictable:

| Operation | Estimated Gas |
|---|---|
| Base callback overhead | ~50,000 |
| Pass/Don't Pass resolution | ~30,000 |
| Per Come bet resolution (max 4) | ~35,000 each |
| Per Place bet resolution (max 6) | ~20,000 each |
| Per one-roll/prop bet resolution (7 slots) | ~15,000 each |
| Session state update | ~25,000 |
| Reserve release | ~10,000 |

**Worst case per player: ~50k + 30k + (4 × 35k) + (6 × 20k) + (7 × 15k) + 25k + 10k = ~480,000 gas.** Set `callbackGasLimit` to 500,000 with headroom. On BASE, this costs a fraction of a cent.

**Critical:** This gas estimate must be validated with a concrete worst-case test early in Phase 1 where every bet slot is populated. The fixed-size struct eliminates dynamic array management costs, but actual SSTORE/SLOAD costs for zeroing resolved bet slots should be measured, not estimated.

**Enforced limits per session:**
- Max 4 Come bets
- Max 6 Place bets (all six numbers)
- 7 one-roll/proposition bet slots (field, any7, anyCraps, yo, hiLo, aces, boxcars — all available simultaneously)

Note: Multiple players can have `ROLL_PENDING` sessions simultaneously — each gets their own independent VRF request and callback. This is more VRF calls than a shared table, but on BASE the cost is negligible and the UX benefit (no waiting for other players) is significant.

### VRF Non-Response Handling

There is no `cancelRoll` mechanism. If the VRF callback does not arrive, the session remains in `ROLL_PENDING` until the 24-hour session expiry fires. Session expiry can fire during `ROLL_PENDING` — it cleans up the `requestToPlayer` mapping, returns `_reserved` to bankroll, returns `_inPlay` to `_available`, and resets the session.

If the VRF callback eventually arrives after the session has been expired, it finds `address(0)` in the `requestToPlayer` mapping and silently returns (no revert, no state changes).

**Rationale:** Chainlink VRF on BASE is highly reliable (~6 second resolution). A non-response lasting more than a few minutes would indicate a serious infrastructure failure. The 24-hour expiry provides a safe recovery path without introducing race conditions between a `cancelRoll` function and a late-arriving callback. The `pendingVRFRequests` counter and `check-pending.ts` script let the operator monitor for stuck requests and pause if necessary.

### Callback Safety — No Reverts

The `fulfillRandomWords` callback must **never revert**. A reverting callback wastes the VRF fee and permanently bricks the session in `ROLL_PENDING`.

```solidity
function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
    address player = requestToPlayer[requestId];
    if (player == address(0)) {
        return; // Already expired — silent no-op
    }
    delete requestToPlayer[requestId];
    pendingVRFRequests--;

    // ... resolve bets, release _reserved
    // ALL logic below this point must be guaranteed not to revert
}
```

Every operation within the callback must use soft failures. No `require` statements, no unchecked arithmetic that could underflow, no external calls that could revert. All bet resolution is internal accounting (moving values between buckets) with no token transfers.

### Pending Request Tracking

```solidity
uint256 public pendingVRFRequests;
uint256 public activeSessions; // observability counter only — does not gate anything
uint256 public totalReserved;  // running sum of all _reserved[player] values
mapping(uint256 => address) public requestToPlayer; // requestId → player address

function rollDice() external whenNotPaused notExcluded {
    Session storage session = sessions[msg.sender];
    require(session.phase != SessionPhase.ROLL_PENDING, "Roll already pending");
    // ... validate player has active bets

    uint256 worstCase = PayoutMath.maxPossiblePayout(session);
    require(bankroll >= worstCase, "Insufficient bankroll");
    bankroll -= worstCase;
    _reserved[msg.sender] = worstCase;
    totalReserved += worstCase;

    uint256 requestId = vrfCoordinator.requestRandomWords(...);
    requestToPlayer[requestId] = msg.sender;
    session.vrfRequestId = requestId;
    session.phase = SessionPhase.ROLL_PENDING;
    pendingVRFRequests++;
}

function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
    address player = requestToPlayer[requestId];
    if (player == address(0)) {
        return; // Already expired — silent no-op
    }
    delete requestToPlayer[requestId];
    pendingVRFRequests--;

    // ... resolve all bets for this player's session
    // ... release unused reserve back to bankroll, decrement totalReserved
}
```

The `activeSessions` counter is incremented when a session transitions from `INACTIVE` and decremented on session expiry or when a player's session returns to `INACTIVE`. It is used only for event emission and operator monitoring — never in a `require` check.

The `pendingVRFRequests` counter is what `withdrawBankroll` checks — the owner cannot pull bankroll while any player's dice are in the air.

### Getting Testnet LINK on BASE Sepolia

1. Get Sepolia ETH from a faucet (Alchemy, Infura, or Coinbase faucets)
2. Get LINK on Sepolia from Chainlink's faucet: https://faucets.chain.link
3. Bridge LINK to BASE Sepolia (or use Chainlink's BASE Sepolia faucet if available)
4. Create a VRF subscription at https://vrf.chain.link (select BASE Sepolia)
5. Fund the subscription with LINK
6. Add the deployed CrapsGame contract address as a consumer
7. Or use `scripts/fund-vrf.ts` to automate steps 5-6

### VRF Subscription Monitoring

If the LINK subscription balance runs dry, `requestRandomWords()` reverts, which means `rollDice()` reverts. Players with active bets on the table cannot roll. The operator must monitor LINK balance proactively.

`scripts/check-link-balance.ts` queries the VRF subscription balance and warns if it falls below a configurable threshold (recommended: enough LINK for ~100 rolls). This script should be run on a cron or monitoring service alongside `check-pending.ts`.

The frontend cannot read LINK balance directly, but it can detect the symptom: if `rollDice()` transactions fail repeatedly with a VRF-related revert, the frontend should show "Table temporarily unavailable — please try again later" rather than a raw error.

---

## PayoutMath Library (`PayoutMath.sol`)

All payout calculations are isolated in a pure library. No floating point — all math uses integer ratios.

```solidity
library PayoutMath {
    /// @notice Calculate payout for a winning bet
    /// @return payout The winnings (not including original bet)
    function calculate(BetType betType, uint256 amount, uint8 point)
        internal pure returns (uint256 payout);

    /// @notice Calculate the exact worst-case house payout for a session's active bets
    /// @return maxPayout The maximum winnings the house could owe across all 15 dice outcomes
    function maxPossiblePayout(Session storage session)
        internal view returns (uint256 maxPayout);
}
```

Key implementation details:

- Place 6/8 pays 7:6 → `payout = amount * 7 / 6` (amounts must be multiples of 6, enforced at bet placement)
- Place 5/9 pays 7:5 → `payout = amount * 7 / 5` (multiples of 5)
- Place 4/10 pays 9:5 → `payout = amount * 9 / 5` (multiples of 5)
- Odds payouts use integer ratios (e.g., 2:1 → `amount * 2`, 3:2 → `amount * 3 / 2`)
- Bet amounts for fractional payouts are validated to be exact multiples at placement time (no rounding, no dust)

Comprehensive unit tests in `PayoutMath.test.ts` covering every bet type, every point number, edge cases with max bet amounts, verification that no rounding errors accumulate, and validation that `maxPossiblePayout` returns correct values for every combination of active bets.

---

## Bankroll Sizing

### Table Parameters

- Table minimum: $5 (or $6 for bets requiring multiples of 6)
- Table maximum: $500 (line/place/field), $100 (props/hardways)
- Max odds: 3x
- Recommended initial bankroll: $100,000 (in token units). Soft launch at $50,000 acceptable.

### Worst-Case Payout Per Session Per Roll

The reserve-on-roll system computes the exact worst case per session dynamically based on the player's active bets. The following scenarios illustrate the theoretical maximums for bankroll planning purposes.

**Scenario A — Come-out roll of 2 (puck OFF, all available bets maxed):**

| Bet | Amount | Payout Ratio | House Pays |
|---|---|---|---|
| Don't Pass | $500 | 1:1 | $500 |
| Field | $500 | 2:1 (on a 2) | $1,000 |
| Any Craps | $100 | 7:1 | $700 |
| Aces (2) | $100 | 30:1 | $3,000 |
| Hi-Lo (2 or 12) | $100 | 15:1 | $1,500 |
| **Total** | | | **$6,700** |

(Pass Line loses $500 → net house exposure $6,200, but we size bankroll against gross payouts.)

**Scenario B — Come-out roll of 12 (puck OFF):**

| Bet | Amount | Payout Ratio | House Pays |
|---|---|---|---|
| Field | $500 | 3:1 (on a 12) | $1,500 |
| Any Craps | $100 | 7:1 | $700 |
| Boxcars (12) | $100 | 30:1 | $3,000 |
| Hi-Lo (2 or 12) | $100 | 15:1 | $1,500 |
| **Total** | | | **$6,700** |

(Don't Pass pushes on 12, Pass loses.)

**Scenario C — Point phase, hard 4 rolled on point of 4, with 4 Come bets all on 4 (TRUE WORST CASE):**

This scenario requires a specific setup: the player established Come bets on the point of 4 during a previous round, the main point then cycled to 4, and the player maxed all positions. While astronomically unlikely, it is reachable and the reserve system must cover it.

| Bet | Amount | Payout Ratio | House Pays |
|---|---|---|---|
| Pass Line | $500 | 1:1 | $500 |
| Pass Odds (3x) | $1,500 | 2:1 | $3,000 |
| Come #1 on 4 | $500 | 1:1 | $500 |
| Come #1 Odds (3x) | $1,500 | 2:1 | $3,000 |
| Come #2 on 4 | $500 | 1:1 | $500 |
| Come #2 Odds (3x) | $1,500 | 2:1 | $3,000 |
| Come #3 on 4 | $500 | 1:1 | $500 |
| Come #3 Odds (3x) | $1,500 | 2:1 | $3,000 |
| Come #4 on 4 | $500 | 1:1 | $500 |
| Come #4 Odds (3x) | $1,500 | 2:1 | $3,000 |
| Place 4 | $500 | 9:5 | $900 |
| Hardway 4 | $100 | 7:1 | $700 |
| Field | $500 | 1:1 (4 is a field number) | $500 |
| **Total** | | | **$19,600** |

**Theoretical worst case per session: $19,600** (Scenario C).

**Why this matters:** The previous estimate of $6,700 only considered come-out scenarios and missed Come bet compounding during the point phase. The reserve-on-roll system handles this correctly regardless — `maxPossiblePayout` computes the exact number — but operator bankroll guidance must account for it.

**Realistic exposure levels:** The $19,600 worst case requires a very specific sequence of rolls and max bets on every position. In practice:
- A casual player (Pass + small odds): ~$500–$1,500 reserve
- A heavy bettor (Pass + max odds + 1-2 Come bets + Place bets): ~$5,000–$10,000 reserve
- A max-everything player (all positions filled): ~$15,000–$19,600 reserve

### Capacity Model — Self-Regulating via Reserves

With the reserve-on-roll system, there is no fixed `maxActiveSessions` cap. Capacity is self-regulating:

- When a player calls `rollDice()`, the contract reserves the exact worst-case payout from the bankroll
- If `bankroll < maxPossiblePayout(session)`, the roll is rejected with "Insufficient bankroll"
- As more sessions enter `ROLL_PENDING`, more bankroll is reserved, leaving less for new rolls
- As callbacks resolve, unused reserves return to the bankroll, freeing capacity

This is more capital-efficient than a fixed session cap because it reserves based on actual bet exposure, not theoretical maximums. A session with only a $5 Pass Line bet reserves far less than the $19,600 theoretical worst case.

**Approximate capacity with $100,000 bankroll:**

| Player Profile | Typical Reserve | Concurrent Rolls Supported |
|---|---|---|
| Max exposure (all positions filled) | ~$19,600 | 5 |
| Heavy bettor (Pass + odds + Come bets + Place) | ~$8,000 | 12 |
| Moderate player (Pass + odds + a few Place bets) | ~$3,000 | 33 |
| Casual player (Pass + small odds) | ~$1,000 | 100 |

In practice, most sessions will be casual-to-moderate, and not all sessions roll simultaneously, so effective capacity will be much higher than the max-exposure number suggests.

**Recommended initial bankroll: $100,000.** This provides comfortable headroom for a mix of player profiles. A soft launch can start at $50,000 and scale up based on observed demand — the operator calls `depositBankroll()` at any time to increase capacity without redeployment.

### Bankroll Health Thresholds

The contract emits events when the **total bankroll** (reserved + unreserved) crosses these thresholds, measured against `initialBankroll` stored at deployment:

| Threshold | Action |
|---|---|
| bankroll + totalReserved < 50% of initial | `BankrollWarning` event — operator should monitor closely |
| bankroll + totalReserved < 25% of initial | `BankrollCritical` event — operator should top up or pause |
| bankroll + totalReserved < 10% of initial | Auto-pause new session creation (existing sessions can finish) |

The `initialBankroll` parameter is set in the Hardhat Ignition module so the owner funds the bankroll atomically with deployment.

**Bankroll shrinks → capacity shrinks.** If the bankroll drops (players winning), less is available for reserves. Existing `ROLL_PENDING` sessions are unaffected (their reserves are already committed), but new rolls may be rejected until the bankroll recovers or is topped up.

---

## Frontend State: `getPlayerState` View Function

A single view function that returns everything the frontend needs after any contract interaction, eliminating multiple RPC calls:

```solidity
struct PlayerState {
    // Session
    SessionPhase phase;
    uint8 point;
    uint256 lastActivityTime;

    // Balances
    uint256 available;
    uint256 inPlay;

    // All bet slots
    Bet passLine;
    Bet dontPass;
    ComeBet[4] comeBets;
    PlaceBet[6] placeBets;
    HardwayBet[4] hardways;
    OneRollBets oneRolls;

    // Exclusion status
    bool selfExcluded;
    bool operatorExcluded;
    uint256 reinstatementEligibleAt;  // 0 if no pending reinstatement

    // House context
    uint256 bankroll;           // unreserved bankroll available for new rolls
    uint256 totalBankroll;      // reserved + unreserved (health indicator)
    uint256 initialBankroll;
    bool paused;
}

function getPlayerState(address player) external view returns (PlayerState memory);
```

**Design notes:**

- `bankroll` and `totalBankroll` are global state, not per-player, but including them saves a separate RPC call and lets the frontend show bankroll health and whether a roll is likely to succeed.
- `reinstatementEligibleAt` is computed as `reinstatementRequestTime + REINSTATEMENT_DELAY` if a request is pending, otherwise 0. Saves the frontend from doing that math.
- `phase == ROLL_PENDING` tells the frontend a roll is in flight — no need for `vrfRequestId` in this struct.
- Last dice result is **not** included. The frontend gets dice values from the `DiceRolled` event, which it already listens for to trigger roll animations. Storing `lastDie1`/`lastDie2` in the session would add an unnecessary SSTORE in the callback.
- The frontend calls this function after every transaction confirmation and after receiving a `DiceRolled` / `BetResolved` event to refresh the full UI state.

---

## Event Indexing Strategy

All events use indexed parameters for efficient log filtering. Solidity allows up to three indexed parameters per event.

### Player-Scoped Events

`player` is always the first indexed parameter:

```solidity
event Deposit(address indexed player, uint256 amount, uint256 fee);
event Withdrawal(address indexed player, uint256 amount);
event BetPlaced(address indexed player, BetType indexed betType, uint256 amount);
event DiceRolled(address indexed player, uint256 indexed requestId, uint8 die1, uint8 die2);
event BetResolved(address indexed player, BetType indexed betType, bool won, uint256 payout);
event SessionStarted(address indexed player);
event SessionExpired(address indexed player, uint256 returnedAmount);
event SelfExcluded(address indexed player);
event ReinstatementRequested(address indexed player, uint256 eligibleAt);
event ReinstatementCompleted(address indexed player);
event OperatorExcluded(address indexed player);
event OperatorReinstated(address indexed player);
```

`BetPlaced` and `BetResolved` index `betType` so the frontend can filter for specific bet activity (e.g., all Place 6 results). `DiceRolled` indexes `requestId` to correlate VRF requests to results.

`BetResolved` fires once per active bet during the callback. The frontend reconstructs a full roll outcome by collecting all `BetResolved` events with the same block number and player address.

### Operator/System Events

Global events with no player index:

```solidity
event BankrollDeposited(uint256 amount, uint256 newBankroll);
event BankrollWithdrawn(uint256 amount, uint256 newBankroll);
event FeesWithdrawn(uint256 amount);
event BankrollWarning(uint256 currentBankroll, uint256 threshold);
event BankrollCritical(uint256 currentBankroll, uint256 threshold);
event BankrollAutoPaused(uint256 currentBankroll);
```

---

## Implementation Phases

### Phase 1 — Core Contracts (Week 1-2)

1. `PayoutMath.sol` — implement and fully test all payout calculations + `maxPossiblePayout`
2. `CrapsGame.sol` — single contract with vault logic (deposit, withdraw, fee, five-bucket invariant, reserve mechanics), per-player session with fixed-size bet structs, four-phase state machine (INACTIVE/COME_OUT/POINT/ROLL_PENDING), pass line and don't pass only (simplest state machine)
3. Mock VRF coordinator for local testing
4. Validate callback gas with worst-case concrete test (all bet slots populated)
5. **Gate:** Slither runs clean, all unit tests pass, invariant holds across 100+ fuzz runs, gas within 500k budget

### Phase 2 — Full Bet Types + Game Logic (Week 3-4)

1. All explicit bet placement functions (see Bet Placement Functions) with per-function validation
2. All explicit bet removal functions with lock enforcement (Pass Line/Come non-removable)
3. Bet stacking logic (additive for odds/place/hardway/one-roll; reject-if-occupied for pass/don't pass; next-slot for come/don't come)
4. Puck ON/OFF bet availability enforcement (see Bet Availability by Puck State)
5. Payout multiples validation at bet placement (see Payout Multiples Validation table)
6. Place bet ON/OFF toggle mechanic
7. Come / Don't Come with sub-state machines (per-session, max 4 slots)
8. Odds bets (3x max) for Pass, Don't Pass, Come, Don't Come
9. Place bets (4, 5, 6, 8, 9, 10) with tiered limits
10. One-roll bets (Field, Any 7, Any Craps, Yo, Hi-Lo, Aces, Boxcars) with $100 prop cap
11. Hardways with $100 cap, full resolution logic (win on pair, lose on easy way or 7)
12. Session timeout / expiry mechanic (24h), including expiry during ROLL_PENDING, shared `_expireSession()` path
13. Self-exclusion + operator exclusion (both using `_expireSession()`)
14. Bankroll health thresholds and auto-pause at 10%
15. **Gate:** Integration tests covering full sessions with all bet types, puck state transitions, session expiry (including during ROLL_PENDING), exclusion flows, reserve/release across concurrent sessions. All 8 complex resolution scenario tests passing (see Required Integration Tests for Complex Scenarios)

### Phase 3 — VRF Integration + Testnet (Week 5-6)

1. Replace mock VRF with Chainlink VRF v2.5 on BASE Sepolia
2. Verify callback soft-return on expired sessions (address(0) case)
3. Deploy to BASE Sepolia via Hardhat Ignition
4. Fund VRF subscription with testnet LINK
5. Verify on Basescan
6. End-to-end testing on testnet with real VRF
7. **Gate:** 50+ successful rolls on testnet, gas profiling within budget, expired-session callback tested

### Phase 4 — Hardening + Audit Prep (Week 7-8)

1. Slither analysis — resolve all findings
2. Fuzz testing with Foundry (or Hardhat + custom fuzzer) on bet resolution paths
3. Formal verification of `PayoutMath` calculations (optional but recommended)
4. Access control review — every external/public function audited for authorization
5. Five-bucket invariant fuzz testing — verify invariant holds across randomized sequences of deposits, bets, rolls, expiries, and exclusions
6. Emergency procedures documented: pause, cancel pending rolls, drain sequence
7. Gas optimization pass — storage packing, minimize SSTOREs in callback
8. **Gate:** Clean Slither report, fuzz tests pass 10,000+ runs, gas report acceptable

### Phase 5 — BASE Mainnet Deployment (Week 9)

1. Deploy to BASE mainnet via Hardhat Ignition with `initialBankroll = 100,000 USDC` (or $50,000 for soft launch)
2. Constructor params: `token = USDC`, `tokenDecimals = 6`, `minBet = 5`, `maxBetLine = 500`, `maxBetProp = 100`, `maxOdds = 3`, `sessionTimeout = 86400`
3. Fund VRF subscription with real LINK on BASE
4. Verify on Basescan
5. Monitor bankroll, gas usage, VRF response times for first 48 hours
6. To scale capacity, operator calls `depositBankroll()` — more bankroll = more reserve headroom for concurrent rolls

---

## Frontend Requirements

### Tech Stack

| Tool | Purpose |
|---|---|
| **React** (Vite) | SPA framework |
| **wagmi v2** | React hooks for wallet connection, contract reads/writes, event listening |
| **viem v2** | Low-level EVM interaction, ABI encoding, event log parsing |
| **TypeScript** | Type safety across the frontend |
| **TailwindCSS** | Styling |

### Design Philosophy

The frontend replicates the feel of a physical bubble craps machine — a single-player, self-paced experience. The design is hybrid: felt-inspired layout with clean, modern aesthetics. Not a skeuomorphic replica of a casino table, but clearly recognizable as a craps betting surface with the spatial relationships between bet positions preserved.

The player controls the pace entirely. No countdown timers, no pressure. Place bets, review, hit Roll, watch the dice, adjust, repeat.

### Device Support

Full mobile parity via forced landscape orientation. On narrow-width devices (phones, small tablets), the app detects viewport width and displays a full-screen prompt instructing the user to rotate their device to landscape before the game UI renders. The game UI itself is designed landscape-first for all breakpoints.

```
if viewport width < threshold:
    show full-screen overlay: "Rotate your device to landscape to play"
    block game interaction until landscape detected
```

Desktop and landscape tablets render the full UI without prompting.

### State Management

**Primary state source:** `getPlayerState(address)` view function. Called after every transaction confirmation and after receiving relevant events. Returns the complete player state in a single RPC call.

**Event-driven updates:** The frontend subscribes to contract events filtered by the connected player's address. Key subscriptions:

| Event | Frontend Reaction |
|---|---|
| `DiceRolled` | Trigger dice animation with die1/die2 values, then call `getPlayerState` to refresh |
| `BetResolved` | Collect all BetResolved events in the same block, display win/loss summary per bet |
| `SessionExpired` | Show expiry notification, refresh state |
| `BankrollWarning` / `BankrollCritical` | Update bankroll health indicator |
| `BankrollAutoPaused` | Show "Table temporarily closed" messaging |

**State refresh strategy:** Call `getPlayerState` after: wallet connection, any write transaction confirmation, any relevant event received, and on a slow poll interval (~30s) as a fallback for missed events.

**In-memory roll history:** Each `DiceRolled` event during the current session is appended to an in-memory array. Includes die1, die2, sum, and the associated `BetResolved` outcomes. Cleared when the session goes INACTIVE.

**Persistent roll history:** A separate history page queries `DiceRolled` and `BetResolved` event logs for the connected address. Paginated, loaded on demand. Survives page refresh and session boundaries.

### Wallet Connection Flow

1. Player connects wallet (wagmi connectors — MetaMask, Coinbase Wallet, WalletConnect)
2. Frontend checks chain ID — if not BASE (8453) or BASE Sepolia (84532), prompt to switch network
3. On successful connection, call `getPlayerState(address)` to hydrate UI
4. If player has an active session (phase != INACTIVE), restore the full game state immediately
5. If player is excluded (`selfExcluded` or `operatorExcluded` in PlayerState), show exclusion screen with withdrawal option

### Deposit & Withdrawal

**Deposit flow:**

1. Player enters deposit amount
2. Frontend displays fee breakdown BEFORE transaction: "You deposit 1,000 USDC → 995 USDC available to play (5 USDC fee)"
3. Check USDC allowance — if insufficient, prompt approval transaction first
4. Submit `deposit(amount)` transaction
5. On confirmation, refresh state via `getPlayerState`

**Withdrawal flow:**

1. Player enters withdrawal amount (max = `available` from PlayerState)
2. "Withdraw All" shortcut button
3. Submit `withdraw(amount)` transaction
4. On confirmation, refresh state

**Display:** Show `available` and `inPlay` balances at all times in a persistent header/banner. Format as USDC with 2 decimal places (divide raw uint256 by 10^6).

### Betting Surface Layout

The betting surface is a hybrid felt-inspired layout. Bet positions are arranged spatially to match a real craps table, but rendered with clean modern UI — crisp borders, readable typography, subtle color coding by bet category.

**Layout regions (landscape orientation):**

```
┌─────────────────────────────────────────────────────────────┐
│  [PASS LINE]                                                │
│  [DON'T PASS]                                               │
├──────┬──────┬──────┬──────┬──────┬──────┬───────────────────┤
│  P4  │  P5  │  P6  │  P8  │  P9  │  P10 │   [COME]         │
│      │      │      │      │      │      │   [DON'T COME]    │
├──────┴──────┴──────┴──────┴──────┴──────┤                   │
│  [FIELD]                                 │                   │
├──────┬──────┬──────┬──────┬─────────────┤───────────────────┤
│  H4  │  H6  │  H8  │  H10 │             │  [ONE-ROLL BETS]  │
│      │      │      │      │             │  Any 7 | Craps    │
│      │      │      │      │             │  Yo | Hi-Lo       │
│      │      │      │      │             │  Aces | Boxcars   │
└──────┴──────┴──────┴──────┴─────────────┴───────────────────┘
```

This is a conceptual layout — the actual spatial arrangement and proportions should be refined during design implementation.

**Bet position states:**

| State | Visual Treatment |
|---|---|
| Available (can be placed) | Full color, interactive, clickable |
| Unavailable (wrong puck state) | Dimmed, non-interactive, tooltip explaining why |
| Active bet placed | Highlighted with bet amount displayed as chip on the position |
| Locked bet (Pass/Come, non-removable) | Active + lock icon, no remove option |
| Place bet toggled OFF | Active but muted/translucent, toggle switch visible |
| ROLL_PENDING | All positions non-interactive, subtle pulsing or "waiting" overlay |

### Puck Display

A prominent puck indicator showing ON/OFF state and the established point number:

- **Puck OFF:** Displayed near the pass line area. "OFF" label, dark/black color
- **Puck ON:** Displayed on the point number's Place bet position. "ON" label with the point number, bright/white color
- The puck should be one of the most visually prominent elements — the player needs to know at a glance what phase they're in

### Bet Placement Interaction

1. Player taps/clicks a bet position on the surface
2. A bet amount input appears (modal, popover, or inline — design choice)
3. Input defaults to the table minimum for that bet type
4. Input enforces constraints in real-time:
   - Minimum and maximum for the bet type
   - Required multiples (e.g., Place 6/8 in multiples of $6) — snap to nearest valid amount or show stepper
   - For odds bets, 3x cap relative to the parent flat bet
   - For additive bets (pressing an existing bet), show current amount and validate NEW TOTAL
5. "Place Bet" confirmation button submits the `placeBet()` transaction
6. On confirmation, refresh state — the chip appears on the surface

**Bet amount helpers:**
- Quick-select buttons: Min, $25, $50, $100, $500, Max
- For odds: "Max Odds" button that computes the largest valid amount (≤ 3x flat bet, satisfying multiples)
- Stepper (+/−) for adjusting amounts in valid increments

**Validation messages (shown inline, not as alerts):**
- "Place 6 must be in multiples of $6"
- "Odds on point 5 must be an even amount"
- "Maximum for proposition bets is $100"
- "Insufficient balance — you have $X available"
- "Maximum odds: 3× your $Y pass line = $Z"

### Bet Removal Interaction

Removable bets show a "Remove" or "×" button on their chip when tapped/hovered:

- **Don't Pass / Don't Come:** Removable. Show confirmation: "Remove Don't Pass? This bet favors you — are you sure?"
- **All Odds bets:** Removable, no warning needed
- **Place bets:** Show both "Remove" (returns funds) and "Toggle OFF" (stays on felt, doesn't resolve on non-7 rolls)
- **Hardways:** Removable, no warning needed
- **One-roll bets:** Removable if the player hasn't rolled yet
- **Pass Line / Come:** No remove option shown. If tapped, tooltip: "Pass Line bets cannot be removed"

All removal UI is disabled during ROLL_PENDING.

### Place Bet Toggle

Place bets have an ON/OFF toggle visible on each Place position:

- Toggle switch or ON/OFF indicator on each Place bet chip
- When OFF, the chip appears muted/translucent
- Toggling does NOT move funds — the bet stays in `_inPlay`
- Tooltip on OFF state: "This bet won't pay on its number, but will still be lost on a 7"
- The toggle interaction calls a contract function (or batches toggle state for the next roll — design choice depending on whether toggles are on-chain or tracked off-chain until roll)

### Roll Flow

1. Player has at least one active bet and is not in ROLL_PENDING
2. "ROLL" button is prominent and centered — the primary action
3. Player presses Roll
4. Frontend submits `rollDice()` transaction
5. **If rejected (insufficient bankroll):** Show "Table is at capacity, please try again shortly" — NOT an error, frame it as temporary congestion
6. **If rejected (session expired):** Show expiry message, refresh state
7. **On transaction confirmation:** UI enters ROLL_PENDING state:
   - Roll button disabled, replaced with animated "Rolling..." indicator
   - All bet positions become non-interactive
   - Dice animation begins (anticipation phase)
8. **On `DiceRolled` event received:**
   - Dice animation resolves to show die1 and die2 values
   - Brief pause (~1-2 seconds) for the player to see the roll
9. **On `BetResolved` events received (same block):**
   - Each bet position flashes green (win) or red (loss) with the payout/loss amount
   - Wins show "+$X" animation floating up from the bet position
   - Losses show the chip being swept
   - Pushes (Don't Pass/Don't Come on 12) show "Push" label — no animation, bet stays
10. **State refresh via `getPlayerState`:**
    - Balances update
    - Puck state updates (point established/cleared)
    - Bet positions update (cleared bets disappear, surviving bets remain)
    - Betting surface re-enables for the new phase

**Roll result summary:** After each roll, display a brief summary banner: "Rolled 6 (3+3) — Hard 6! Pass Line wins, Hardway 6 wins!" This helps the player understand what happened, especially when multiple bets resolve simultaneously.

### Session Timer

- Countdown timer showing time remaining until 24-hour session expiry
- Positioned in the header/status area, not intrusive during normal play
- **Warning at 1 hour remaining:** Timer turns yellow, subtle pulse
- **Warning at 15 minutes remaining:** Timer turns red, more prominent notification: "Your session expires in 15 minutes. Roll to extend."
- **On expiry:** Full-screen notification: "Session expired — your bets have been returned to your balance. You can withdraw or start a new session."
- Any successful roll resets the 24h timer — the frontend should reflect the new `lastActivityTime` from `getPlayerState`

### Bankroll Health Indicator

An optional trust-building element showing the house's financial health:

- Small indicator in the UI header (not prominent, but accessible)
- Shows `totalBankroll / initialBankroll` as a percentage or color bar
- Green (>50%), Yellow (25-50%), Red (<25%)
- If auto-paused (<10%), show "Table temporarily closed — please try again later"
- Helps players feel confident the house can pay their wins

### Self-Exclusion UI

- "Take a Break" button accessible from the player menu/settings (not hidden, but not on the main betting surface)
- Tapping opens a confirmation screen explaining:
  - "Self-exclusion is immediate — your active session will end and bets will be returned"
  - "You can withdraw your balance at any time while excluded"
  - "To return, you must request reinstatement and wait 7 days"
- After confirming, the UI transitions to an exclusion screen:
  - Shows `available` balance with prominent "Withdraw" button
  - Shows exclusion status and "Request Reinstatement" button
  - After requesting, shows countdown: "You can return in 6 days, 23 hours"
  - After countdown completes, shows "Complete Reinstatement" button
- Operator exclusion shows the same withdrawal-only UI but without reinstatement option: "Your account has been restricted. You can withdraw your balance."

### Error Handling

All contract interaction errors should be caught and displayed as user-friendly messages:

| Error | User-Facing Message |
|---|---|
| Transaction rejected by user | "Transaction cancelled" |
| Insufficient USDC balance | "Insufficient USDC balance. You need $X to deposit" |
| Insufficient available balance | "Not enough available balance. You have $X" |
| Bet type unavailable in current phase | "This bet can't be placed right now — [reason]" |
| Bet amount invalid (multiples) | "[Specific validation message per bet type]" |
| Insufficient bankroll for roll | "Table is at capacity. Try again shortly" |
| Session expired | "Your session has expired. Bets have been returned" |
| Player excluded | "Your account is currently excluded from play" |
| Network error / RPC failure | "Connection issue — retrying..." with automatic retry |
| Wrong network | "Please switch to BASE network to play" |

Never show raw Solidity revert strings or hex error codes to the player.

### Roll History

**Live session history (in-memory):**

- Side panel or collapsible drawer showing the current session's rolls
- Each entry: roll number, die1 + die2 = sum, hard/easy indicator, list of bet outcomes (won/lost/push with amounts)
- Most recent roll at top
- Cleared when session goes INACTIVE

**Full history page (persistent, from event logs):**

- Separate page/route accessible from navigation
- Queries `DiceRolled` and `BetResolved` events for the connected address
- Paginated, loaded on demand (most recent first)
- Each entry shows: timestamp, die values, all bet outcomes, net result for that roll
- Session boundaries marked (session start/end indicators)
- Running totals: total wagered, total won, total lost, net result
- Date range filters

### Contract Migration

When a new contract version is deployed and the old contract is paused:

- Prominent banner at top of screen: "A new version of Craps is available. Please withdraw your balance and visit [link to new deployment]"
- The banner should be visually distinct — not dismissable until the player has withdrawn
- The old contract remains functional for withdrawals indefinitely
- The betting surface is disabled (paused contract rejects bets/rolls)
- Only the withdrawal flow and balance display are active

**Detection:** The frontend checks the `paused` flag from `getPlayerState`. If paused, it renders the migration banner. The link to the new contract can be configured via environment variable or an on-chain registry (design choice for deployment).

### Screen Layout Overview (Landscape)

```
┌─────────────────────────────────────────────────────────────────┐
│ [Logo]  Available: $995.00  |  In Play: $505.00  |  ⏱ 23:45:12 │
│ [Wallet: 0x1234...5678]    |  Bankroll: ██████░░ 72%  | [Menu] │
├───────────────────────────────────────────────┬─────────────────┤
│                                               │                 │
│           BETTING SURFACE                     │  ROLL HISTORY   │
│       (felt-inspired layout with              │  (collapsible   │
│        all bet positions)                     │   side panel)   │
│                                               │                 │
│                                               │  #12: 8 (4+4)  │
│    [PUCK: ON 6]                               │  Hard 8! +$900  │
│                                               │                 │
│                                               │  #11: 5 (2+3)  │
│                                               │  No winners     │
│                                               │                 │
├───────────────────────────────────────────────┤  #10: 7 (3+4)  │
│                                               │  Seven out!     │
│         [ 🎲  ROLL  🎲 ]                      │  -$1,200        │
│                                               │                 │
└───────────────────────────────────────────────┴─────────────────┘
```

### Implementation Phases (Frontend)

**Phase F1 — Foundation (parallel with contract Phase 3):**
1. Vite + React + TypeScript + Tailwind project setup
2. wagmi v2 + viem v2 configuration for BASE / BASE Sepolia
3. Wallet connection flow with network switching
4. Contract ABI integration, `getPlayerState` hook
5. Deposit/withdrawal flow with fee display
6. Basic state display (balances, session phase, puck state)
7. Landscape orientation enforcement for mobile

**Phase F2 — Betting Surface:**
1. Felt-inspired betting surface layout
2. All bet positions rendered with correct spatial arrangement
3. Bet placement interaction (tap → amount input → confirm)
4. Puck state enforcement (dim unavailable bets)
5. Bet amount validation with all multiples/limits
6. Bet removal interaction for removable bet types
7. Place bet ON/OFF toggle
8. Bet stacking (pressing) for additive bet types

**Phase F3 — Roll Experience:**
1. Roll button with ROLL_PENDING state management
2. Dice animation (anticipation → result)
3. Event subscription (DiceRolled, BetResolved)
4. Bet resolution animations (win/loss/push per position)
5. Roll result summary banner
6. In-memory roll history panel
7. State refresh orchestration (event-driven + polling fallback)

**Phase F4 — Edge Cases & Polish:**
1. Session timer with warnings at 1h and 15m
2. Session expiry handling and messaging
3. Self-exclusion flow (exclude → withdraw → reinstatement countdown → complete)
4. Operator exclusion display
5. Bankroll health indicator
6. Insufficient bankroll handling ("table at capacity")
7. Error handling for all contract revert cases
8. Persistent roll history page with event log queries
9. Contract migration banner
10. Mobile landscape UX polish and testing

---

## Security Checklist (Pre-Deployment)

- [ ] Slither: zero high/medium findings
- [ ] All external functions have correct access control
- [ ] `ReentrancyGuard` on all functions that transfer tokens
- [ ] `Pausable` — owner can freeze all bet placement and roll requests
- [ ] `whenNotPaused` modifier applied to deposit, all bet placement functions, and rollDice
- [ ] `withdraw()` and `withdrawFees()` are NOT gated by pause (funds always recoverable)
- [ ] Five-bucket invariant holds in every test (`_available + _inPlay + _reserved + bankroll + accruedFees == token.balanceOf(vault)`)
- [ ] VRF callback cannot revert — soft return on `address(0)`, no `require` statements, no unchecked arithmetic
- [ ] No way for owner to access player `_available` or `_inPlay` funds
- [ ] `withdrawBankroll` requires `paused && pendingVRFRequests == 0`
- [ ] Token interactions use `SafeERC20`
- [ ] Bet amount validation prevents dust/rounding exploits (exact multiples enforced per bet type)
- [ ] Fixed-size bet structs keep callback gas within 500k budget
- [ ] Tiered bet limits enforced ($500 line/place/field, $100 props/hardways)
- [ ] Player can only call `rollDice()` on their own session
- [ ] One player's session cannot read/write another player's session
- [ ] Reserve-on-roll: `rollDice()` reserves exact worst-case payout from bankroll
- [ ] Reserve release: callback returns unused reserve to bankroll after resolution
- [ ] `rollDice()` fails gracefully when `bankroll < maxPossiblePayout(session)`
- [ ] Session expiry can fire during `ROLL_PENDING` (cleans up requestToPlayer, returns reserve)
- [ ] Late VRF callback after session expiry results in silent no-op (no revert, no double-decrement)
- [ ] Bet placement respects puck state (no Come/Odds when puck OFF, no Pass/Don't Pass when puck ON)
- [ ] Place bet ON/OFF toggle only affects resolution, not `_inPlay` accounting
- [ ] Session expiry returns all `_inPlay` to `_available` including Come bet bases and attached odds (no fund forfeiture)
- [ ] `lastActivityTime` set to `block.timestamp` on INACTIVE → COME_OUT transition and on every VRF callback resolution
- [ ] Self-exclusion blocks deposit, placeBet, rollDice but allows withdraw
- [ ] Self-exclusion expires active session immediately (bets returned)
- [ ] Reinstatement requires 7-day delay; re-excluding cancels pending reinstatement
- [ ] Operator exclusion works same as self-exclusion; operator reinstatement is immediate
- [ ] `notExcluded` modifier applied to deposit, all bet placement functions, and rollDice
- [ ] Bankroll health events fire at 50%, 25%, 10% thresholds (based on total bankroll: reserved + unreserved)
- [ ] Auto-pause on new sessions when total bankroll < 10% of initial
- [ ] Hardway resolution checks both die values (win on pair only, lose on easy way or any 7)
- [ ] `pendingVRFRequests` only decremented once per request (by callback or by expiry, never both)
- [ ] `totalReserved` tracks running sum accurately — incremented in `rollDice()`, decremented in callback and session expiry
- [ ] `totalReserved == sum of all _reserved[player]` verified in test invariant checks
- [ ] `activeSessions` counter is observability-only — never used in require checks
- [ ] No proxy, no `delegatecall`, no `selfdestruct` — fully immutable
- [ ] Events emitted for all state changes with proper indexed parameters (see Event Indexing Strategy)
- [ ] Constructor parameters verified on Basescan match intended values
- [ ] Seven-out sweeps ALL Place bets regardless of ON/OFF toggle state
- [ ] Come-out 7 kills Place bets and Hardways (not just seven-out during point phase)
- [ ] Callback iterates ALL bet slots on EVERY roll regardless of session phase
- [ ] Don't Pass push on 12: bet stays in `_inPlay`, slot not cleared, no funds move
- [ ] Don't Come push on 12: same behavior as Don't Pass push
- [ ] Pending Come bets and established Come bets resolve in opposite directions on 7
- [ ] Pass Line and Come bets are locked — removal functions do not exist for these types
- [ ] Bet stacking: Pass/Don't Pass reject on occupied slot; odds/place/hardway/one-roll are additive up to caps
- [ ] Additive bets validate NEW TOTAL (existing + added) against max and multiples
- [ ] All bet placement and removal blocked during `ROLL_PENDING`
- [ ] `selfExclude()`, `excludePlayer()`, and `expireSession()` all use shared `_expireSession()` internal function
- [ ] All 7 one-roll bet slots available simultaneously (no artificial cap)

---

## Resolved Decisions

1. **Session model:** Per-player isolated sessions (bubble craps style). Each player has their own independent state machine, point, and betting surface. No shared table coordination. Players roll at their own pace.

2. **Roller selection:** Only the session owner can call `rollDice()` for their own session. No coordination needed.

3. **Multi-session support:** A single CrapsGame contract manages all sessions via `mapping(address => Session)`. Different table limit tiers require deploying separate contract instances.

4. **Token support:** The contract accepts a single ERC-20 token specified as a constructor parameter. Each deployment is bound to one token. To support multiple stablecoins, deploy separate instances. This isolates blocklist/freeze risk across tokens without adding multi-token accounting complexity.

5. **Upgradeability — Immutable contracts.** No proxy pattern. The contracts are deployed as-is with no upgrade path. This is the right choice for a gambling contract where player trust is paramount — users can verify the exact code they're interacting with, and the operator cannot change payout logic after launch.

   **Post-launch bug fix strategy:**
   - Deploy a new, fixed contract instance alongside the old one
   - Pause the old contract (`pause()` → no new bets, no new sessions)
   - Wait for all pending VRF requests to resolve (`pendingVRFRequests == 0`)
   - Players withdraw from the old contract at their own pace (old contract remains functional for withdrawals indefinitely)
   - Operator withdraws bankroll from old contract (`withdrawBankroll`)
   - Operator funds bankroll on new contract, announces migration
   - Old contract stays on-chain forever — player funds are never trapped

   This is cleaner than a proxy because there's no governance risk, no storage collision risk, and players can independently verify they're opting into the new version. The migration cost (redeployment gas + VRF subscription setup) is trivial on BASE.

6. **Bankroll solvency: Reserve-on-roll.** When a player calls `rollDice()`, the contract computes the exact worst-case payout for that session's active bets (via `maxPossiblePayout`) and reserves that amount from the bankroll. The callback releases unused reserves back to the bankroll after resolution. This guarantees every pending callback can be paid. The five-bucket invariant (`_available + _inPlay + _reserved + bankroll + accruedFees == token.balanceOf(vault)`) holds at all times.

7. **No `maxActiveSessions` cap.** Capacity is self-regulating via the reserve system. If the bankroll cannot cover the reserve for a new roll, `rollDice()` fails with "Insufficient bankroll." The `activeSessions` counter is retained for observability and event logging only.

8. **No `cancelRoll`.** Stuck VRF requests are handled by the 24-hour session expiry, which can fire even during `ROLL_PENDING`. This eliminates race conditions between cancel and callback paths. Late VRF callbacks after expiry find `address(0)` and silently return.

9. **Callback safety.** `fulfillRandomWords` never reverts. It uses a soft return on `address(0)` (expired session case) and contains no `require` statements or external calls that could revert.

10. **Session timeout: 24 hours.** Inactive sessions expire after 24 hours. All bets returned to `_available`, player can withdraw at any time. Expiry can fire during `ROLL_PENDING` — reserve returned to bankroll, requestToPlayer mapping deleted.

11. **Bet availability:** All bets can be placed and toggled ON when the puck is off (come-out phase), matching a real bubble craps machine. Come/Don't Come and Odds bets unlock when the puck is on (point established). See Bet Availability by Puck State for full matrix.

12. **Payout multiples:** All bets with fractional payouts require exact multiples at placement time (e.g., Place 6/8 in multiples of 6, Don't Pass odds on 5/9 in multiples of 3). This eliminates rounding in PayoutMath entirely. Some effective minimums exceed the $5 table minimum (e.g., Place 6 minimum is $6).

13. **Fixed-size bet storage.** No dynamic arrays in the Session struct. All bet slots are fixed-size structs or fixed-length arrays. Empty bets are zero-amount entries. This makes gas consumption predictable and eliminates dynamic array management overhead.

14. **Responsible gambling.** Voluntary self-exclusion with 7-day reinstatement delay. Operator-imposed exclusion with immediate operator reinstatement. Both block deposits, bet placement, and rolls but never block withdrawals. Active sessions are expired immediately upon exclusion.

15. **All 7 one-roll bet slots available simultaneously.** No artificial cap on concurrent one-roll bets. The `OneRollBets` struct has 7 fixed fields (field, any7, anyCraps, yo, hiLo, aces, boxcars), all usable at once. Gas budget updated to ~480k, within the 500k callbackGasLimit.

16. **`totalReserved` running counter.** A `uint256 public totalReserved` tracks the sum of all per-player `_reserved` values. Incremented in `rollDice()`, decremented in callback resolution and session expiry. Used by bankroll health thresholds (`bankroll + totalReserved` vs `initialBankroll`). Avoids iterating all player addresses on-chain.

17. **Seven-out sweeps all Place bets regardless of ON/OFF toggle.** Matches traditional casino and bubble craps rules. The toggle only affects whether a Place bet wins on its number — a 7 kills all Place bets unconditionally in any phase.

18. **Bet stacking and removal.** Pass Line and Come bets reject if slot is occupied and are locked (non-removable) from placement. Come/Don't Come use the next empty slot. Odds, Place, Hardway, and one-roll bets are additive up to their respective caps. Don't Pass, Don't Come, all Odds, Place, Hardway, and one-roll bets are removable. No bet modifications during `ROLL_PENDING`.

19. **Shared `_expireSession()` internal function.** `selfExclude()`, `excludePlayer()`, and `expireSession()` all call the same internal cleanup function. This guarantees consistent handling of ROLL_PENDING state (reserve return, `totalReserved` decrement, `pendingVRFRequests` decrement, `requestToPlayer` cleanup) across all expiry paths.

20. **Callback iterates all bet slots on every roll.** No phase-based shortcutting of which bets to evaluate. Come bets can survive into the come-out phase after a point is hit, so every slot must be checked on every roll. The phase only determines post-resolution state transitions.

21. **Single contract architecture.** `CrapsGame.sol` contains all logic: vault accounting, session management, VRF integration, and exclusion. No separate `CrapsVault.sol`. This eliminates external calls inside the VRF callback and simplifies access control. `PayoutMath.sol` remains a separate pure library.

22. **Four session phases.** `INACTIVE`, `COME_OUT`, `POINT`, `ROLL_PENDING`. The previously planned `BETTING` phase was removed as redundant — the first bet transitions directly from `INACTIVE` to `COME_OUT`.

23. **Explicit per-bet-type functions.** 18 placement functions, 15 removal functions, 1 toggle function. No generic `placeBet()` or `removeBet()`. Each function has its own validation, making the contract surface explicit and auditable.

24. **$100,000 recommended initial bankroll.** Revised from $50,000 after discovering that Come bet compounding with odds creates a theoretical worst case of ~$19,600 per session (not $6,700 as originally estimated). Soft launch at $50,000 is acceptable. Operator scales up via `depositBankroll()`.

25. **Standard ERC-20 only.** Fee-on-transfer tokens, rebasing tokens, and tokens with transfer hooks are incompatible. Deploying with such tokens will break the five-bucket invariant. This is an operator deployment responsibility, not enforced on-chain.
