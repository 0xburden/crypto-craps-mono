# Craps V2 Implementation Spec

## Status

Implementation-ready.

This spec defines the next contract iteration with two approved changes:

1. **box-number lays** are supported on `4, 5, 6, 8, 9, 10`
2. players can **submit bet changes and initiate the next roll in a single transaction confirmation**

This spec also locks the vig decision:

- **lay vig is charged on win**
- vig is **5% of the lay gross win amount**
- vig is computed in raw token units using integer truncation toward zero

---

## 1. Scope and deliverables

## 1.1 New contracts/files

Implement V2 as parallel artifacts. Do **not** mutate V1 in place.

Create:

- `contracts/interfaces/ICrapsGameV2.sol`
- `contracts/libraries/PayoutMathV2.sol`
- `contracts/CrapsGameV2.sol`

Add V2 tests:

- `test/unit/LayBetsV2.test.ts`
- `test/unit/TurnBatchingV2.test.ts`
- `test/integration/sessionFlowsV2.test.ts`
- `test/integration/multiplayerAndPauseV2.test.ts`

Optional later, **not in the core V2 milestone**:

- `contracts/CrapsGameRouterV2.sol`

---

## 1.2 Non-goals for V2

Not included in this iteration:

- buy bets
- changing the five-bucket accounting model
- changing the reserve-first VRF architecture
- trusted forwarders / meta-transactions
- requiring a helper/router for normal one-confirmation turn flow

---

## 2. Product decisions locked by this spec

## 2.1 Lays supported

Add standalone persistent lays on:

- 4
- 5
- 6
- 8
- 9
- 10

## 2.2 Lay timing

Lays may only be **placed or increased while puck is ON**.

This mirrors the existing place-bet availability model.

## 2.3 Lay persistence

Lays are persistent multi-roll bets.

They:
- remain in `_inPlay` until removed or resolved
- can survive into later come-out rolls
- are returned by `closeSession()` and `expireSession()`
- are blocked while `ROLL_PENDING`

## 2.4 Lay working toggle

Lays have a `working` flag exactly like place bets.

### Locked V2 semantics

For a lay bet during a roll:

- if `sum == target`, the lay **loses regardless of working flag**
- if `sum == 7`, the lay **wins only if `working == true`**
- otherwise it persists unchanged

This is intentionally the mirror of current place-bet semantics:

- place bets always lose on 7
- place bets only win on target when working
- lays always lose on target
- lays only win on 7 when working

## 2.5 Lay vig

Lay vig is charged **only when a lay wins**.

### Locked formula

For a winning lay:

- `grossWin = trueOddsPayout(stake)`
- `vig = grossWin * 500 / 10_000`
- `netWin = grossWin - vig`

Where:
- `500` is the locked `LAY_WIN_VIG_BPS`
- all math is in raw token units
- integer division truncates toward zero

### Accounting treatment

The vig is **not** added to `accruedFees`.
It remains in / returns to **`bankroll`** as gaming revenue.

Reason:
- deposit fees and game-edge revenue remain separate concepts
- reserve accounting stays simple
- no new fee-withdrawal path is needed

---

## 3. Exact rules for box lays

## 3.1 New bet types

Append new values to the end of the V2 enum so all existing V1 numeric IDs remain stable.

```solidity
enum BetType {
    PASS_LINE,
    PASS_LINE_ODDS,
    DONT_PASS,
    DONT_PASS_ODDS,
    COME,
    COME_ODDS,
    DONT_COME,
    DONT_COME_ODDS,
    PLACE_4,
    PLACE_5,
    PLACE_6,
    PLACE_8,
    PLACE_9,
    PLACE_10,
    FIELD,
    HARD_4,
    HARD_6,
    HARD_8,
    HARD_10,
    ANY_7,
    ANY_CRAPS,
    CRAPS_2,
    CRAPS_3,
    YO,
    TWELVE,
    HORN,
    LAY_4,
    LAY_5,
    LAY_6,
    LAY_8,
    LAY_9,
    LAY_10
}
```

