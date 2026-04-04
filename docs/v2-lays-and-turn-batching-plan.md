# V2 Plan: Box Number Lays + Single-Confirmation Turn Execution

## Objective

Design the next contract iteration so that:

1. players can place **lay bets on box numbers** (`4, 5, 6, 8, 9, 10`), and
2. a player can **adjust bets and initiate a roll in one wallet confirmation**.

This document is a planning/spec artifact only. It does not change the current deployed behavior.

---

## Why this iteration

### Product goals

- Add an important missing craps feature: **lays on box numbers**.
- Remove the current UX friction where a player often needs:
  - one tx to add/remove/toggle bets, then
  - a second tx to call `rollDice()`.
- Move toward a “one confirmation per roll” table flow.

### Architectural reality of the current system

The current game stores session state by `msg.sender` and keeps all critical state in the single `CrapsGame.sol` contract. That means a standalone batching helper **cannot** simply call `placeBet()` and `rollDice()` on behalf of a player, because the helper would become the “player” from the game’s perspective.

**Implication:** the cleanest path is to add a **native batched turn entrypoint in `CrapsGameV2`**. A helper/router can still be useful later, but only as an optional layer on top of explicit V2 support.

---

## Recommended high-level approach

### Recommendation A — implement batching natively in `CrapsGameV2`

Add a new entrypoint that applies a list of bet actions and optionally rolls immediately.

**Why:**
- preserves the current per-player storage model
- avoids delegated-execution/auth complexity
- keeps solvency + VRF request logic in the core contract
- achieves the UX goal with minimal moving parts

### Recommendation B — treat helper/router as optional, not required

If we want future support for:
- deposit + session open + bet updates + roll in one tx
- permit/Permit2-based approvals
- account abstraction / relayer flows

then add a separate router only **after** the native turn batching API exists.

---

## Scope

### In scope

- New lay bet types for box numbers
- Validation, payout, reserve, removal, and resolution logic for lays
- New one-call “submit turn + roll” contract API
- ABI/interface updates
- unit/integration coverage
- frontend/API implications documented

### Out of scope for this iteration

- buy bets
- commission-free mainnet launch of lays without house-edge review
- full gas optimization pass beyond what is needed for the feature
- meta-transactions / trusted forwarders

---

## Part 1 — Box Number Lays

## 1.1 New bet family

Add six new bet types:

- `LAY_4`
- `LAY_5`
- `LAY_6`
- `LAY_8`
- `LAY_9`
- `LAY_10`

These are persistent box-number bets that win when **7 rolls before the target number** and lose when the target number rolls before 7.

---

## 1.2 Rule model to adopt

### Recommended rules

Model lays as the “opposite-side sibling” of place bets:

- can be added only while **puck ON**
- persist across rolls until removed or resolved
- can survive into a later come-out phase
- support a **working toggle** during come-out, mirroring place-bet UX
- always lose if the target number rolls
- win if 7 rolls before the target number

### Why use this model

- fits the existing fixed-slot session design
- matches current place-bet persistence semantics
- keeps UX intuitive: place and lay become opposite box-number rails
- minimizes special-case code paths in session lifecycle handling

### Open rules question

Some casinos treat lay/buy working behavior differently on the come-out. For V2, the recommended product decision is:

> **Mirror current place-bet toggle semantics for lays** instead of trying to emulate every casino variant.

That gives us deterministic, understandable on-chain behavior.

---

## 1.3 Economic design decision: commission/vig

This is the single biggest product/economic question.

### Important note

If standalone lays are added at pure true odds **with no vig**, they become approximately **zero-edge bets** for the player.

That is very different from:
- `DONT_PASS_ODDS`
- `DONT_COME_ODDS`

because those are attached to flat bets that already carry house edge.

### Recommendation

Add an explicit **lay commission policy** in V2.

### Preferred V2 policy

Charge a **vig on lay wins**, computed exactly in token base units.

Example policy:
- vig rate: `5%` of the **win amount**, not of the stake
- no whole-dollar rounding; use exact token-unit arithmetic
- collect vig only when the lay wins

### Why this policy

- preserves a house edge
- avoids charging players repeatedly just for holding a persistent lay across many rolls
- simpler UX than up-front commission refunds/recomputations when players resize or remove a bet

### Alternative policy

Charge vig up front when the lay is placed or increased.

### Why not preferred

