# BASE Sepolia VRF v2.5 Setup

Use this guide before running `npm run deploy:sepolia`.

## 1. Create a subscription
- Open https://vrf.chain.link/
- Connect the deployer wallet.
- Select **BASE Sepolia**.
- Create a new **VRF v2.5** subscription.
- Copy the subscription ID into `deployments/sepolia-params.json` (`CrapsGameModule.subscriptionId`) or your deployment override file.

## 2. Fund the subscription
- Acquire BASE Sepolia LINK at `0xE4aB69C077896252FAFBD49EFD26B5D171A32410`.
- Fund the subscription with enough LINK to cover callback gas and confirmation costs.
- Keep a small buffer for repeated rolls and test transactions.

## 3. Deploy the contract
- Confirm the BASE Sepolia params file contains:
  - VRF coordinator: `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE`
  - USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
  - Key hash: `0x9e9e46732b32662b9adc6f3abdf6c5e926a666d6b7a39d3a50b33ff4f6f56f9`
- Run `npm run deploy:sepolia`.
- The deployment script writes the resulting contract details to `deployments/sepolia-deployment.json`.

## 4. Add the deployed contract as a consumer
- In the VRF subscription UI, open the subscription you created.
- Add the deployed `CrapsGame` address from `deployments/sepolia-deployment.json` as an approved consumer.
- Wait for the UI confirmation before requesting randomness on-chain.

## 5. Verify the contract
- Run `npm run verify:sepolia` after deployment completes.
- Basescan verification uses the constructor arguments stored in `deployments/sepolia-deployment.json`.

## 6. Operational checklist
- Ensure the deployer wallet holds BASE for gas.
- Ensure the deployer wallet holds enough testnet USDC for `initialBankrollAmount`.
- Ensure `BASESCAN_API_KEY`, `BASE_SEPOLIA_RPC_URL`, and `DEPLOYER_PRIVATE_KEY` are set.
- Keep `debug` disabled for live testnet deployments unless you intentionally want invariant asserts active.
