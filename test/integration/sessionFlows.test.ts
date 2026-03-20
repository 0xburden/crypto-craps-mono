import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { BetType, SessionPhase, PuckState, usd } from "../unit/helpers/gameFixture";

const DEPOSIT_AMOUNT = usd(500);
const FIELD_BET = usd(5);
const INITIAL_BANKROLL = usd(20_000);
const SESSION_TIMEOUT_SECONDS = 24 * 60 * 60;

function encodeDice(die1: number, die2: number) {
  const high = BigInt(die2 - 1);
  const low = (BigInt(die1 - 1) - ((high << 8n) % 6n) + 6n) % 6n;
  return low | (high << 8n);
}

async function deployIntegrationFixture() {
  const [owner, alice, bob, treasury] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory("MockERC20");
  const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
  const gameFactory = await ethers.getContractFactory("CrapsGame");

  const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
  const coordinator = await coordinatorFactory.deploy();
  const game = await gameFactory.deploy(await token.getAddress(), await coordinator.getAddress(), 1, ethers.ZeroHash, true);

  const richAmount = usd(1_000_000);
  for (const signer of [owner, alice, bob, treasury]) {
    await token.connect(signer).mint(signer.address, richAmount);
    await token.connect(signer).approve(await game.getAddress(), ethers.MaxUint256);
  }

  await coordinator.connect(owner).createSubscription();
  await coordinator.connect(owner).addConsumer(1, await game.getAddress());
  await game.connect(owner).fundBankroll(INITIAL_BANKROLL);

  return { owner, alice, bob, treasury, token, coordinator, game };
}

