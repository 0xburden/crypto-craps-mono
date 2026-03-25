# BASE Sepolia smoke test findings

- Generated at: 2026-03-23T05:44:41.568Z
- Network: baseSepolia
- Deployer/player: 0x20C04Acbf944a6dB9FA97782A06b21680b8D1A5E
- Contract: 0x6cBA1d9071c6900fE55a0aBf93dAaD363Da8919A
- Token: 0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA
- Deployment artifact: /Users/burden/code/crypto-craps-mono/deployments/sepolia-deployment.json
- Deposit amount: 100000000 (100.000000 USDC)
- Pass Line bet: 10000000 (10.000000 USDC)
- Withdraw amount: 1000000 (1.000000 USDC)

## Smoke test checklist

- [x] 8.5a Wallet resumed from an earlier funded/deposit state (1000000 wallet units, 98500000 on-contract units)
- [x] 8.5b deposit step was already satisfied by existing on-contract player funds from an earlier run
- [x] 8.5c openSession() moved the session into COME_OUT
- [x] 8.5d placeBet(PASS_LINE, 10000000) updated the in-play/pass-line slot
- [x] 8.5e rollDice() entered ROLL_PENDING with requestId 12797033216750741683062245207853233911381039377182149204000589156781909160110
- [x] 8.5f Chainlink VRF fulfillment completed before timeout
- [x] 8.5g Session advanced to phase 1 and pendingRequestId cleared
- [x] 8.5h withdraw(1000000) returned tokens to the wallet
- [ ] 8.5i Session expiry on live Sepolia still requires a 24h wait (or a fork-based follow-up using the deployed address)

## Transactions

- closeSession: 0x46f0b1e9d7ffce8096d6fd90b6c98efeaf5c9fecb3e238a9874f526e64f6ec22
- openSession: 0x980b8f9dde3b57678bce39c706dd49b2f2a5cb628c7817471cc173241b3dc513
- placeBet: 0xdc37de687301a49607b9ac8cf27ab2f858605b1d67daccb7cc0f81ef6ba51d60
- rollDice: 0xc02868cc31ab93c3207b638e1fd52d13c3ecfc6ea8d6be5253b59b2c23a2e833
- withdraw: 0x3e17fe631434935d3a186fdf65346b8f5150dba861d308b7b36fbda890ce0a43

## Final on-chain state snapshot

- phase: 1
- puckState: 0
- point: 0
- available: 88500000
- inPlay: 10000000
- reserved: 0
- bankroll: 50000000000
- accruedFees: 500000

