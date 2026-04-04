# BASE Sepolia V2 smoke test findings

- Generated at: 2026-04-04T03:53:30.865Z
- Network: baseSepolia
- Deployer/player: 0x20C04Acbf944a6dB9FA97782A06b21680b8D1A5E
- Contract: 0xf031019A2A1DcEee8dAc3a7B9bf3066ced493292
- Token: 0x8eb2C48C23fdaF506Eb6CB0397A3861AdA57a9dA
- Deployment artifact: /Users/burden/code/crypto-craps-mono/deployments/sepolia-deployment-v2.json
- Deposit amount: 100000000 (100.000000 USDC)
- Pass Line bet: 10000000 (10.000000 USDC)
- Withdraw amount: 1000000 (1.000000 USDC)

## Smoke test checklist

- [x] Wallet funding ready: Wallet resumed from an earlier funded/deposit state (0 wallet units, 109500000 on-contract units)
- [x] Deposit accounting correct: deposit step was already satisfied by existing on-contract player funds from an earlier run
- [x] executeTurn([PLACE_BET PASS_LINE], true) auto-opened the session and queued a roll with requestId 78903960670305556825561293138219634643593448706515523923295624897703420915501
- [x] Chainlink VRF fulfillment completed before timeout
- [x] Session advanced to phase 0 and pendingRequestId cleared
- [x] withdraw(1000000) returned tokens to the wallet
- [ ] Live session expiry still requires a 24h wait (or a fork-based follow-up against the deployed V2 address)

## Transactions

- closeSession: 0xabf49c399eb0cb083463456513177ce170c2861e02ec138879df7ecf47c7e8b2
- executeTurn: 0x4af0abb140a766fc99bd1c5a923b2bf0cb746cc22708713b41963c7827805f83
- withdraw: 0x65d1ef70f69b054d72f8a6f6fc9fffedee026f99f29741fd5056458929f43b6b

## Final on-chain state snapshot

- phase: 0
- puckState: 0
- point: 0
- available: 109500000
- inPlay: 0
- reserved: 0
- bankroll: 49990000000
- accruedFees: 500000