Numeric values for existing bet types remain unchanged.

## 3.2 Storage model

Reuse the existing `PlaceBet` shape for lays to minimize implementation churn.

```solidity
struct PlaceBet {
    uint256 amount;
    bool working;
}
```

Extend `BetSlots` with six appended fields:

```solidity
struct BetSlots {
    Bet passLine;
    Bet dontPass;
    Bet[4] come;
    Bet[4] dontCome;
    PlaceBet place4;
    PlaceBet place5;
    PlaceBet place6;
    PlaceBet place8;
    PlaceBet place9;
    PlaceBet place10;
    PlaceBet lay4;
    PlaceBet lay5;
    PlaceBet lay6;
    PlaceBet lay8;
    PlaceBet lay9;
    PlaceBet lay10;
    HardwayBet hard4;
    HardwayBet hard6;
    HardwayBet hard8;
    HardwayBet hard10;
    OneRollBets oneRolls;
}
```

## 3.3 Payout ratios

Use true-odds lay payouts:

| Lay | Stake multiple | Gross win ratio |
|---|---:|---:|
| `LAY_4`, `LAY_10` | multiple of 2 | `1:2` |
| `LAY_5`, `LAY_9` | multiple of 3 | `2:3` |
| `LAY_6`, `LAY_8` | multiple of 6 | `5:6` |

### Examples

- risk 20 to win 10 on 4/10
- risk 30 to win 20 on 5/9
- risk 60 to win 50 on 6/8

## 3.4 Min/max rules

Lay `amount` is the **stake at risk** moved into `_inPlay`, not the target win.

Add constants in `CrapsGameV2.sol`:

```solidity
uint16 internal constant LAY_WIN_VIG_BPS = 500;
uint256 internal constant MIN_LAY_4_10_BET = 2e6;
uint256 internal constant MIN_LAY_5_9_BET = 3e6;
uint256 internal constant MIN_LAY_6_8_BET = 6e6;
uint256 internal constant MAX_LAY_BET = 500e6;
```

Use direct stake caps.

## 3.5 Placement rules

A lay may be placed or increased only when:

1. `whenNotPaused`
2. `notExcluded`
3. session exists and is ready for actions
4. `session.phase != ROLL_PENDING`
5. puck is `ON`
6. `amount <= _available[player]`
7. new total satisfies min/max/multiple rules for that specific lay number

Lays are **additive** like place bets.

## 3.6 Removal rules

A lay may be removed only when:

1. session is not `INACTIVE`
2. session is not `ROLL_PENDING`
3. bet exists (`amount > 0`)

Removal moves the full lay amount from `_inPlay` to `_available` and zeros:
- `amount`
- `working`

## 3.7 Working toggle rules

Lays can be toggled while session is ready and not `ROLL_PENDING`.

- if no active lay exists for the number, revert `NoActiveBet(betType)`
- toggle only changes `working`
- does not move funds

Default behavior on first lay placement:

- if the lay amount was previously `0` and the player places the bet, set `working = true`

This matches current place-bet initialization.

---

## 4. Exact lay resolution behavior

For each active lay on target `N` with stake `amount`:

### 4.1 If `sum == N`

- lay loses regardless of `working`
- zero lay slot
- move `amount` from `_inPlay` to `bankroll`

### 4.2 If `sum == 7`

If `working == true`:
- keep stake return semantics consistent with persistent bets
- move original `amount` from `_inPlay` back to `_available`
- compute `grossWin`
- compute `vig`
- credit only `netWin` from reserved bankroll
- zero lay slot

If `working == false`:
- do not win
- do not lose
- persist unchanged

### 4.3 Any other sum

- persist unchanged

---

## 5. Exact lay payout math

## 5.1 Multiplier additions in `PayoutMathV2`

Extend `payoutMultiplier(...)`:

