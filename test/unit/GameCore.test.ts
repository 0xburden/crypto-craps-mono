import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { BetType, PuckState, SessionPhase, deployGameFixture, rollAndFulfill, usd } from "./helpers/gameFixture";

describe("GameCore", function () {
  it("resolves a come-out natural with Pass Line winning and Don't Pass losing", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(10));

    await rollAndFulfill(game, coordinator, alice, 6, 1);

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.puckState).to.equal(PuckState.OFF);
    expect(state.point).to.equal(0n);
    expect(state.available).to.equal(usd(99_5) / 10n);
    expect(state.inPlay).to.equal(0n);
    expect(state.reserved).to.equal(0n);
    expect(state.bets.passLine.amount).to.equal(0n);
    expect(state.bets.dontPass.amount).to.equal(0n);
    expect(await game.bankroll()).to.equal(usd(20_000));

    await game.exposedAssertInvariant();
  });

  it("resolves come-out craps with Pass Line losing, Don't Pass winning on 2/3, and pushing on 12", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(10));

    await rollAndFulfill(game, coordinator, alice, 1, 2);

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.available).to.equal(usd(99_5) / 10n);
    expect(state.bets.passLine.amount).to.equal(0n);
    expect(state.bets.dontPass.amount).to.equal(0n);

    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(10));

    await rollAndFulfill(game, coordinator, alice, 6, 6);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.available).to.equal(usd(79_5) / 10n);
    expect(state.inPlay).to.equal(usd(10));
    expect(state.bets.passLine.amount).to.equal(0n);
    expect(state.bets.dontPass.amount).to.equal(usd(10));
    expect(state.bets.dontPass.point).to.equal(0n);

    await game.exposedAssertInvariant();
  });

  it("establishes a point and then pays Pass Line when the point is hit", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    await rollAndFulfill(game, coordinator, alice, 3, 1);

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.puckState).to.equal(PuckState.ON);
    expect(state.point).to.equal(4n);
    expect(state.inPlay).to.equal(usd(10));
    expect(state.bets.passLine.amount).to.equal(usd(10));
    expect(state.bets.passLine.point).to.equal(4n);

    await rollAndFulfill(game, coordinator, alice, 2, 2);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.puckState).to.equal(PuckState.OFF);
    expect(state.point).to.equal(0n);
    expect(state.available).to.equal(usd(109_5) / 10n);
    expect(state.inPlay).to.equal(0n);
    expect(state.bets.passLine.amount).to.equal(0n);

    await game.exposedAssertInvariant();
  });

  it("seven-out during the point phase makes Pass Line lose and Don't Pass win", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(10));

    await rollAndFulfill(game, coordinator, alice, 2, 3);

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.point).to.equal(5n);
    expect(state.inPlay).to.equal(usd(20));

    await rollAndFulfill(game, coordinator, alice, 6, 1);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.point).to.equal(0n);
    expect(state.available).to.equal(usd(99_5) / 10n);
    expect(state.inPlay).to.equal(0n);
    expect(state.bets.passLine.amount).to.equal(0n);
    expect(state.bets.dontPass.amount).to.equal(0n);

    await game.exposedAssertInvariant();
  });

  it("resolves Field wins, double wins on 2/12, and losses on 5/6/7/8", async function () {
    const cases: Array<[number, number, number, bigint]> = [
      [2, 1, 1, usd(119_5) / 10n],
      [3, 1, 2, usd(109_5) / 10n],
      [4, 1, 3, usd(109_5) / 10n],
      [9, 4, 5, usd(109_5) / 10n],
      [10, 4, 6, usd(109_5) / 10n],
      [11, 5, 6, usd(109_5) / 10n],
      [5, 2, 3, usd(89_5) / 10n],
      [6, 3, 3, usd(89_5) / 10n],
      [7, 1, 6, usd(89_5) / 10n],
      [8, 3, 5, usd(89_5) / 10n],
      [12, 6, 6, usd(119_5) / 10n]
    ];

    for (const [, die1, die2, expectedAvailable] of cases) {
      const { owner, alice, coordinator, game } = await loadFixture(deployGameFixture);

      await game.connect(owner).fundBankroll(usd(20_000));
      await game.connect(alice).deposit(usd(100));
      await game.connect(alice).openSession();
      await game.connect(alice).placeBet(BetType.FIELD, usd(10));

      await rollAndFulfill(game, coordinator, alice, die1, die2);

      const state = await game.getPlayerState(alice.address);
      expect(state.available).to.equal(expectedAvailable);
      expect(state.inPlay).to.equal(0n);
      expect(state.bets.oneRolls.field).to.equal(0n);
      expect(state.reserved).to.equal(0n);
    }
  });

  it("reserves the worst-case payout before a roll and releases it afterward", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.FIELD, usd(10));

    await expect(game.connect(alice).rollDice()).to.emit(game, "RollRequested").withArgs(alice.address, 1n, usd(20));

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(state.reserved).to.equal(usd(20));
    expect(await game.bankroll()).to.equal(usd(19_980));

    await coordinator.fulfillRandomWords(state.pendingRequestId, [0n]);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.reserved).to.equal(0n);
    expect(await game.bankroll()).to.equal(usd(19_980));
    expect(state.available).to.equal(usd(119_5) / 10n);

    await game.exposedAssertInvariant();
  });

  it("reverts rollDice with InsufficientBankroll when the reserve requirement exceeds bankroll", async function () {
    const { owner, alice, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(5));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    await expect(game.connect(alice).rollDice()).to.be.revertedWithCustomError(game, "InsufficientBankroll");
  });

  it("getPlayerState reflects inactive, come-out, roll-pending, point, and post-resolution states", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameFixture);

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.INACTIVE);
    expect(state.puckState).to.equal(PuckState.OFF);

    await game.connect(owner).fundBankroll(usd(20_000));
    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.puckState).to.equal(PuckState.OFF);
    expect(state.available).to.equal(usd(89_5) / 10n);
    expect(state.inPlay).to.equal(usd(10));

    await game.connect(alice).rollDice();

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.ROLL_PENDING);
    expect(state.pendingRequestId).to.equal(1n);
    expect(state.reserved).to.equal(usd(10));

    await coordinator.fulfillRandomWords(state.pendingRequestId, [2n | (0n << 8n)]);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.puckState).to.equal(PuckState.ON);
    expect(state.point).to.equal(4n);
    expect(state.pendingRequestId).to.equal(0n);
    expect(state.reserved).to.equal(0n);
    expect(state.bets.passLine.amount).to.equal(usd(10));

    await rollAndFulfill(game, coordinator, alice, 2, 2);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.puckState).to.equal(PuckState.OFF);
    expect(state.point).to.equal(0n);
    expect(state.available).to.equal(usd(109_5) / 10n);
    expect(state.inPlay).to.equal(0n);
  });
});
