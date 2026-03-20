import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { BetType, SessionPhase, encodeDice, usd } from "../unit/helpers/gameFixture";

const RICH_AMOUNT = usd(1_000_000);

async function deployIntegrationFixture() {
  const [owner, alice, bob, carol, treasury] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory("MockERC20");
  const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
  const gameFactory = await ethers.getContractFactory("CrapsGame");

  const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
  const coordinator = await coordinatorFactory.deploy();
  const game = await gameFactory.deploy(await token.getAddress(), await coordinator.getAddress(), 1, ethers.ZeroHash, true);

  for (const signer of [owner, alice, bob, carol]) {
    await token.connect(signer).mint(signer.address, RICH_AMOUNT);
    await token.connect(signer).approve(await game.getAddress(), ethers.MaxUint256);
  }

  await coordinator.createSubscription();
  await coordinator.addConsumer(1, await game.getAddress());

  return { owner, alice, bob, carol, treasury, token, coordinator, game };
}

async function assertFiveBucketInvariant(
  game: Awaited<ReturnType<typeof deployIntegrationFixture>>["game"],
  token: Awaited<ReturnType<typeof deployIntegrationFixture>>["token"],
  players: Array<Awaited<ReturnType<typeof ethers.getSigners>>[number]>
) {
  const states = await Promise.all(players.map((player) => game.getPlayerState(player.address)));

  let sumAvailable = 0n;
  let sumInPlay = 0n;
  let sumReserved = 0n;

  for (const state of states) {
    sumAvailable += state.available;
    sumInPlay += state.inPlay;
    sumReserved += state.reserved;
  }

  const contractBalance = await token.balanceOf(await game.getAddress());
  const { bankroll, accruedFees } = states[0];
  expect(contractBalance).to.equal(sumAvailable + sumInPlay + sumReserved + bankroll + accruedFees);
}

describe("Integration: multiplayer and pause", function () {
  it("handles three concurrent sessions with out-of-order VRF fulfillment and preserves isolation", async function () {
    const { owner, alice, bob, carol, token, coordinator, game } = await loadFixture(deployIntegrationFixture);

    await game.connect(owner).fundBankroll(usd(25_000));

    for (const player of [alice, bob, carol]) {
      await game.connect(player).deposit(usd(100));
      await game.connect(player).openSession();
    }

    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));
    await game.connect(bob).placeBet(BetType.DONT_PASS, usd(10));
    await game.connect(carol).placeBet(BetType.FIELD, usd(10));

    await game.connect(alice).rollDice();
    await game.connect(bob).rollDice();
    await game.connect(carol).rollDice();

    const alicePending = await game.getPlayerState(alice.address);
    const bobPending = await game.getPlayerState(bob.address);
    const carolPending = await game.getPlayerState(carol.address);

    expect(alicePending.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(bobPending.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(carolPending.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(alicePending.pendingRequestId).to.not.equal(bobPending.pendingRequestId);
    expect(alicePending.pendingRequestId).to.not.equal(carolPending.pendingRequestId);
    expect(bobPending.pendingRequestId).to.not.equal(carolPending.pendingRequestId);

    await assertFiveBucketInvariant(game, token, [alice, bob, carol]);

    const bobRequestId = bobPending.pendingRequestId;
    const carolRequestId = carolPending.pendingRequestId;
    const aliceRequestId = alicePending.pendingRequestId;

    await coordinator.fulfillRandomWords(bobRequestId, [encodeDice(2, 3)]);

    let aliceState = await game.getPlayerState(alice.address);
    let bobState = await game.getPlayerState(bob.address);
    let carolState = await game.getPlayerState(carol.address);

    expect(bobState.phase).to.equal(SessionPhase.POINT);
    expect(bobState.point).to.equal(5n);
    expect(bobState.pendingRequestId).to.equal(0n);
    expect(bobState.inPlay).to.equal(usd(10));
    expect(aliceState.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(aliceState.pendingRequestId).to.equal(aliceRequestId);
    expect(carolState.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(carolState.pendingRequestId).to.equal(carolRequestId);

    await assertFiveBucketInvariant(game, token, [alice, bob, carol]);

    await coordinator.fulfillRandomWords(carolRequestId, [encodeDice(1, 1)]);

    aliceState = await game.getPlayerState(alice.address);
    bobState = await game.getPlayerState(bob.address);
    carolState = await game.getPlayerState(carol.address);

    expect(carolState.phase).to.equal(SessionPhase.COME_OUT);
    expect(carolState.pendingRequestId).to.equal(0n);
    expect(carolState.inPlay).to.equal(0n);
    expect(aliceState.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(aliceState.pendingRequestId).to.equal(aliceRequestId);
    expect(bobState.phase).to.equal(SessionPhase.POINT);
    expect(bobState.point).to.equal(5n);

    await assertFiveBucketInvariant(game, token, [alice, bob, carol]);

    await coordinator.fulfillRandomWords(aliceRequestId, [encodeDice(6, 1)]);

    aliceState = await game.getPlayerState(alice.address);
    bobState = await game.getPlayerState(bob.address);
    carolState = await game.getPlayerState(carol.address);

    expect(aliceState.phase).to.equal(SessionPhase.COME_OUT);
    expect(aliceState.pendingRequestId).to.equal(0n);
    expect(aliceState.inPlay).to.equal(0n);
    expect(aliceState.reserved).to.equal(0n);
    expect(bobState.phase).to.equal(SessionPhase.POINT);
    expect(carolState.phase).to.equal(SessionPhase.COME_OUT);

    await assertFiveBucketInvariant(game, token, [alice, bob, carol]);
  });

  it("blocks gameplay while paused but still allows withdrawals, fees withdrawal, and bankroll recovery", async function () {
    const { owner, alice, treasury, token, game } = await loadFixture(deployIntegrationFixture);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(1_000));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    await game.connect(owner).pause();

    await expect(game.connect(alice).deposit(usd(10))).to.be.revertedWithCustomError(game, "EnforcedPause");
    await expect(game.connect(alice).placeBet(BetType.FIELD, usd(5))).to.be.revertedWithCustomError(game, "EnforcedPause");
    await expect(game.connect(alice).rollDice()).to.be.revertedWithCustomError(game, "EnforcedPause");

    const walletBeforeWithdraw = await token.balanceOf(alice.address);
    await expect(game.connect(alice).withdraw(usd(100))).to.not.be.reverted;
    expect(await token.balanceOf(alice.address)).to.equal(walletBeforeWithdraw + usd(100));

    const treasuryBeforeFees = await token.balanceOf(treasury.address);
    await expect(game.connect(owner).withdrawFees(treasury.address))
      .to.emit(game, "FeesWithdrawn")
      .withArgs(treasury.address, usd(5));
    expect(await token.balanceOf(treasury.address)).to.equal(treasuryBeforeFees + usd(5));
    expect((await game.getPlayerState(alice.address)).accruedFees).to.equal(0n);

    const ownerBeforeBankroll = await token.balanceOf(owner.address);
    await expect(game.connect(owner).withdrawBankroll(usd(5_000)))
      .to.emit(game, "BankrollWithdrawn")
      .withArgs(owner.address, usd(5_000));
    expect(await token.balanceOf(owner.address)).to.equal(ownerBeforeBankroll + usd(5_000));
    expect((await game.getPlayerState(alice.address)).bankroll).to.equal(usd(15_000));

    await assertFiveBucketInvariant(game, token, [alice]);
  });
});