```solidity
if (betType == ICrapsGameV2.BetType.LAY_4 || betType == ICrapsGameV2.BetType.LAY_10) {
    return (1, 2);
}
if (betType == ICrapsGameV2.BetType.LAY_5 || betType == ICrapsGameV2.BetType.LAY_9) {
    return (2, 3);
}
if (betType == ICrapsGameV2.BetType.LAY_6 || betType == ICrapsGameV2.BetType.LAY_8) {
    return (5, 6);
}
```

## 5.2 New pure helper in `PayoutMathV2`

Add:

```solidity
function layNetWinAmount(
    uint256 stake,
    ICrapsGameV2.BetType betType,
    uint8 point,
    uint16 layWinVigBps
) internal pure returns (uint256 grossWin, uint256 vig, uint256 netWin)
```

Rules:
- `point` is the lay target number (`4,5,6,8,9,10`)
- `grossWin = (stake * numerator) / denominator`
- `vig = (grossWin * layWinVigBps) / 10_000`
- `netWin = grossWin - vig`

This helper is the single source of truth for:
- reserve math
- resolution math
- tests

## 5.3 Reserve behavior

Worst-case reserve must use **net lay win**, not gross lay win.

Reason:
- only `netWin` is actually paid from bankroll to player
- vig stays in bankroll
- over-reserving would artificially reduce usable bankroll

---

## 6. Native one-confirmation turn batching

## 6.1 Required design choice

The one-confirmation UX must be implemented **natively in `CrapsGameV2`**.

A helper-only design is not acceptable as the primary batching path because session state is keyed by `msg.sender`.

## 6.2 New ABI

Add these types to `ICrapsGameV2.sol`:

```solidity
enum ActionKind {
    OPEN_SESSION,
    PLACE_BET,
    PLACE_INDEXED_BET,
    REMOVE_BET,
    REMOVE_INDEXED_BET,
    SET_BOX_WORKING
}

struct TurnAction {
    ActionKind kind;
    BetType betType;
    uint8 index;
    uint256 amount;
    bool working;
}
```

Add function:

```solidity
function executeTurn(TurnAction[] calldata actions, bool rollAfter)
    external
    returns (uint256 requestId);
```

## 6.3 Action semantics

### `OPEN_SESSION`

- ignores `betType`, `index`, `amount`, `working`
- equivalent to `openSession()`
- valid only if session is currently `INACTIVE`

### `PLACE_BET`

- uses `betType` and `amount`
- equivalent to `placeBet(betType, amount)`
- ignores `index`, `working`

### `PLACE_INDEXED_BET`

- uses `betType`, `index`, `amount`
- equivalent to `placeIndexedBet(betType, index, amount)`
- ignores `working`

### `REMOVE_BET`

- uses `betType`
- equivalent to `removeBet(betType)`
- ignores `index`, `amount`, `working`

### `REMOVE_INDEXED_BET`

- uses `betType`, `index`
- equivalent to `removeIndexedBet(betType, index)`
- ignores `amount`, `working`

### `SET_BOX_WORKING`

- uses `betType` and `working`
- valid only for:
  - `PLACE_4`, `PLACE_5`, `PLACE_6`, `PLACE_8`, `PLACE_9`, `PLACE_10`
  - `LAY_4`, `LAY_5`, `LAY_6`, `LAY_8`, `LAY_9`, `LAY_10`
- ignores `amount`
- ignores `index`

---

## 6.4 One-tx first roll support

`executeTurn` must support the first session turn.

Example valid sequence:

```solidity
[
  { kind: OPEN_SESSION, ... },
  { kind: PLACE_BET, betType: PASS_LINE, amount: 10e6, ... }
]
```
with `rollAfter = true`

This is required for smooth initial UX.

---

## 6.5 Constraints on `executeTurn`

Add constants and errors:

```solidity
uint256 internal constant MAX_TURN_ACTIONS = 32;

error EmptyTurn();
error TooManyTurnActions(uint256 provided, uint256 max);
error InvalidTurnAction(uint8 actionKind);
error InvalidWorkingBetType(BetType betType);
```

