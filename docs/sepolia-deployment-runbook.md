# BASE Sepolia Phase 8 runbook

This runbook covers the parts of `TASKS.md` Phase 8 that require a real wallet, Chainlink UI access, and live BASE Sepolia transactions.

## Prerequisites
- `DEPLOYER_PRIVATE_KEY` set in `.env`
- `BASE_SEPOLIA_RPC_URL` set in `.env` (optional if using the public default)
- `VRF_SUBSCRIPTION_ID` set in `.env`
- Deployer wallet funded with BASE for gas
- Deployer wallet funded with the configured Sepolia rehearsal token for the bankroll and smoke-test deposit
- VRF subscription funded with Sepolia LINK
- `BASESCAN_API_KEY` is optional and not required for the Sourcify-based Sepolia workflow

## Recommended Sepolia bankroll for the rehearsal-token path
Because the rehearsal token is mintable, Sepolia can now use the same bankroll sizing target as the original deployment recommendation.

Recommended `.env` values:
```bash
SEPOLIA_INITIAL_BANKROLL_AMOUNT=50000000000
SEPOLIA_SMOKE_DEPOSIT_AMOUNT=100000000
SEPOLIA_SMOKE_PASS_LINE_BET=10000000
SEPOLIA_SMOKE_WITHDRAW_AMOUNT=1000000
```

That corresponds to:
- initial bankroll: **50,000 tokens**
- smoke-test deposit: **100 tokens**
- pass-line bet: **10 tokens**
- withdraw verification: **1 token**

Recommended minimum live balances for one wallet handling deploy + smoke on the rehearsal token:
- **50,100 rehearsal tokens**
- **0.02 BASE Sepolia ETH** for gas
- **5 LINK** in the VRF subscription

## Commands
```bash
pnpm prepare:deploy:sepolia
pnpm deploy:sepolia
pnpm verify:sepolia:sourcify
pnpm smoke:sepolia
pnpm full:sepolia:rehearsal
pnpm full:sepolia:rehearsal:smoke
```

## Sepolia deployment path
The adopted Sepolia workflow uses the project's own mintable 6-decimal `MockERC20` rehearsal token (`srUSDC`) for live testnet deployment and smoke testing.

One-shot flow:

```bash
pnpm full:sepolia:rehearsal:smoke
```

Or, if you want deployment/verification separate from smoke:

```bash
pnpm full:sepolia:rehearsal
pnpm smoke:sepolia
```

Manual flow:

```bash
pnpm preflight:sepolia:rehearsal
pnpm deploy:sepolia:rehearsal-token
pnpm verify:sepolia:rehearsal-token:sourcify
pnpm mint:sepolia:rehearsal-funds
pnpm deploy:sepolia
pnpm add:sepolia:consumer
pnpm verify:sepolia:sourcify
pnpm smoke:sepolia
```

Notes:
- `pnpm full:sepolia:rehearsal` runs preflight + token deploy + token verify + mint + game deploy + VRF consumer registration + game verify.
- `pnpm deploy:sepolia:rehearsal-token` writes `deployments/baseSepolia-rehearsal-token.json`.
- `pnpm verify:sepolia:rehearsal-token:sourcify` verifies that token on Sourcify.
- `pnpm add:sepolia:consumer` registers the deployed `CrapsGame` as a consumer on the configured VRF subscription using the deployer wallet, so `rollDice()` can be fulfilled before smoke testing.
- `pnpm verify:sepolia:sourcify` verifies the game contract on Sourcify.
- `pnpm mint:sepolia:rehearsal-funds` mints enough token balance for:
  - `SEPOLIA_INITIAL_BANKROLL_AMOUNT`
  - `SEPOLIA_SMOKE_DEPOSIT_AMOUNT`
  - `SEPOLIA_REHEARSAL_EXTRA_MINT_AMOUNT`
- Once `deployments/baseSepolia-rehearsal-token.json` exists, `pnpm deploy:sepolia` automatically uses that rehearsal token unless `SEPOLIA_TOKEN_ADDRESS` is explicitly set.
- This is the adopted Sepolia testnet path recorded in `TASKS.md`.

## Phase 8 checklist mapping

### 8.1 Create and fund the VRF subscription
Manual:
- Create the BASE Sepolia VRF v2.5 subscription in https://vrf.chain.link/
- Fund it with Sepolia LINK
- Save the subscription id to `.env` as `VRF_SUBSCRIPTION_ID=<id>`

### 8.2 Deploy to BASE Sepolia
Automated:
- `pnpm deploy:sepolia`
- `SEPOLIA_INITIAL_BANKROLL_AMOUNT` overrides the generic `INITIAL_BANKROLL_AMOUNT` for Sepolia-only runs
- If `deployments/baseSepolia-rehearsal-token.json` exists, the deploy flow will use that token automatically unless `SEPOLIA_TOKEN_ADDRESS` is explicitly set
- Output artifact: `deployments/sepolia-deployment.json`

### 8.3 Add the deployed contract as a consumer
Manual:
- Open the subscription in the Chainlink UI
- Add the `contractAddress` from `deployments/sepolia-deployment.json`

### 8.4 Verify on Sourcify
Automated:
- `pnpm verify:sepolia:sourcify`
- Sourcify is the adopted public verifier for the Sepolia testnet workflow

### 8.5 Smoke test
Mostly automated:
- `pnpm smoke:sepolia`
- Output report: `deployments/sepolia-findings.md`
- The script covers deposit/open/place/roll/wait-for-fulfillment/withdraw
- Phase 8.5i still needs either a 24-hour live wait or a fork-based follow-up using the deployed address

### 8.6 Document findings
Automated/manual:
- Review `deployments/sepolia-findings.md`
- Add any extra notes, tx links, or incident details not captured automatically
