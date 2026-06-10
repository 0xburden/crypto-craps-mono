# Dokploy Deployment

Crypto Craps V3 is deployed as a static frontend container. Contracts are deployed separately on-chain; the frontend container must never receive deployer private keys.

## Dokploy setup

Use Dokploy's Docker Compose flow against this repository/branch. The compose file builds the frontend directly from `frontend/` and does not require ignored Hardhat `artifacts/` or contract compilation.

Required/recommended environment variables:

| Variable | Purpose |
| --- | --- |
| `CRAPS_FRONTEND_PORT` | Host port for local compose; Dokploy usually manages routing itself. Defaults to `8080`. |
| `CRAPS_BASE_SEPOLIA_GAME_ADDRESS_V3` | Preferred Base Sepolia V3 game contract address. |
| `CRAPS_BASE_MAINNET_GAME_ADDRESS_V3` | Preferred Base Mainnet V3 game contract address. |
| `CRAPS_BASE_SEPOLIA_TOKEN_ADDRESS` | Sepolia token/srUSDC address override. |
| `CRAPS_BASE_MAINNET_TOKEN_ADDRESS` | Base USDC address override. |
| `CRAPS_BASE_SEPOLIA_RPC_URL` | Optional Sepolia RPC override. |
| `CRAPS_BASE_MAINNET_RPC_URL` | Optional Mainnet RPC override. |
| `CRAPS_WALLETCONNECT_PROJECT_ID` | WalletConnect/Reown project ID for RainbowKit. |
| `CRAPS_DEFAULT_CHAIN_ID` | `84532` for Base Sepolia or `8453` for Base Mainnet. Defaults to Sepolia. |

Legacy fallback vars are also accepted: `CRAPS_BASE_*_GAME_ADDRESS_V2` and `CRAPS_BASE_*_GAME_ADDRESS`.

## Runtime config

At container startup, `docker/40-runtime-config.sh` writes `/usr/share/nginx/html/config.js`:

```js
window.__CRAPS_CONFIG__ = { ... };
```

The frontend reads this runtime config before Vite build-time env values. This lets Dokploy change contract addresses, RPC URLs, and WalletConnect config without rebuilding the image.

`/config.js` is served with no-cache headers. Hashed JS/CSS/assets are served with long-lived immutable cache headers. SPA routes fall back to `index.html`.

## Local smoke

```bash
docker compose build frontend
docker compose up frontend
curl http://localhost:8080/healthz
curl http://localhost:8080/config.js
```

## V3 release order

1. Deploy and verify `CrapsGameV3` separately.
2. Add the V3 contract as a VRF consumer.
3. Commit/export the V3 frontend ABI under `frontend/src/abi/`.
4. Set Dokploy `CRAPS_*` env vars to the V3 deployment.
5. Deploy the compose app from the repo.
6. Run the V3 smoke script and manually verify off place/lay bets survive rolls.