- requires more bookkeeping when removing/reducing lays
- makes resizing lays awkward
- creates more edge cases for `removeBet`, expiry, and batched actions

### Must-decide item before implementation

Pick one:
1. **vig on win** (recommended)
2. vig on placement/increase
3. no vig (only if zero-edge lays are an intentional product choice)

---

## 1.4 Payout model

Assuming the lay stake is the amount held in `_inPlay`:

- `LAY_4`, `LAY_10` pay `1:2`
- `LAY_5`, `LAY_9` pay `2:3`
- `LAY_6`, `LAY_8` pay `5:6`

Equivalent examples:
- risk `2` to win `1` on 4/10
- risk `3` to win `2` on 5/9
- risk `6` to win `5` on 6/8

### Required multiples

To guarantee exact integer payouts, require:

- `LAY_4`, `LAY_10`: multiple of `2`
- `LAY_5`, `LAY_9`: multiple of `3`
- `LAY_6`, `LAY_8`: multiple of `6`

With a 6-decimal token, we should encode these as token-unit multiples, not raw integers.

---

## 1.5 Min/max policy

### Recommended policy

Define min/max in terms of **amount at risk** (the in-play lay amount), not target win amount.

Why:
- matches the rest of the current API, where `amount` means funds moved into `_inPlay`
- simplifies reserve logic
- simplifies batching and UI validation

### Suggested defaults

Use a dedicated lay cap family:

- `MIN_LAY_4_10_BET = 2e6`
- `MIN_LAY_5_9_BET = 3e6`
- `MIN_LAY_6_8_BET = 6e6`
- `MAX_LAY_BET = <to be decided>`

### Open max-bet question

Two viable choices:

1. **cap lay stake directly** (simpler)
2. cap **max possible win** (more casino-like, more complex)

Recommendation: **cap stake directly** for V2.

---

## 1.6 Storage design

### Recommendation

Add a new fixed-slot lay structure to `BetSlots`, parallel to place bets.

Example shape:

```solidity
struct BoxBet {
    uint256 amount;
    bool working;
}
```

Then extend `BetSlots` with:

- `lay4`
- `lay5`
- `lay6`
- `lay8`
- `lay9`
- `lay10`

### Why

- consistent with current fixed-size storage approach
- easy to expose through `PlayerState`
- easy for frontend normalization
- avoids dynamic arrays or nested maps

### Note

We can either:
- reuse the existing `PlaceBet` struct for lays, or
- introduce a more generic `BoxBet` and migrate both place + lay to it in V2.

Recommendation: use a shared `BoxBet` type in V2 for clarity.

---

## 1.7 Contract/API changes for lays

### Interface changes

Update `contracts/interfaces/ICrapsGame.sol` to:
- add new `BetType` members for the six lays
- extend `BetSlots`
- optionally add `setLayWorking(uint8 number, bool working)`

### Recommendation on toggle API

Prefer a generic function:

```solidity
function setBoxWorking(BetType betType, bool working) external;
```

or

```solidity
function setLayWorking(uint8 layNumber, bool working) external;
```

Recommendation: **dedicated `setLayWorking`** is easiest for UI and least ambiguous.

### Placement/removal behavior

- placement via `placeBet(BetType.LAY_X, amount)`
- removal via `removeBet(BetType.LAY_X)`
- working toggle via dedicated function

---

## 1.8 Resolution behavior

Each lay bet needs explicit resolution logic in both:
- `PayoutMath.maxPossiblePayout(...)`
- `CrapsGameV2` roll resolution paths

### Resolution rules

For a lay on target `N`:

- if `sum == 7`: bet wins, player receives original stake + lay payout - optional vig
- if `sum == N`: bet loses, stake goes to bankroll
- otherwise: bet stays active
- if puck is OFF and bet is marked non-working: it should not win on 7 during come-out unless product rules say otherwise

### Open nuance

Whether non-working lays on come-out should:
- be fully ignored on the roll, or
- still lose on their number / win on 7.

Recommendation: match place-bet semantics as closely as possible and define this explicitly in the V2 spec before coding.

---

## 1.9 Worst-case reserve impact

`PayoutMath.maxPossiblePayout(...)` must be extended to include lay outcomes.

Key effect:
- lays increase worst-case liability on outcomes where `sum == 7`
- but not on target-number outcomes, because those are player losses

### Requirements