Behavior:

- if `actions.length == 0 && rollAfter == false`, revert `EmptyTurn()`
- if `actions.length > MAX_TURN_ACTIONS`, revert `TooManyTurnActions(...)`
- action application is strictly sequential
- the full call is atomic; any invalid action reverts the entire turn

## 6.6 Roll behavior inside `executeTurn`

If `rollAfter == true`, after all actions are applied:

1. final session state must not be `INACTIVE`
2. final session state must not be `ROLL_PENDING`
3. final `_inPlay[player] > 0`
4. reserve must be computed from the **post-action** bet state
5. session enters `ROLL_PENDING`
6. VRF request is submitted
7. function returns `requestId`

If `rollAfter == false`, return `0`.

---

## 6.7 Events

Keep emitting all existing per-action events:

- `SessionOpened`
- `BetPlaced`
- `BetRemoved`
- `RollRequested`

Add two new events in `ICrapsGameV2.sol`:

```solidity
event BoxWorkingSet(address indexed player, BetType indexed betType, bool working);
event TurnExecuted(address indexed player, uint256 actionCount, bool rolled, uint256 requestId);
```

Requirements:
- `BoxWorkingSet` must fire for `SET_BOX_WORKING`
- `TurnExecuted` must fire at the end of `executeTurn`
- if `rollAfter == false`, emit `requestId = 0`

---

## 7. Internal refactor required in `CrapsGameV2`

## 7.1 Player-param internal handlers

Current V1 internals rely on `msg.sender` in several places. V2 must refactor mutating helpers to accept `address player` so they can be safely reused by both:

- legacy one-action external methods
- `executeTurn`

Required internal handlers:

```solidity
function _applyOpenSession(address player) internal;
function _applyPlaceBet(address player, BetType betType, uint256 amount) internal;
function _applyPlaceIndexedBet(address player, BetType betType, uint8 index, uint256 amount) internal;
function _applyRemoveBet(address player, BetType betType) internal;
function _applyRemoveIndexedBet(address player, BetType betType, uint8 index) internal;
function _applySetBoxWorking(address player, BetType betType, bool working) internal;
function _startRoll(address player) internal returns (uint256 requestId);
```

Then the external wrappers become thin shims:

- `openSession()` -> `_applyOpenSession(msg.sender)`
- `placeBet(...)` -> `_applyPlaceBet(msg.sender, ...)`
- etc.
- `rollDice()` -> `_startRoll(msg.sender)`

## 7.2 Lay-specific internal helpers

Add:

```solidity
function _layBetStorage(BetSlots storage bets, BetType betType)
    internal
    view
    returns (PlaceBet storage);

function _layBetTypeForNumber(uint8 layNumber)
    internal
    pure
    returns (BetType);

function _validateLayAmount(uint256 newTotal, BetType betType) internal pure;

function _resolveLayBet(
    PlaceBet storage laySlot,
    BetType betType,
    uint8 target,
    uint8 sum
) internal returns (uint256 returnedAmount, uint256 netWinPayout, uint256 lostAmount);
```

### `_validateLayAmount`

Use exact rules:

- `LAY_4`, `LAY_10`: min `MIN_LAY_4_10_BET`, max `MAX_LAY_BET`, multiple `2e6`
- `LAY_5`, `LAY_9`: min `MIN_LAY_5_9_BET`, max `MAX_LAY_BET`, multiple `3e6`
- `LAY_6`, `LAY_8`: min `MIN_LAY_6_8_BET`, max `MAX_LAY_BET`, multiple `6e6`

Use token-unit multiples, not bare integers.

### `_resolveLayBet`

Return values:
- `returnedAmount`: original stake returned to available
- `netWinPayout`: net win paid from reserve
- `lostAmount`: stake moved to bankroll

Required behavior:

