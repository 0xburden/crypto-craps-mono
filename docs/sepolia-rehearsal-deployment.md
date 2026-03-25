# BASE Sepolia rehearsal deployment

This document records the successful Sepolia deployment run completed against BASE Sepolia using the project's mintable 6-decimal `MockERC20` rehearsal token.

## Scope
This rehearsal proves the following live components work together on BASE Sepolia:
- deployment of a custom 6-decimal play token
- deployment of `CrapsGame`
- bankroll funding during deployment
- VRF subscription wiring
- VRF consumer registration
- live Chainlink VRF fulfillment
- scripted smoke flow for deposit / open session / place bet / roll / fulfill / withdraw
- source publication to Sourcify for both contracts

This is the adopted Phase 8 Sepolia deployment approach described in `TASKS.md`: a custom rehearsal token plus Sourcify verification.

## Live addresses

### Rehearsal token
- Contract: `MockERC20`
- Address: `0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA`
- Network: `baseSepolia` (`84532`)
- Name: `Sepolia Rehearsal USD`
- Symbol: `srUSDC`
- Decimals: `6`

### CrapsGame
- Contract: `CrapsGame`
- Address: `0x6cBA1d9071c6900fE55a0aBf93dAaD363Da8919A`
- Network: `baseSepolia` (`84532`)
- VRF coordinator: `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE`
- LINK token: `0xE4aB69C077896252FAFBD49EFD26B5D171A32410`
- VRF subscription id: `21125113605527230557476061461023679129743040007987767634885516918701967522421`
- Key hash: `0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71`
- Initial bankroll amount: `50000000000` (`50,000.000000` token units)
- Debug: `false`

## Sourcify verification

### Rehearsal token
- Status: verified on Sourcify
- URL: `https://repo.sourcify.dev/contracts/partial_match/84532/0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA/`

### CrapsGame
- Status: verified on Sourcify
- URL: `https://repo.sourcify.dev/contracts/partial_match/84532/0x6cBA1d9071c6900fE55a0aBf93dAaD363Da8919A/`

## Smoke test result
The scripted smoke test completed successfully and wrote the detailed report to `deployments/sepolia-findings.md`.

### Smoke checklist status
- `8.5a` funded player state available for testing ✅
- `8.5b` deposit accounting confirmed ✅
- `8.5c` session opened into `COME_OUT` ✅
- `8.5d` Pass Line bet placed ✅
- `8.5e` `rollDice()` entered `ROLL_PENDING` and emitted a request ✅
- `8.5f` Chainlink VRF fulfillment completed ✅
- `8.5g` phase advanced and balances updated ✅
- `8.5h` withdrawal returned tokens to wallet ✅
- `8.5i` completed via Anvil fork against the live Sepolia deployment ✅

### Smoke transactions
- `closeSession`: `0x46f0b1e9d7ffce8096d6fd90b6c98efeaf5c9fecb3e238a9874f526e64f6ec22`
- `openSession`: `0x980b8f9dde3b57678bce39c706dd49b2f2a5cb628c7817471cc173241b3dc513`
- `placeBet`: `0xdc37de687301a49607b9ac8cf27ab2f858605b1d67daccb7cc0f81ef6ba51d60`
- `rollDice`: `0xc02868cc31ab93c3207b638e1fd52d13c3ecfc6ea8d6be5253b59b2c23a2e833`
- `withdraw`: `0x3e17fe631434935d3a186fdf65346b8f5150dba861d308b7b36fbda890ce0a43`

### Final post-smoke state
- phase: `1`
- puckState: `0`
- point: `0`
- available: `88500000`
- inPlay: `10000000`
- reserved: `0`
- bankroll: `50000000000`
- accruedFees: `500000`

## Anvil expiry follow-up
An Anvil fork was used against the live Sepolia deployment to complete the `8.5i` session-expiry scenario without waiting 24 hours on-chain.

- Expiry report: `deployments/sepolia-expiry-fork-findings.md`
- Expiry summary JSON: `deployments/sepolia-expiry-fork-summary.json`

## Artifacts
- token artifact: `deployments/baseSepolia-rehearsal-token.json`
- game artifact: `deployments/sepolia-deployment.json`
- smoke report: `deployments/sepolia-findings.md`
- expiry fork report: `deployments/sepolia-expiry-fork-findings.md`

## Phase 8 status
The Sepolia deployment, verification, smoke testing, and Anvil-based expiry validation are complete for the adopted testnet workflow.

Optional follow-up work outside the adopted Phase 8 scope:
1. run an additional comparison deployment against official Circle BASE Sepolia USDC
2. add separate Basescan verification alongside Sourcify
3. preserve these rehearsal artifacts as the long-term Sepolia reference deployment

## Recommended next step
Use this Sepolia deployment as the reference testnet environment for any frontend or operational follow-up work.
