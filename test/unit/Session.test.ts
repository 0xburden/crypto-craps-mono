import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { BetType, SessionPhase, deployGameFixture, encodeDice, usd } from "./helpers/gameFixture";

describe("Session", function () {
  it("opens a session and prevents opening a second active session", async function () {
    const { alice, game } = await loadFixture(deployGameFixture);

    const before = await time.latest();

    await expect(game.connect(alice).openSession()).to.emit(game, "SessionOpened").withArgs(alice.address);

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.point).to.equal(0n);
    expect(state.pendingRequestId).to.equal(0n);
    expect(state.lastActivityTime).to.be.greaterThanOrEqual(BigInt(before));
    expect(await game.activeSessions()).to.equal(1n);

    await expect(game.connect(alice).openSession()).to.be.revertedWithCustomError(game, "SessionAlreadyActive");
  });

  it("closes an active non-pending session and returns in-play funds to available", async function () {
    const { alice, game } = await loadFixture(deployGameFixture);

    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    await expect(game.connect(alice).closeSession()).to.emit(game, "SessionClosed").withArgs(alice.address, usd(10));

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.INACTIVE);
    expect(state.inPlay).to.equal(0n);
    expect(state.available).to.equal(usd(99_5) / 10n);
    expect(state.bets.passLine.amount).to.equal(0n);
    expect(await game.activeSessions()).to.equal(0n);

    await game.exposedAssertInvariant();
  });

  it("expires an active session and returns bets to available", async function () {
    const { alice, bob, game } = await loadFixture(deployGameFixture);

    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));
    await game.connect(alice).placeBet(BetType.FIELD, usd(5));

    await time.increase(24 * 60 * 60 + 1);

    await expect(game.connect(bob).expireSession(alice.address))
      .to.emit(game, "SessionExpired")
      .withArgs(alice.address, usd(15));

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.INACTIVE);
    expect(state.available).to.equal(usd(99_5) / 10n);
    expect(state.inPlay).to.equal(0n);
    expect(state.pendingRequestId).to.equal(0n);
    expect(state.bets.passLine.amount).to.equal(0n);
    expect(state.bets.oneRolls.field).to.equal(0n);
    expect(await game.activeSessions()).to.equal(0n);

    await game.exposedAssertInvariant();
  });

  it("expires a pending session, releases reserve, and clears the VRF request mapping", async function () {
    const { owner, alice, bob, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    await game.connect(alice).rollDice();
    const pendingState = await game.getPlayerState(alice.address);
    const requestId = pendingState.pendingRequestId;

    expect(pendingState.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(pendingState.reserved).to.equal(usd(10));
    expect(await game.bankroll()).to.equal(usd(19_990));

    await time.increase(24 * 60 * 60 + 1);

    await expect(game.connect(bob).expireSession(alice.address))
      .to.emit(game, "SessionExpired")
      .withArgs(alice.address, usd(10));

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.INACTIVE);
    expect(state.available).to.equal(usd(99_5) / 10n);
    expect(state.inPlay).to.equal(0n);
    expect(state.reserved).to.equal(0n);
    expect(state.pendingRequestId).to.equal(0n);
    expect(await game.bankroll()).to.equal(usd(20_000));
    expect(await game.requestToPlayer(requestId)).to.equal(ethers.ZeroAddress);

    await game.exposedAssertInvariant();
  });

  it("silently ignores a late VRF callback after session expiry", async function () {
    const { owner, alice, bob, coordinator, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    await game.connect(alice).rollDice();
    const pendingState = await game.getPlayerState(alice.address);
    const requestId = pendingState.pendingRequestId;

    await time.increase(24 * 60 * 60 + 1);
    await game.connect(bob).expireSession(alice.address);

    const before = await game.getPlayerState(alice.address);
    await coordinator.fulfillRandomWords(requestId, [encodeDice(6, 1)]);
    const after = await game.getPlayerState(alice.address);

    expect(after.phase).to.equal(before.phase);
    expect(after.available).to.equal(before.available);
    expect(after.inPlay).to.equal(before.inPlay);
    expect(after.reserved).to.equal(before.reserved);
    expect(after.pendingRequestId).to.equal(before.pendingRequestId);

    await game.exposedAssertInvariant();
  });
});
