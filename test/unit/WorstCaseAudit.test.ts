import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { SessionPhase, deployGameFixture, usd } from "./helpers/gameFixture";

describe("WorstCaseAudit", function () {
  it("matches the PLAN.md phase-4 bankroll sizing worst-case reserve derivation", async function () {
    const harnessFactory = await ethers.getContractFactory("PayoutMathHarness");
    const harness = await harnessFactory.deploy();

    const bets = {
      passLine: { amount: usd(500), oddsAmount: usd(1_500), point: 4 },
      dontPass: { amount: 0n, oddsAmount: 0n, point: 0 },
      come: Array.from({ length: 4 }, () => ({ amount: usd(500), oddsAmount: usd(1_500), point: 4 })),
      dontCome: Array.from({ length: 4 }, () => ({ amount: 0n, oddsAmount: 0n, point: 0 })),
      place4: { amount: usd(500), working: true },
      place5: { amount: 0n, working: false },
      place6: { amount: 0n, working: false },
      place8: { amount: 0n, working: false },
      place9: { amount: 0n, working: false },
      place10: { amount: 0n, working: false },
      hard4: { amount: usd(100) },
      hard6: { amount: 0n },
      hard8: { amount: 0n },
      hard10: { amount: 0n },
      oneRolls: {
        field: usd(500),
        any7: 0n,
        anyCraps: 0n,
        craps2: 0n,
        craps3: 0n,
        yo: 0n,
        twelve: 0n,
        horn: 0n
      }
    };

    expect(await harness.maxPossiblePayout(bets, 4)).to.equal(usd(19_600));
  });

  it("reserves the full 19.6k worst-case amount on a live roll request", async function () {
    const [owner, alice] = await ethers.getSigners();
    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
    const gameFactory = await ethers.getContractFactory("CrapsGameWorstCaseHarness");

    const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
    const coordinator = await coordinatorFactory.deploy();
    const game = await gameFactory.deploy(await token.getAddress(), await coordinator.getAddress(), true);

    await token.connect(owner).mint(owner.address, usd(1_000_000));
    await token.connect(alice).mint(alice.address, usd(1_000_000));
    await token.connect(owner).approve(await game.getAddress(), ethers.MaxUint256);
    await token.connect(alice).approve(await game.getAddress(), ethers.MaxUint256);

    await coordinator.createSubscription();
    await coordinator.addConsumer(1, await game.getAddress());

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(20_000));
    await game.connect(alice).openSession();
    await game.exposedSeedPointFourWorstCase(alice.address);

    await expect(game.connect(alice).rollDice())
      .to.emit(game, "RollRequested")
      .withArgs(alice.address, 1n, usd(19_600));

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(state.point).to.equal(4n);
    expect(state.reserved).to.equal(usd(19_600));
    expect(state.pendingRequestId).to.equal(1n);

    await game.exposedAssertInvariant();
  });
});
