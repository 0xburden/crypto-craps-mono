# BASE Sepolia VRF v2.5 Setup

Use this guide before running `pnpm deploy:sepolia`.

## 1. Create a subscription
- Open https://vrf.chain.link/
- Connect the deployer wallet.
- Select **BASE Sepolia**.
- Create a new **VRF v2.5** subscription.
- Set `VRF_SUBSCRIPTION_ID=<your subscription id>` in `.env`.
- `pnpm prepare:deploy:sepolia` will merge that value into `deployments/generated/sepolia-params.generated.json` for the live deployment.
- The adopted Sepolia workflow uses Sourcify for public verification (`pnpm verify:sepolia:sourcify` and `pnpm verify:sepolia:rehearsal-token:sourcify`).

## 2. Fund the subscription
- Acquire BASE Sepolia LINK at `0xE4aB69C077896252FAFBD49EFD26B5D171A32410`.
- Fund the subscription with enough LINK to cover callback gas and confirmation costs.
- Keep a small buffer for repeated rolls and test transactions.

## 3. Deploy the contract
- Confirm the BASE Sepolia params file contains:
  - VRF coordinator: `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE`
  - rehearsal token address or override source
  - Key hash: `0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71`
- Sepolia defaults to the rehearsal-token bankroll target: `SEPOLIA_INITIAL_BANKROLL_AMOUNT=50000000000` (50,000 tokens).
- Run `pnpm full:sepolia:rehearsal:smoke` for the full one-shot flow, run `pnpm full:sepolia:rehearsal` to stop before smoke, or run `pnpm preflight:sepolia:rehearsal && pnpm deploy:sepolia:rehearsal-token && pnpm verify:sepolia:rehearsal-token:sourcify && pnpm mint:sepolia:rehearsal-funds` before deployment.
- Once `deployments/baseSepolia-rehearsal-token.json` exists, `pnpm deploy:sepolia` automatically uses that rehearsal token unless `SEPOLIA_TOKEN_ADDRESS` is explicitly set.
- Run `pnpm deploy:sepolia`.
- The deployment flow first renders `deployments/generated/sepolia-params.generated.json`, then writes the resulting contract details to `deployments/sepolia-deployment.json`.

## 4. Add the deployed contract as a consumer
- In the VRF subscription UI, open the subscription you created.
- Add the deployed `CrapsGame` address from `deployments/sepolia-deployment.json` as an approved consumer.
- If the deployer wallet is also the subscription owner, you can automate this with `pnpm add:sepolia:consumer`.
- Wait for the UI confirmation before requesting randomness on-chain.

## 5. Verify the contract
- Run `pnpm verify:sepolia:sourcify` after deployment completes.
- Sourcify verification does not require explorer API keys.

## 6. Operational checklist
- Ensure the deployer wallet holds BASE for gas.
- Mint roughly **50,100 tokens** total by default: **50,000** bankroll + **100** smoke-test deposit.
- Ensure `BASE_SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, and `VRF_SUBSCRIPTION_ID` are set.
- `BASESCAN_API_KEY` is optional for this Sourcify-based Sepolia path.
- Optionally set `SEPOLIA_INITIAL_BANKROLL_AMOUNT` to override the Sepolia bankroll without affecting mainnet settings.
- Run `pnpm smoke:sepolia` after verification; it writes a live run summary to `deployments/sepolia-findings.md`.
- Keep `debug` disabled for live testnet deployments unless you intentionally want invariant asserts active.
