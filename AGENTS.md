# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-20

## OVERVIEW
Project: **crypto-craps**

On-chain craps for BASE, implemented as a Hardhat monorepo-in-name but currently centered on a single Solidity contract system plus TypeScript tests.

### Stack
- **Package manager:** `pnpm@10.28.2`
- **Contracts:** Solidity `0.8.24`
- **Tooling:** Hardhat `^2.22`, TypeScript `^5`, `ts-node`
- **Plugins:** `@nomicfoundation/hardhat-toolbox`, Hardhat Ignition, Hardhat Ignition Ethers, `hardhat-gas-reporter`, `solidity-coverage`
- **Libraries:** OpenZeppelin Contracts `^5.1`, Chainlink Contracts `^1.2`, `dotenv`
- **Testing:** Mocha + Chai via Hardhat, TypeScript fixtures/helpers
- **Security tooling configs present:** `slither.config.json`, `mythril.config.json`
- **Network targets:** local Hardhat, BASE Sepolia, BASE mainnet

## STRUCTURE
- `contracts/CrapsGame.sol`: Main contract. Holds vault accounting, session state, betting logic, exclusion logic, VRF request/fulfillment flow, and invariant helpers.
- `contracts/interfaces/ICrapsGame.sol`: Public enums, structs, custom errors, events, and interface signatures.
- `contracts/libraries/PayoutMath.sol`: Pure payout and worst-case reserve math.
- `contracts/mocks/`: Test-only mocks and harnesses.
  - `CrapsGameHarness.sol`: Exposes internal helpers for unit tests.
  - `MockERC20.sol`: 6-decimal ERC-20 with permit + unrestricted mint for tests.
  - `MockVRFCoordinator.sol`: Local VRF coordinator simulator.
- `test/unit/`: Main unit test suite.
- `test/unit/helpers/gameFixture.ts`: Shared deployment fixture, bet enum constants, USD helper, and roll helper.
- `test/integration/`: Integration tests covering session flows, exclusions/solvency, multiplayer/pause behavior, and invariant-style randomized sequences.
- `scripts/check-vault-coverage.mjs`: Coverage gate for selected vault functions in `CrapsGame.sol`.
- `scripts/`: Deployment, verification, rehearsal-token, smoke-test, and Sepolia fork/expiry helpers.
- `ignition/modules/`: Ignition deployment modules, including `ignition/modules/CrapsGame.ts`.
- `frontend/`: Placeholder only; frontend has not been scaffolded yet.
- `typechain-types/`: Generated contract typings.
- `artifacts/`, `cache/`, `coverage/`: Generated Hardhat outputs.
- `PLAN.md`: Full architecture/design spec. Very detailed and worth reading before changing game logic.
- `TASKS.md`: Phase-by-phase implementation tracker. Useful for current project status.
- `.env.example`: Required env vars for network/deploy setup.
- `.github/workflows/ci.yml`: CI runs install, compile, and test.

## CURRENT STATUS
Per `TASKS.md`, the contract, unit/integration tests, security/audit scripts, and the adopted BASE Sepolia deployment flow are implemented.

Highlights:
- Phases 0-7 are materially implemented in-repo
- Phase 8 is documented as complete for the adopted Sepolia path:
  - custom mintable rehearsal token (`srUSDC`)
  - Sourcify verification
  - live VRF-backed smoke test
  - Anvil-based session-expiry validation
- Mainnet deployment planning remains tracked separately in later phases
- Frontend work is still largely pending

Important implication: the repo is no longer just contract/unit-test scaffolding; it now includes live deployment automation, verification helpers, runbooks, and Sepolia findings artifacts.

## COMMANDS
| Action | Command |
|--------|---------|
| Install deps | `pnpm install` |
| CI-style install | `pnpm install --frozen-lockfile` |
| Clean | `pnpm clean` |
| Compile / build | `pnpm compile` |
| Test all | `pnpm test` |
| Coverage | `pnpm coverage` |
| Vault coverage gate | `pnpm coverage:vault` |
| Start local chain | `pnpm node` |
| Prepare Sepolia deploy params | `pnpm prepare:deploy:sepolia` |
| Deploy rehearsal token | `pnpm deploy:sepolia:rehearsal-token` |
| Mint rehearsal funds | `pnpm mint:sepolia:rehearsal-funds` |
| Deploy to BASE Sepolia | `pnpm deploy:sepolia` |
| Verify Sepolia deployment on Sourcify | `pnpm verify:sepolia:sourcify` |
| Run Sepolia smoke test | `pnpm smoke:sepolia` |
| Start Anvil Sepolia fork | `pnpm fork:sepolia:anvil` |
| Run Anvil expiry check | `pnpm fork:sepolia:expire` |

There is still **no app/dev server command**, but deployment and verification commands are present in `package.json`.