- preserve exact per-outcome evaluation across all 15 dice outcomes
- include working-state semantics in come-out handling
- include commission behavior correctly if vig is charged on win
- preserve the invariant that `fulfillRandomWords` never needs more than the reserved amount

### Critical implementation detail

If vig is charged on win, reserve only the **net player payout owed by the house**.
Do not over-reserve for commission that remains in-house.

---

## 1.10 Removal and session-expiry behavior

Lays should follow the same broad lifecycle as place bets:

- removable when session is not `ROLL_PENDING`
- returned to `_available` on `closeSession()`
- returned to `_available` on `expireSession()`
- included in total `_inPlay`
- respected by exclusion/session cleanup paths

---

## Part 2 — Single-confirmation turn execution

## 2.1 UX goal

A player should be able to do this in one confirmation:

- add/remove/toggle bets
- then immediately request the next roll

Examples:
- add pass odds + roll
- press don’t come odds on slot 2 + remove a field bet + roll
- toggle place 6 OFF + add lay 4 + roll

---

## 2.2 Recommended API shape

Add a native V2 turn executor.

### Proposed pattern

```solidity
enum ActionKind {
    PLACE,
    PLACE_INDEXED,
    REMOVE,
    REMOVE_INDEXED,
    SET_PLACE_WORKING,
    SET_LAY_WORKING
}

struct TurnAction {
    ActionKind kind;
    BetType betType;
    uint8 indexOrNumber;
    uint256 amount;
    bool flag;
}

function executeTurn(TurnAction[] calldata actions, bool rollAfter)
    external
    returns (uint256 requestId);
```

### Behavior

1. validate session/action preconditions
2. apply each action sequentially using the same internal logic used by current single-action methods
3. if `rollAfter == true`, run the normal reserve + VRF request flow
4. emit the same per-action events as if actions were called separately
5. emit `RollRequested` if a roll is initiated

### Recommendation

Refactor current public methods so both:
- `placeBet` / `removeBet` / `setPlaceWorking` / etc.
- `executeTurn`

share the same internal action functions.

That avoids duplicated validation logic.

---

## 2.3 Why native batching beats a helper-only design

A helper-only design does **not** solve the problem by itself because current session accounting is keyed by `msg.sender`.

If helper calls the game directly:
- the helper becomes the player
- bets/session/reserve attach to the helper address
- the user’s real session is not updated

So a helper contract only works if V2 also introduces one of these more complex patterns:
- delegated execution with signed player intent
- trusted forwarder / ERC-2771 meta-tx model
- explicit `player` parameter plus authorization checks on all mutating paths

These are much larger trust and security surfaces than a native batch entrypoint.

**Conclusion:** implement `executeTurn` in core first.

---

## 2.4 Optional router/helper after native batching

After native batching exists, an optional `CrapsGameRouter` could add convenience features:

- `deposit + executeTurn` in one tx
- Permit2 or token-specific permit support
- session open + initial bet + roll in one tx
- wallet-abstraction integrations

### Example optional router flows

- `permitAndDepositThenExecuteTurn(...)`
- `depositThenExecuteTurn(...)`

### Recommendation

Do **not** make router/helper a dependency for the core “one confirmation per roll” UX.
That UX should already be satisfied by calling `executeTurn(..., true)` directly.

---

## 2.5 Safety requirements for `executeTurn`

### Atomicity

All actions + optional roll should be atomic:
- if any action is invalid, the whole call reverts
- no partial turn state should persist

### Event compatibility

Emit existing events so indexers/frontend logic do not need a totally separate event model.

Optional addition:

```solidity
event TurnExecuted(address indexed player, uint256 actionCount, bool rolled, uint256 requestId);
```

### Roll gating

If `rollAfter == true`:
- final state must have `_inPlay[player] > 0`
- session must not already be `ROLL_PENDING`
- bankroll reserve must still succeed on the post-action state

### Order sensitivity

Actions are applied in-order. This must be documented because it affects validity.

Examples:
- remove odds then roll ✅
- add odds before the flat bet exists ❌
- toggle place working before the place bet exists ❌

---

## 2.6 Suggested internal refactor

Create internal action handlers such as:

- `_applyPlaceBet(address player, SessionData storage session, BetType betType, uint256 amount)`
- `_applyPlaceIndexedBet(...)`
- `_applyRemoveBet(...)`
- `_applyRemoveIndexedBet(...)`
- `_applySetPlaceWorking(...)`
- `_applySetLayWorking(...)`
- `_startRoll(address player, SessionData storage session)`

