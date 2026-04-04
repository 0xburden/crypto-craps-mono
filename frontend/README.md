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
   - Optionally set `VITE_BASE_SEPOLIA_GAME_ADDRESS_V2` to pin the frontend to a specific V2 deployment.
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
- The current deployed BASE Sepolia V2 game address is `0xf031019A2A1DcEee8dAc3a7B9bf3066ced493292`.
- BASE Mainnet is configured as a secondary chain, but the game contract address is env-driven until mainnet deployment is complete.
- The frontend watches the on-chain `RollResolved` event (the task list says `RollResult`, but the contract/interface use `RollResolved`).
- Deposit/withdraw/roll/session flows are wired through the shared `useCrapsGame` hook.