## ENVIRONMENT
From `.env.example`:
- `DEPLOYER_PRIVATE_KEY`
- `BASE_SEPOLIA_RPC_URL`
- `BASE_MAINNET_RPC_URL`
- `BASESCAN_API_KEY` (optional for the adopted Sepolia Sourcify path; still relevant for explorer verification flows)
- `VRF_SUBSCRIPTION_ID`
- `VRF_SUBSCRIPTION_ID_MAINNET`
- `SEPOLIA_TOKEN_ADDRESS`
- `MAINNET_TOKEN_ADDRESS`
- `SEPOLIA_REHEARSAL_TOKEN_ADDRESS`
- `SEPOLIA_REHEARSAL_EXTRA_MINT_AMOUNT`
- `SEPOLIA_INITIAL_BANKROLL_AMOUNT`
- `MAINNET_INITIAL_BANKROLL_AMOUNT`
- `INITIAL_BANKROLL_AMOUNT`
- `SEPOLIA_SMOKE_DEPOSIT_AMOUNT`
- `SEPOLIA_SMOKE_PASS_LINE_BET`
- `SEPOLIA_SMOKE_WITHDRAW_AMOUNT`

Hardhat config also expects:
- `REPORT_GAS=true` to enable gas reporter

## CODING STANDARDS
### Solidity
- Uses **4-space indentation**.
- Uses **custom errors** instead of revert strings in core contract code.
- Constants are `ALL_CAPS`; immutables include `i_token`, `vrfSubscriptionId`, `vrfKeyHash`, `DEBUG`.
- Internal/private helpers are `_prefixed`.
- Controlled arithmetic paths often use `unchecked` after explicit bounds checks.
- Uses `SafeERC20` for token transfers.
- State cleanup typically uses `delete` or zeroing specific fields.
- Contract state is organized around **fixed-size structs/arrays**, especially bet storage; avoid introducing dynamic per-player bet arrays unless intentionally redesigning core architecture.

### TypeScript tests/scripts
- Uses **2-space indentation**.
- Tests use `describe`/`it` with `loadFixture` from Hardhat helpers.
- Monetary values are handled as `bigint`; test helper `usd()` assumes **6-decimal token units**.
- Shared helpers live in `test/unit/helpers/gameFixture.ts`.

### Formatting/linting
- `tsconfig.json` enables `strict: true`.
- No ESLint/Prettier/Solhint config was found at repo root.
- In practice, follow the existing source formatting and naming conventions rather than inventing new style rules.

## ARCHITECTURAL CONVENTIONS
- `CrapsGame.sol` is intentionally the single stateful core contract.
- `PayoutMath.sol` should stay pure/stateless.
- Session/accounting design uses the five-bucket model:
  - player `_available`
  - player `_inPlay`
  - player `_reserved`
  - `bankroll`
  - `accruedFees`
- The contract tracks aggregate mirrors: `totalAvailable`, `totalInPlay`, `totalReserved`.
- Test harnesses expose internal helpers rather than mocking internal behavior.
- VRF flow is reserve-first: `rollDice()` reserves worst-case payout before the callback.
- `fulfillRandomWords` is a critical function and is expected by the plan/tasks to be non-reverting.

## WHERE TO LOOK
- **Core source:** `contracts/CrapsGame.sol`
- **Math/reserve logic:** `contracts/libraries/PayoutMath.sol`
- **Public API/types:** `contracts/interfaces/ICrapsGame.sol`
- **Tests:** `test/unit/`
- **Shared fixture:** `test/unit/helpers/gameFixture.ts`
- **Architecture spec:** `PLAN.md`
- **Implementation progress:** `TASKS.md`
- **Deployment env setup:** `.env.example`
- **CI workflow:** `.github/workflows/ci.yml`

## TESTING NOTES
Useful targeted test entrypoints:
- `pnpm test test/unit/Vault.test.ts`
- `pnpm test test/unit/Session.test.ts`
- `pnpm test test/unit/GameCore.test.ts`
- `pnpm test test/unit/ComeBets.test.ts`
- `pnpm test test/unit/OddsBets.test.ts`
- `pnpm test test/unit/PlaceBets.test.ts`
- `pnpm test test/unit/HardwayBets.test.ts`
- `pnpm test test/unit/PropBets.test.ts`
- `pnpm test test/unit/WorstCaseAudit.test.ts`

The repo relies heavily on the harness + mock coordinator pattern for deterministic roll resolution.

## NOTES / GOTCHAS
- Token amounts are effectively modeled for **6-decimal stablecoins** (`1e6` base unit in constants/tests).
- `frontend/` and `ignition/modules/` are placeholders right now.
- `typechain-types/`, `artifacts/`, `cache/`, and `coverage/` are generated; prefer editing source files instead.
- `PLAN.md` contains a lot of intended behavior beyond quick code inspection; consult it before changing payout, reserve, phase, or session-expiry logic.
- `TASKS.md` is a strong source of project intent and completion status; if code and plan diverge, verify whether the task list or implementation is the source of truth.
- CI currently does only: install, compile, test.
- There is no root `README.md`, `CLAUDE.md`, or `.cursorrules` in this repo as of generation time.
