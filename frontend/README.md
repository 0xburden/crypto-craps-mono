# Frontend — crypto-craps on BASE

## Overview

React + TypeScript application providing a full on-chain craps player interface on BASE.
Wallet connects → deposit → bet → roll → withdraw cycle runs entirely through the deployed
`CrapsGame` contract.

## Stack

| Library | Purpose |
|---|---|
| **Vite** | Build tooling, dev server |
| **React 18** | UI framework |
| **wagmi v2** | Wallet connection hooks, contract read/write |
| **viem v2** | ABI encoding, EVM type utilities |
| **RainbowKit** | Wallet connector UI (MetaMask, Coinbase Wallet, WalletConnect) |
| **TailwindCSS** | Styling |

## Networks

| Network | Chain ID | Purpose |
|---|---|---|
| BASE Sepolia | 84532 | Primary testnet |
| BASE Mainnet | 8453 | Production |

## Setup

```bash
# 1. Install dependencies
cd frontend
pnpm install

# 2. Configure environment
cp .env.example .env
# Fill in VITE_WALLET_CONNECT_PROJECT_ID (WalletConnect Cloud project)
# Fill in VITE_SEPOLIA_CONTRACT_ADDRESS (deployed CrapsGame on Sepolia)
# Fill in VITE_MAINNET_CONTRACT_ADDRESS (deployed CrapsGame on Mainnet)
# Fill in VITE_SEPOLIA_TOKEN_ADDRESS (USDC or rehearsal token on Sepolia)

# 3. Start dev server
pnpm dev
```

## Build

```bash
pnpm build   # production build to frontend/dist/
pnpm preview # preview production build locally
```

## Contract Integration

### ABI

The `CrapsGame.json` ABI is placed under `src/abi/`. It is sourced from `artifacts/contracts/CrapsGame.sol/CrapsGame.json`
via the `pnpm export:abi` script at the repo root.

```bash
# Re-export ABI after contract changes
pnpm export:abi
```

### Key Contract Data

| Item | Sepolia value | Source |
|---|---|---|
| CrapsGame address | `0x6cBA1d9071c6900fE55a0aBf93dAaD363Da8919A` | `deployments/sepolia-deployment.json` |
| Token (rehearsal srUSDC) | `0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA` | `deployments/sepolia-deployment.json` |
| VRF Coordinator | `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE` | `deployments/sepolia-deployment.json` |
| Key Hash (30 gwei) | `0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71` | `deployments/sepolia-deployment.json` |

### Primary State Hook

All contract state is fetched through a single view call:

```
getPlayerState(address player) → PlayerState
```

This returns session phase, puck state, point, balances, all active bet slots, exclusion
status, and house bankroll context in one RPC call. The frontend calls this after every
transaction confirmation and after every relevant contract event.

### Core Write Operations

| Action | Function |
|---|---|
| Deposit | `deposit(amount)` — token approval required first |
| Withdraw | `withdraw(amount)` |
| Open session | `openSession()` |
| Close session | `closeSession()` |
| Place bet | `placeBet(betType, amount)` |
| Remove bet | `removeBet(betType)` |
| Place indexed bet | `placeIndexedBet(betType, index, amount)` |
| Remove indexed bet | `removeIndexedBet(betType, index)` |
| Toggle place working | `setPlaceWorking(placeNumber, working)` |
| Roll dice | `rollDice()` — emits `RollRequested` |
| Self-exclude | `selfExclude()` |
| Request reinstatement | `requestSelfReinstatement()` |
| Complete reinstatement | `completeSelfReinstatement()` |

### Bet Types (enum index)

```
0  PASS_LINE
1  PASS_LINE_ODDS
2  DONT_PASS
3  DONT_PASS_ODDS
4  COME
5  COME_ODDS
6  DONT_COME
7  DONT_COME_ODDS
8  PLACE_4
9  PLACE_5
10 PLACE_6
11 PLACE_8
12 PLACE_9
13 PLACE_10
14 FIELD
15 HARD_4
16 HARD_6
17 HARD_8
18 HARD_10
19 ANY_7
20 ANY_CRAPS
21 CRAPS_2
22 CRAPS_3
23 YO (11)
24 TWELVE
25 HORN
```

## Events to Watch

| Event | Significance |
|---|---|
| `RollRequested` | Roll submitted; UI enters ROLL_PENDING state |
| `RollResolved(die1, die2, payout)` | Roll result; UI shows dice, then refreshes state |
| `BetPlaced` | Bet confirmed on-surface |
| `BetRemoved` | Bet returned to available balance |
| `SessionOpened` / `SessionClosed` | Session lifecycle |
| `SessionExpired` | Bets returned; prompt to start new session |
| `SelfExcluded` | Player locked out of betting |

> **Note:** The contract emits `RollResolved` — not `RollResult`. TASKS.md originally used the
> name `RollResult`; frontend code must subscribe to the correctly-named event.

## Session Timer

`lastActivityTime` resets on every `RollResolved`. Sessions expire after 24 hours of
inactivity. The frontend should display a countdown and warn at 1 hour and 15 minutes
remaining.

## Token

The Sepolia deployment uses the project's custom mintable rehearsal token (`srUSDC`, 6 decimals),
not Circle's official USDC on BASE Sepolia. The token address is stored in
`VITE_SEPOLIA_TOKEN_ADDRESS` / `deployments/sepolia-deployment.json`.

The deposit fee is **0.5%** (`DEPOSIT_FEE_BPS = 50`).

## Mobile

The game UI is landscape-first. On viewports narrower than the landscape threshold, a full-screen
overlay prompts the user to rotate their device. The game UI does not render in portrait.

## Environment Variables

```bash
VITE_WALLET_CONNECT_PROJECT_ID=   # WalletConnect Cloud project ID (required for wallet connect)
VITE_SEPOLIA_CONTRACT_ADDRESS=    # CrapsGame on BASE Sepolia
VITE_MAINNET_CONTRACT_ADDRESS=    # CrapsGame on BASE Mainnet
VITE_SEPOLIA_TOKEN_ADDRESS=       # USDC or rehearsal token on Sepolia
VITE_MAINNET_TOKEN_ADDRESS=       # USDC on BASE Mainnet (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
VITE_DEFAULT_CHAIN=baseSepolia    # 'baseSepolia' or 'base'
```