```solidity
if (amount == 0) return (0, 0, 0);
if (sum == target) {
    zero slot;
    return (0, 0, amount);
}
if (sum == 7 && working) {
    zero slot;
    (, , uint256 netWin) = PayoutMathV2.layNetWinAmount(amount, betType, target, LAY_WIN_VIG_BPS);
    return (amount, netWin, 0);
}
return (0, 0, 0);
```

---

## 8. Exact changes to public V2 methods

## 8.1 `placeBet`

Extend the `if`/dispatch chain to support lays.

New behavior:

- if `betType` is any `LAY_*`
- require puck `ON`
- load lay slot via `_layBetStorage`
- `newTotal = laySlot.amount + amount`
- `_validateLayAmount(newTotal, betType)`
- `_debitAvailable(player, amount)`
- `laySlot.amount = newTotal`
- if previous amount was zero, `laySlot.working = true`
- emit `BetPlaced(player, betType, amount)`

## 8.2 `removeBet`

Extend dispatch chain to support `LAY_*`.

Removal path mirrors `_removePlaceBet`.

## 8.3 New working-toggle entrypoint

Add to V2 interface and contract:

```solidity
function setLayWorking(uint8 layNumber, bool working) external;
```

Rules:
- `layNumber` must be one of `4, 5, 6, 8, 9, 10`
- translate to `BetType` with `_layBetTypeForNumber`
- call `_applySetBoxWorking(msg.sender, betType, working)`

Retain existing:

```solidity
function setPlaceWorking(uint8 placeNumber, bool working) external;
```

Implementation of both must flow through `_applySetBoxWorking`.

## 8.4 `rollDice`

V2 `rollDice()` remains supported and unchanged in user-facing semantics.

Internally it becomes a thin wrapper over `_startRoll(msg.sender)`.

---

## 9. Exact changes to reserve math

## 9.1 New `maxPossiblePayout` signature

Use in V2:

```solidity
function maxPossiblePayout(
    ICrapsGameV2.BetSlots memory bets,
    uint8 point,
    uint16 layWinVigBps
) internal pure returns (uint256 maxPayout)
```

## 9.2 New lay contribution in `_payoutForOutcome`

Add lay payout checks after place bets and before hardways.

Required helper:

```solidity
function _layPayout(
    ICrapsGameV2.PlaceBet memory bet,
    ICrapsGameV2.BetType betType,
    uint8 target,
    uint8 sum,
    uint16 layWinVigBps
) private pure returns (uint256)
```

Rules:
- if `bet.amount == 0`, return `0`
- if `sum == 7 && bet.working`, return `netWin`
- else return `0`
- never count lay target-number losses in payout reserve

Add all six calls:

- `lay4`
- `lay5`
- `lay6`
- `lay8`
- `lay9`
- `lay10`

## 9.3 `_startRoll`

In `CrapsGameV2`:

```solidity
uint256 worstCase = PayoutMathV2.maxPossiblePayout(activeBets, session.point, LAY_WIN_VIG_BPS);
```

Everything else in reserve flow stays the same.

---

## 10. Exact changes to VRF resolution flow

Inside `fulfillRandomWords(...)`, after existing place-bet resolution and before hardways, resolve all lay slots.

Required sequence:

```solidity
(returnedAmount, wonPayout, lostAmount) = _resolveLayBet(session.bets.lay4, BetType.LAY_4, 4, sum);
returnedToAvailable += returnedAmount;
payout += wonPayout;
lostToBankroll += lostAmount;
```

Repeat for all six lays.

This ordering is acceptable because resolution is aggregated into:
- `returnedToAvailable`
- `lostToBankroll`
- `payout`

and only applied after all bet-family computations complete.

---

## 11. Exact state/invariant requirements

The V2 changes must preserve the existing invariant:

```solidity
token.balanceOf(address(this)) == totalAvailable + totalInPlay + totalReserved + bankroll + accruedFees
```

Lay wins must preserve this as follows:

- original lay stake returns from `_inPlay` -> `_available`
- only `netWin` leaves reserve and is added to `_available`
- vig never leaves bankroll because reserve only pays net win

