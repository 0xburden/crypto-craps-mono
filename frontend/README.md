# Crypto Craps Frontend

Minimal React + Vite frontend for Phase 9.

## Stack
- React + TypeScript + Vite
- wagmi v2 + viem v2
- RainbowKit
- TailwindCSS

## Run locally
1. Copy `frontend/.env.example` to `frontend/.env` and adjust values as needed.
   - Set `VITE_WALLETCONNECT_PROJECT_ID` to a real WalletConnect / Reown project ID.
   - Optionally set `VITE_BASE_SEPOLIA_GAME_ADDRESS_V3` to pin the frontend to a specific V3 deployment.
   - Runtime deployments can also overwrite `/config.js` with `window.__CRAPS_CONFIG__`; runtime values take precedence over Vite env.
   - If the WalletConnect project ID is left unset, RainbowKit falls back to a demo value and wallet configuration requests will log 400/403 errors in the browser console.
2. Install dependencies:
   - `pnpm --dir frontend install`
3. Export the latest contract ABI from Hardhat artifacts:
   - `pnpm frontend:abi`
4. Start the app:
   - `pnpm frontend:dev`

## Build
- `pnpm frontend:build`

## Notes
- BASE Sepolia is the primary supported chain.
- The frontend prefers V3 contract addresses (`VITE_BASE_*_GAME_ADDRESS_V3` or runtime config) and falls back to the existing Sepolia V2 address only for local continuity.
- BASE Mainnet is configured as a secondary chain, but the game contract address is env-driven until mainnet deployment is complete.
- The frontend watches the on-chain `RollResolved` event (the task list says `RollResult`, but the contract/interface use `RollResolved`).
- Deposit/withdraw/roll/session flows are wired through the shared `useCrapsGame` hook.
- Gameplay batching is enabled by default in the frontend: bet changes queue first, then `Confirm & Roll` submits `executeTurn(actions, true)`.