Then:
- existing single-action externals become thin wrappers
- `executeTurn` loops over actions and calls the same handlers

This is the cleanest way to preserve current behavior while adding batching.

---

## Part 3 — Test plan

## 3.1 Unit tests for lays

Add dedicated tests covering:

- valid placement on each lay number
- invalid placement on puck OFF (if we adopt that rule)
- required multiples for each number family
- min/max enforcement
- removal behavior
- working toggle behavior
- 7 wins / number loses / unrelated numbers persist
- lay persistence across point resolution and later come-out
- lay cleanup on close/expiry/exclusion
- lay reserve contribution in `maxPossiblePayout`
- commission behavior under all payout points

Suggested file:
- `test/unit/LayBets.test.ts`

## 3.2 Unit tests for batched turns

Add tests for:

- add bet + roll in one tx
- multiple adds + roll
- remove + add + roll
- toggle + roll
- indexed + non-indexed action mix
- revert on invalid action order
- revert on invalid final state (`rollAfter = true` and no in-play bets)
- reserve computed from post-action state, not pre-action state
- emitted events equivalence with separate calls

Suggested file:
- `test/unit/TurnBatching.test.ts`

## 3.3 Integration tests

Add integration coverage for realistic user flows:

- establish point → add lay 4 + roll
- lay survives → toggle working on come-out → roll again
- don’t-side table flow using lays + don’t come odds
- single-confirmation repeated turns over several rolls
- session expiry while lays exist
- pause/exclusion behavior with batched turn execution

---

## Part 4 — Frontend/API follow-up

This contract plan implies frontend updates later, but they are not part of this spec.

Still, V2 should anticipate the following UI needs:

- new lay chips/zones for `4,5,6,8,9,10`
- explicit lay payout/multiple guidance in bet modal
- one “Confirm & Roll” interaction that serializes a turn into `TurnAction[]`
- optimistic state updates that apply action list locally before pending roll state

---

## Part 5 — Migration / compatibility strategy

## 5.1 Contract versioning

This should be a **new contract iteration** (`CrapsGameV2`), not an in-place mutation of the deployed contract.

Reasons:
- ABI changes
- enum/storage changes
- new event/API surface
- easier audit boundary

## 5.2 ABI compatibility notes

Adding enum members changes frontend constants and TypeChain output. All consumers must regenerate ABI/types.

## 5.3 Deployment recommendation

- deploy V2 separately
- keep V1 artifacts intact
- export a distinct frontend ABI/config for V2

---

## Part 6 — Open decisions to resolve before coding

1. **Lay vig model**
   - on win (recommended)
   - on placement
   - no vig

2. **Lay availability window**
   - puck ON only (recommended)
   - any time

3. **Come-out working semantics for lays**
   - mirror place toggles (recommended)
   - always working
   - always off unless toggled on

4. **Lay max-bet semantics**
   - cap stake (recommended)
   - cap max possible win

5. **Batch API shape**
   - single generic `executeTurn` (recommended)
   - separate `batchActions` + `rollDice`
   - several specialized combo functions

6. **Router/helper scope**
   - not in V2 core milestone (recommended)
   - include optional deposit/router after native batch path is stable

---

## Recommended implementation order

### Phase 1 — Spec lock
- finalize lay rules
- finalize vig policy
- finalize `executeTurn` ABI

### Phase 2 — Core contract refactor
- extract internal action handlers
- preserve current behavior for existing bet families

### Phase 3 — Add lays
- enum/storage/interface changes
- validation + resolution + reserve math
- cleanup paths

### Phase 4 — Add turn batching
- `TurnAction` ABI
- `executeTurn`
- event coverage

### Phase 5 — Tests
- unit tests for lays
- unit tests for batching
- integration regression suite

### Phase 6 — Frontend follow-up
- lay UI
- “Confirm & Roll” UX
- updated optimistic state handling

---

## Final recommendation

For the next contract iteration:

1. **Add box-number lays in core**, with a clearly chosen commission model.
2. **Add a native `executeTurn(..., rollAfter)` entrypoint** so the table can use one confirmation per roll.
3. **Do not rely on a helper contract as the primary batching solution**, because the current player/session model makes helper-only batching the wrong abstraction.
4. Consider a router later only for deposit/permit/account-abstraction convenience.
