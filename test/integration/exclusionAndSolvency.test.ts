import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import {
  BetType,
  SessionPhase,
  rollAndFulfill,
  usd
} from "../unit/helpers/gameFixture";

async function deployIntegrationFixture() {
  const [owner, alice, bob] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory("MockERC20");
  const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
  const gameFactory = await ethers.getContractFactory("CrapsGame");

  const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
  const coordinator = await coordinatorFactory.deploy();
  const game = await gameFactory.deploy(
    await token.getAddress(),
    await coordinator.getAddress(),
    1n,
    ethers.ZeroHash,
    true
  );

  const richAmount = usd(1_000_000);
  for (const signer of [owner, alice, bob]) {
    await token.connect(signer).mint(signer.address, richAmount);
    await token.connect(signer).approve(await game.getAddress(), ethers.MaxUint256);
  }

  await coordinator.createSubscription();
  await coordinator.addConsumer(1, await game.getAddress());

  return { owner, alice, bob, token, coordinator, game };
}

async function loadMaxExposureSession() {
  const fixture = await loadFixture(deployIntegrationFixture);
  const { owner, alice, game, coordinator } = fixture;

  await game.connect(owner).fundBankroll(usd(20_000));
  await game.connect(alice).deposit(usd(30_000));
  await game.connect(alice).openSession();

  await game.connect(alice).placeBet(BetType.PASS_LINE, usd(500));
  await game.connect(alice).placeBet(BetType.DONT_PASS, usd(500));

  await rollAndFulfill(game, coordinator, alice, 2, 3);

  await game.connect(alice).placeBet(BetType.PASS_LINE_ODDS, usd(1_500));
  await game.connect(alice).placeBet(BetType.DONT_PASS_ODDS, usd(1_500));

  for (let i = 0; i < 4; i += 1) {
    await game.connect(alice).placeBet(BetType.COME, usd(500));
    await game.connect(alice).placeBet(BetType.DONT_COME, usd(500));
  }

  await rollAndFulfill(game, coordinator, alice, 1, 3);

  for (let i = 0; i < 4; i += 1) {
    await game.connect(alice).placeIndexedBet(BetType.COME_ODDS, i, usd(1_500));
    await game.connect(alice).placeIndexedBet(BetType.DONT_COME_ODDS, i, usd(1_500));
  }

  await game.connect(alice).placeBet(BetType.PLACE_4, usd(500));
  await game.connect(alice).placeBet(BetType.PLACE_5, usd(500));
  await game.connect(alice).placeBet(BetType.PLACE_6, usd(498));
  await game.connect(alice).placeBet(BetType.PLACE_8, usd(498));
  await game.connect(alice).placeBet(BetType.PLACE_9, usd(500));
  await game.connect(alice).placeBet(BetType.PLACE_10, usd(500));

  await game.connect(alice).placeBet(BetType.HARD_4, usd(100));
  await game.connect(alice).placeBet(BetType.HARD_6, usd(100));
  await game.connect(alice).placeBet(BetType.HARD_8, usd(100));
  await game.connect(alice).placeBet(BetType.HARD_10, usd(100));

  await game.connect(alice).placeBet(BetType.FIELD, usd(500));
  await game.connect(alice).placeBet(BetType.ANY_7, usd(100));
  await game.connect(alice).placeBet(BetType.ANY_CRAPS, usd(100));
  await game.connect(alice).placeBet(BetType.CRAPS_2, usd(100));
  await game.connect(alice).placeBet(BetType.CRAPS_3, usd(100));
  await game.connect(alice).placeBet(BetType.YO, usd(100));
  await game.connect(alice).placeBet(BetType.TWELVE, usd(100));
  await game.connect(alice).placeBet(BetType.HORN, usd(100));

  await game.connect(owner).pause();
  await game.connect(owner).withdrawBankroll(usd(19_500));
  await game.connect(owner).unpause();

  return fixture;
}