describe("Integration / Session flows", function () {
  it("happy path: deposit, play 10 deterministic rounds, then close and withdraw", async function () {
    const { alice, coordinator, game, token } = await loadFixture(deployIntegrationFixture);

    const aliceStart = await token.balanceOf(alice.address);
    await game.connect(alice).deposit(DEPOSIT_AMOUNT);
    await game.connect(alice).openSession();

    let expectedAvailable = DEPOSIT_AMOUNT - DEPOSIT_AMOUNT / 200n;
    const expectedBankrollStart = INITIAL_BANKROLL;

    const rolls: Array<[number, number, bigint]> = [
      [3, 4, 0n],
      [1, 1, FIELD_BET * 3n],
      [1, 2, FIELD_BET * 2n],
      [5, 6, FIELD_BET * 2n],
      [6, 6, FIELD_BET * 3n],
      [2, 5, 0n],
      [1, 1, FIELD_BET * 3n],
      [1, 2, FIELD_BET * 2n],
      [5, 6, FIELD_BET * 2n],
      [6, 6, FIELD_BET * 3n]
    ];

    for (const [die1, die2, delta] of rolls) {
      await game.connect(alice).placeBet(BetType.FIELD, FIELD_BET);
      expectedAvailable -= FIELD_BET;

      const preRollState = await game.getPlayerState(alice.address);
      expect(preRollState.phase).to.equal(SessionPhase.COME_OUT);
      expect(preRollState.puckState).to.equal(PuckState.OFF);

      await game.connect(alice).rollDice();
      const pendingState = await game.getPlayerState(alice.address);
      expect(pendingState.phase).to.equal(SessionPhase.ROLL_PENDING);
      expect(pendingState.pendingRequestId).to.not.equal(0n);

      await coordinator.fulfillRandomWords(pendingState.pendingRequestId, [encodeDice(die1, die2)]);

      expectedAvailable += delta;
      const state = await game.getPlayerState(alice.address);
      expect(state.phase).to.equal(SessionPhase.COME_OUT);
      expect(state.puckState).to.equal(PuckState.OFF);
      expect(state.available).to.equal(expectedAvailable);
      expect(state.inPlay).to.equal(0n);
      expect(state.reserved).to.equal(0n);
    }

    const postPlayState = await game.getPlayerState(alice.address);
    expect(postPlayState.accruedFees).to.equal(DEPOSIT_AMOUNT / 200n);
    expect(postPlayState.bankroll).to.equal(expectedBankrollStart - usd(50));

    await game.connect(alice).closeSession();
    const closedState = await game.getPlayerState(alice.address);
    expect(closedState.phase).to.equal(SessionPhase.INACTIVE);
    expect(closedState.inPlay).to.equal(0n);

    const withdrawAmount = closedState.available;
    await expect(game.connect(alice).withdraw(withdrawAmount)).to.emit(game, "Withdrawal").withArgs(alice.address, withdrawAmount);

    expect(await token.balanceOf(alice.address)).to.equal(aliceStart - DEPOSIT_AMOUNT + withdrawAmount);
    const withdrawnState = await game.getPlayerState(alice.address);
    expect(withdrawnState.available).to.equal(0n);
    expect(withdrawnState.accruedFees).to.equal(DEPOSIT_AMOUNT / 200n);
  });

  it("expires an active session during play and returns in-play funds to available", async function () {
    const { alice, bob, game, token } = await loadFixture(deployIntegrationFixture);

    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.FIELD, FIELD_BET);
    await game.connect(alice).placeBet(BetType.FIELD, FIELD_BET);

    const beforeExpiry = await game.getPlayerState(alice.address);
    expect(beforeExpiry.inPlay).to.equal(FIELD_BET * 2n);
    expect(beforeExpiry.available).to.equal(usd(100) - usd(100) / 200n - FIELD_BET * 2n);

    await time.increase(SESSION_TIMEOUT_SECONDS + 1);

    await expect(game.connect(bob).expireSession(alice.address))
      .to.emit(game, "SessionExpired")
      .withArgs(alice.address, FIELD_BET * 2n);

    const afterExpiry = await game.getPlayerState(alice.address);
    expect(afterExpiry.phase).to.equal(SessionPhase.INACTIVE);
    expect(afterExpiry.inPlay).to.equal(0n);
    expect(afterExpiry.available).to.equal(usd(100) - usd(100) / 200n);

    const balanceBefore = await token.balanceOf(alice.address);
    await game.connect(alice).withdraw(afterExpiry.available);
    expect(await token.balanceOf(alice.address)).to.equal(balanceBefore + afterExpiry.available);
  });

  it("expires a ROLL_PENDING session, releases the reserve, and ignores the late callback", async function () {
    const { alice, bob, coordinator, game } = await loadFixture(deployIntegrationFixture);

    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.FIELD, FIELD_BET);
    await game.connect(alice).rollDice();

    const pendingState = await game.getPlayerState(alice.address);
    const requestId = pendingState.pendingRequestId;

    expect(pendingState.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(pendingState.reserved).to.equal(FIELD_BET * 2n);
    expect(pendingState.bankroll).to.equal(INITIAL_BANKROLL - FIELD_BET * 2n);

    await time.increase(SESSION_TIMEOUT_SECONDS + 1);

    await expect(game.connect(bob).expireSession(alice.address))
      .to.emit(game, "SessionExpired")
      .withArgs(alice.address, FIELD_BET);

    const expiredState = await game.getPlayerState(alice.address);
    expect(expiredState.phase).to.equal(SessionPhase.INACTIVE);
    expect(expiredState.reserved).to.equal(0n);
    expect(expiredState.pendingRequestId).to.equal(0n);
    expect(expiredState.available).to.equal(usd(100) - usd(100) / 200n);
    expect(expiredState.bankroll).to.equal(INITIAL_BANKROLL);

    const beforeLateCallback = await game.getPlayerState(alice.address);
    await coordinator.fulfillRandomWords(requestId, [encodeDice(6, 1)]);
    const afterLateCallback = await game.getPlayerState(alice.address);

    expect(afterLateCallback.phase).to.equal(beforeLateCallback.phase);
    expect(afterLateCallback.available).to.equal(beforeLateCallback.available);
    expect(afterLateCallback.inPlay).to.equal(beforeLateCallback.inPlay);
    expect(afterLateCallback.reserved).to.equal(beforeLateCallback.reserved);
    expect(afterLateCallback.pendingRequestId).to.equal(beforeLateCallback.pendingRequestId);
  });
});
