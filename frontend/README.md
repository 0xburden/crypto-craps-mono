# crypto-craps frontend

React + TypeScript application providing a full on-chain craps player interface on BASE.
Wallet connects → deposit → bet → roll → withdraw cycle runs entirely through the deployed
`CrapsGame` contract.

## Stack

| Library | Purpose |
|---|---|
| **Vite 6** | Build tooling, dev server |
| **React 18** | UI framework |
| **wagmi v2** | Wallet connection hooks, contract read/write |
| **viem v2** | ABI encoding, EVM type utilities |
| **RainbowKit v2** | Wallet connector UI (MetaMask, Coinbase Wallet, WalletConnect) |
| **TailwindCSS v4** | Styling |

## Networks

| Network | Chain ID | Purpose |
|---|---|---|
| BASE Sepolia | 84532 | Primary testnet — **deployed** |
| BASE Mainnet | 8453 | Production — address TBD (Phase 10) |

## Quick Start

```bash
# Install frontend dependencies (from repo root)
pnpm frontend:install

# Configure environment
cp frontend/.env.example frontend/.env
# Edit frontend/.env — at minimum set VITE_WALLET_CONNECT_PROJECT_ID

# Development server (http://localhost:5173)
pnpm frontend:dev

# Production build
pnpm frontend:build

# Preview production build locally
pnpm frontend:preview
```

**From repo root after contract changes:**
```bash
pnpm export:abi   # copies ABI to frontend/src/abi/CrapsGame.json
pnpm frontend:build
```

## Pre-configured Contract Addresses

| Network | CrapsGame | Token | Notes |
|---|---|---|---|
| BASE Sepolia | `0x6cBA1d9071c6900fE55a0aBf93dAaD363Da8919A` | `0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA` (srUSDC rehearsal) | Live deployment |
| BASE Mainnet | TBD | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Circle USDC) | Phase 10 |

Set `VITE_SEPOLIA_CONTRACT_ADDRESS` and `VITE_SEPOLIA_TOKEN_ADDRESS` in `frontend/.env`
before running against Sepolia.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_WALLET_CONNECT_PROJECT_ID` | Yes | — | WalletConnect Cloud project ID |
| `VITE_SEPOLIA_CONTRACT_ADDRESS` | Yes | `0x6cBA1d9071c6900fE55a0aBf93dAaD363Da8919A` | CrapsGame on Sepolia |
| `VITE_MAINNET_CONTRACT_ADDRESS` | No | empty | CrapsGame on mainnet (fill after Phase 10) |
| `VITE_SEPOLIA_TOKEN_ADDRESS` | Yes | `0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA` | USDC/rehearsal token on Sepolia |
| `VITE_MAINNET_TOKEN_ADDRESS` | No | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Circle USDC on BASE mainnet |
| `VITE_DEFAULT_CHAIN` | No | `baseSepolia` | Default chain on load (`baseSepolia` or `base`) |

## Contract Integration

### ABI

`frontend/src/abi/CrapsGame.json` — exported from `artifacts/contracts/CrapsGame.sol/CrapsGame.json`
via `pnpm export:abi` at the repo root.

### Primary State

All UI state is fetched through a single view call:

```
getPlayerState(address player) → PlayerState { phase, puckState, point, lastActivityTime,
  pendingRequestId, available, inPlay, reserved, bankroll, totalBankroll,
  initialBankroll, accruedFees, paused, selfExcluded, operatorExcluded,
  reinstatementEligibleAt, bets }
```

Call after every transaction confirmation and after every contract event.

### Core Write Functions

| Action | Function | Notes |
|---|---|---|
| Deposit | `deposit(amount)` | Requires prior `approve()` on the token |
| Withdraw | `withdraw(amount)` | Always available, even when paused/excluded |
| Open session | `openSession()` | No active session, not excluded |
| Close session | `closeSession()` | Not `ROLL_PENDING` |
| Place bet | `placeBet(betType, amount)` | Validates min/max/multiple, puck state |
| Place indexed bet | `placeIndexedBet(betType, index, amount)` | Come/Don't Come at slot 0–3 |
| Remove bet | `removeBet(betType)` | Don't Pass, Odds, Place, Hardway, Props |
| Remove indexed bet | `removeIndexedBet(betType, index)` | Come/Don't Come slot |
| Toggle Place ON/OFF | `setPlaceWorking(placeNumber, working)` | |
| Roll dice | `rollDice()` | Emits `RollRequested`; waits for VRF |
| Self-exclude | `selfExclude()` | Immediate; session ended, bets returned |
| Request reinstatement | `requestSelfReinstatement()` | Eligible after 7 days |
| Complete reinstatement | `completeSelfReinstatement()` | Clears exclusion after delay |

### Bet Type Enum Index

```
 0  PASS_LINE        13 PLACE_10
 1  PASS_LINE_ODDS  14 FIELD
 2  DONT_PASS       15 HARD_4
 3  DONT_PASS_ODDS  16 HARD_6
 4  COME            17 HARD_8
 5  COME_ODDS       18 HARD_10
 6  DONT_COME       19 ANY_7
 7  DONT_COME_ODDS  20 ANY_CRAPS
 8  PLACE_4         21 CRAPS_2
 9  PLACE_5         22 CRAPS_3
10  PLACE_6         23 YO (11)
11  PLACE_8         24 TWELVE
12  PLACE_9         25 HORN
```

### Contract Events

| Event | UI reaction |
|---|---|
| `RollRequested(requestId, reservedAmount)` | Enter ROLL_PENDING state, disable betting |
| `RollResolved(requestId, die1, die2, payout)` | Show dice, then `getPlayerState` to refresh |
| `BetPlaced(betType, amount)` | Update chip on table |
| `BetRemoved(betType, amount)` | Remove chip, credit balance |
| `SessionOpened` | Hydrate active session |
| `SessionClosed / SessionExpired` | Clear table, prompt to deposit/withdraw |
| `SelfExcluded` | Show exclusion screen, enable withdraw only |

> **Important:** TASKS.md task 9.5 originally referenced `RollResult`. The contract emits
> `RollResolved` — subscribe to the correct event name or roll results will be silently missed.

### Token

The Sepolia deployment uses the project's **rehearsal token** (`srUSDC`, 6 decimals) at
`0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA`. It is mintable by the deployer.
**Not** Circle USDC on BASE Sepolia (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`).

Deposit fee: **0.5%** (`DEPOSIT_FEE_BPS = 50` in contract).

### Session Timer

Sessions expire **24 hours** after the last roll (`lastActivityTime` in `PlayerState`).
Display countdown in the header; warn at 1 hour and 15 minutes remaining.
Any successful `RollResolved` resets the timer.

### Mobile

The game UI is landscape-first. A full-screen prompt instructs portrait users to rotate.
The game does not render in portrait orientation.

## QA Notes (Spec Drift)

- `BankrollWarning` / `BankrollCritical` events are **not** in the contract. Bankroll
  health UI must use `PlayerState.bankroll / PlayerState.initialBankroll`.
- `initialBankroll` is **constant-backed** (`INITIAL_BANKROLL` Solidity constant), not a
  live deployment-tracked value.
- `token()` view function exists — call it on mount to validate the bound token matches
  `VITE_SEPOLIA_TOKEN_ADDRESS`.

Full QA findings: `docs/phase9-validation.md`
