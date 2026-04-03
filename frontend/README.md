# Crypto Craps Frontend

Minimal React + Vite frontend for Phase 9.

## Stack
- React + TypeScript + Vite
- wagmi v2 + viem v2
- RainbowKit
- TailwindCSS

## Run locally
1. Copy `frontend/.env.example` to `frontend/.env` and adjust values as needed.
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
- BASE Mainnet is configured as a secondary chain, but the game contract address is env-driven until mainnet deployment is complete.
- The frontend watches the on-chain `RollResolved` event (the task list says `RollResult`, but the contract/interface use `RollResolved`).
- Deposit/withdraw/roll/session flows are wired through the shared `useCrapsGame` hook.
