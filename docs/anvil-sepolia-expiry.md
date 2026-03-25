# Anvil-based BASE Sepolia session expiry check

This helper validates `TASKS.md` item `8.5i` against the deployed Sepolia contract without waiting 24 hours on live testnet time.

## Prerequisites
- Foundry installed (`anvil` available)
- `.env` contains `BASE_SEPOLIA_RPC_URL`
- `deployments/sepolia-deployment.json` exists

## Start Anvil fork
```bash
pnpm fork:sepolia:anvil
```

This starts Anvil on `http://127.0.0.1:8555` and forks BASE Sepolia from `BASE_SEPOLIA_RPC_URL`.

## Run the expiry check
In another terminal:

```bash
pnpm fork:sepolia:expire
```

## What the script does
- connects to the Anvil fork
- reads the deployed Sepolia `CrapsGame`
- advances time by 24 hours + 1 second
- calls `expireSession(player)`
- verifies the session becomes `INACTIVE`
- verifies `inPlay`, `reserved`, and `pendingRequestId` are cleared
- impersonates the player on the fork
- verifies `withdraw()` still works after expiry

## Outputs
- human-readable report: `deployments/sepolia-expiry-fork-findings.md`
- machine-readable summary: `deployments/sepolia-expiry-fork-summary.json`

## Notes
- This validates the expiry flow against the live deployed Sepolia contract state.
- This is the adopted method for satisfying the Sepolia `8.5i` expiry check in the current Phase 8 workflow.