No new accounting bucket is introduced.

---

## 12. Optional helper/router contract

## 12.1 Status

Optional follow-up only. Not required for V2 core acceptance.

## 12.2 Reason

Once `executeTurn(..., true)` exists, the “one confirmation per roll” UX is already satisfied for normal play.

A helper becomes useful only for:
- deposit + turn batching in one tx
- token-specific permit support
- AA / relayer convenience

## 12.3 Explicit non-requirement

Do not block the V2 core implementation on a router contract.

---

## 13. Frontend contract-consumer requirements

These are not contract tasks, but the ABI assumes them.

## 13.1 New constants

Frontend bet type constants must append:

- `LAY_4`
- `LAY_5`
- `LAY_6`
- `LAY_8`
- `LAY_9`
- `LAY_10`

## 13.2 New bet rules

Frontend input rules must enforce token-unit multiples:

- 4/10 lays: `2`
- 5/9 lays: `3`
- 6/8 lays: `6`

scaled to token units in display logic.

## 13.3 New one-tx flow

Frontend “Confirm & Roll” should call:

```solidity
executeTurn(actions, true)
```

where `actions` serializes pending local edits in order.

---

## 14. Acceptance tests

## 14.1 Lay unit tests

Must cover at minimum:

1. place each lay number successfully while puck ON
2. reject each lay while puck OFF
3. required multiple enforcement for each lay family
4. max/min enforcement
5. additive lay increases
6. removal returns funds to available
7. lay wins on 7 when working
8. lay target number loses regardless of working
9. non-working lay does not win on 7 and persists
10. lay persists on irrelevant sums
11. lay returns on `closeSession()`
12. lay returns on `expireSession()`
13. lay reserve uses net win after vig
14. lay win amount exactly matches integer-truncated vig formula

## 14.2 Turn batching unit tests

Must cover at minimum:

1. `OPEN_SESSION + PLACE_BET + rollAfter=true` works in one tx
2. add odds + roll in one tx
3. remove bet + add lay + roll in one tx
4. indexed and non-indexed actions mixed in one tx
5. action order matters; invalid order reverts atomically
6. `executeTurn([], true)` performs a plain roll if otherwise valid
7. `executeTurn([], false)` reverts `EmptyTurn()`
8. `executeTurn` uses post-action reserve state
9. `TurnExecuted` event emits correct requestId
10. `BoxWorkingSet` emits for place and lay toggles

## 14.3 Integration tests

Must cover at minimum:

1. point established -> place lay -> roll resolution
2. lay survives into come-out -> toggle off -> 7 does not win
3. lay survives into come-out -> toggle off -> target still loses
4. multiplayer reserve accounting with simultaneous pending rolls and active lays
5. pause/exclusion blocks `executeTurn`
6. close/expire paths correctly release lay funds

---

## 15. Suggested implementation order

1. create `ICrapsGameV2.sol`
2. create `PayoutMathV2.sol`
3. port `CrapsGame.sol` -> `CrapsGameV2.sol`
4. refactor internals to player-param handlers
5. add lay bet storage + placement/removal/toggle logic
6. add lay reserve math to `PayoutMathV2`
7. add lay resolution to `fulfillRandomWords`
8. add `executeTurn`
9. add tests for lays
10. add tests for batching
11. run full regression suite

---

## 16. Final locked decisions summary

The V2 implementation **must** satisfy all of the following:

- standalone box lays exist for `4,5,6,8,9,10`
- lays are only placeable while puck ON
- lays are persistent and removable
- lays use `working` flag
- lays lose on target regardless of working
- lays win on 7 only when working
- lay vig is **5% of gross win**, charged **on win only**
- lay vig remains in `bankroll`, not `accruedFees`
- reserve math uses **net** lay win
- one-confirmation turn flow is implemented via native `executeTurn(actions, rollAfter)`
- `executeTurn` supports first-turn `OPEN_SESSION` batching
- V1 artifacts remain untouched