describe("Integration: solvency and exclusion flows", function () {
  it("reverts rollDice with InsufficientBankroll on a max-loaded session", async function () {
    const { alice, game } = await loadFixture(loadMaxExposureSession);

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.point).to.equal(5n);
    expect(state.inPlay).to.be.greaterThan(0n);

    await expect(game.connect(alice).rollDice()).to.be.revertedWithCustomError(game, "InsufficientBankroll");

    const after = await game.getPlayerState(alice.address);
    expect(after.phase).to.equal(state.phase);
    expect(after.point).to.equal(state.point);
    expect(after.pendingRequestId).to.equal(0n);
  });

  it("runs the self-exclusion lifecycle end-to-end", async function () {
    const { alice, game, token } = await loadFixture(deployIntegrationFixture);

    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    await expect(game.connect(alice).selfExclude()).to.emit(game, "SelfExcluded").withArgs(alice.address);

    const excludedState = await game.getPlayerState(alice.address);
    expect(excludedState.selfExcluded).to.equal(true);
    expect(excludedState.phase).to.equal(SessionPhase.INACTIVE);
    expect(excludedState.available).to.equal(usd(99_5) / 10n);
    expect(excludedState.inPlay).to.equal(0n);

    await expect(game.connect(alice).placeBet(BetType.FIELD, usd(1))).to.be.revertedWithCustomError(
      game,
      "PlayerExcluded"
    );
    await expect(game.connect(alice).openSession()).to.be.revertedWithCustomError(game, "PlayerExcluded");

    const balanceBefore = await token.balanceOf(alice.address);
    await expect(game.connect(alice).withdraw(usd(20))).to.emit(game, "Withdrawal").withArgs(alice.address, usd(20));
    expect(await token.balanceOf(alice.address)).to.equal(balanceBefore + usd(20));

    await expect(game.connect(alice).requestSelfReinstatement()).to.emit(game, "SelfReinstatementRequested");

    const eligibleAt = await game.reinstatementEligibleAt(alice.address);
    await time.increaseTo(eligibleAt);

    await expect(game.connect(alice).completeSelfReinstatement())
      .to.emit(game, "SelfReinstated")
      .withArgs(alice.address);

    const reinstatedState = await game.getPlayerState(alice.address);
    expect(reinstatedState.selfExcluded).to.equal(false);
    expect(reinstatedState.reinstatementEligibleAt).to.equal(0n);

    await expect(game.connect(alice).openSession()).to.emit(game, "SessionOpened").withArgs(alice.address);
  });

  it("runs the operator exclusion flow end-to-end", async function () {
    const { owner, alice, game, token } = await loadFixture(deployIntegrationFixture);

    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(10));

    await expect(game.connect(owner).operatorExclude(alice.address))
      .to.emit(game, "OperatorExcluded")
      .withArgs(alice.address);

    const excludedState = await game.getPlayerState(alice.address);
    expect(excludedState.operatorExcluded).to.equal(true);
    expect(excludedState.phase).to.equal(SessionPhase.INACTIVE);
    expect(excludedState.available).to.equal(usd(99_5) / 10n);

    await expect(game.connect(alice).deposit(usd(1))).to.be.revertedWithCustomError(game, "PlayerExcluded");
    await expect(game.connect(alice).openSession()).to.be.revertedWithCustomError(game, "PlayerExcluded");

    const balanceBefore = await token.balanceOf(alice.address);
    await game.connect(alice).withdraw(usd(25));
    expect(await token.balanceOf(alice.address)).to.equal(balanceBefore + usd(25));

    await expect(game.connect(owner).operatorReinstate(alice.address))
      .to.emit(game, "OperatorReinstated")
      .withArgs(alice.address);

    const reinstatedState = await game.getPlayerState(alice.address);
    expect(reinstatedState.operatorExcluded).to.equal(false);

    await expect(game.connect(alice).openSession()).to.emit(game, "SessionOpened").withArgs(alice.address);
  });
});
