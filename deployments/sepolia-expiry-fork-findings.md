# BASE Sepolia Anvil fork expiry findings

- Generated at: 2026-03-23T16:29:24.144Z
- Anvil RPC: http://127.0.0.1:8555
- Deployment artifact: /Users/burden/code/crypto-craps-mono/deployments/sepolia-deployment.json
- Game contract: 0x6cBA1d9071c6900fE55a0aBf93dAaD363Da8919A
- Player: 0x20C04Acbf944a6dB9FA97782A06b21680b8D1A5E
- Pre-expiry phase: 1
- Pre-expiry available: 107500000 (107.500000 token units)
- Pre-expiry inPlay: 0 (0.000000 token units)
- Pre-expiry reserved: 0 (0.000000 token units)
- Post-expiry available: 107500000 (107.500000 token units)
- Post-expiry inPlay: 0 (0.000000 token units)
- Post-expiry reserved: 0 (0.000000 token units)
- Expected available increase: 0 (0.000000 token units)
- Actual available increase: 0 (0.000000 token units)
- Wallet before withdraw: 2000000 (2.000000 token units)
- Wallet after withdraw: 3000000 (3.000000 token units)

## Transactions (fork only)

- expireSession: 0x7cc0157877ebe0f62d147a8ba803f436376b8311523616533edab7f34ada75ef
- withdraw: 0xb48bbad16e31453e626a929f70e82e973fe098ca2fe5e1ddb651f359238c529b

## Result

- [x] Anvil fork-based 24h session expiry path succeeded
- [x] Session moved to INACTIVE
- [x] In-play / reserved funds were released as expected
- [x] Player withdrawal still worked after expiry

