import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const DEFAULT_INITIAL_BANKROLL = 50_000_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const SHOULD_USE_MOCKS = process.env.CRAPS_USE_MOCKS !== "false";

const CrapsGameModule = buildModule("CrapsGameModule", (m) => {
  const deployer = m.getAccount(0);
  const initialBankrollAmount = m.getParameter("initialBankrollAmount", DEFAULT_INITIAL_BANKROLL);
  const debug = m.getParameter("debug", SHOULD_USE_MOCKS);
  const keyHash = m.getParameter("keyHash", ZERO_HASH);

  const token = SHOULD_USE_MOCKS
    ? m.contract("MockERC20", ["Mock USDC", "mUSDC"], {
        id: "MockUSDC",
        from: deployer
      })
    : m.contractAt("MockERC20", m.getParameter("tokenAddress", ZERO_ADDRESS), {
        id: "ConfiguredToken"
      });

  const vrfCoordinator = SHOULD_USE_MOCKS
    ? m.contract("MockVRFCoordinator", [], {
        from: deployer
      })
    : m.contractAt("MockVRFCoordinator", m.getParameter("vrfCoordinator", ZERO_ADDRESS), {
        id: "ConfiguredCoordinator"
      });

  const subscriptionRequest = SHOULD_USE_MOCKS
    ? m.call(vrfCoordinator, "createSubscription", [], {
        id: "CreateSubscription",
        from: deployer
      })
    : undefined;

  const subscriptionId = SHOULD_USE_MOCKS
    ? m.readEventArgument(subscriptionRequest!, "SubscriptionCreated", "subId", {
        emitter: vrfCoordinator,
        id: "SubscriptionId"
      })
    : m.getParameter("subscriptionId", 0n);

  const game = m.contract(
    "CrapsGame",
    [token, vrfCoordinator, subscriptionId, keyHash, debug],
    {
      from: deployer
    }
  );

  if (SHOULD_USE_MOCKS) {
    m.call(vrfCoordinator, "addConsumer", [subscriptionId, game], {
      id: "AuthorizeConsumer",
      from: deployer,
      after: [game]
    });
  }

  const approveDependencies = SHOULD_USE_MOCKS
    ? [
        game,
        m.call(token, "mint", [deployer, initialBankrollAmount], {
          id: "MintInitialBankroll",
          from: deployer,
          after: [game]
        })
      ]
    : [game];

  const approveBankrollTransfer = m.call(token, "approve", [game, initialBankrollAmount], {
    id: "ApproveInitialBankroll",
    from: deployer,
    after: approveDependencies
  });

  const fundBankroll = m.call(game, "fundBankroll", [initialBankrollAmount], {
    id: "FundInitialBankroll",
    from: deployer,
    after: [approveBankrollTransfer]
  });

  return {
    token,
    vrfCoordinator,
    subscriptionId,
    game,
    fundBankroll
  };
});

export default CrapsGameModule;
