import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { BetType, SessionPhase, assertInvariant, deployGameFixture, rollAndFulfill, usd } from "./helpers/gameFixture";

const POINT_DICE: Record<number, [number, number]> = {
  4: [1, 3],
  5: [2, 3],
  6: [2, 4],
  8: [3, 5],
  9: [4, 5],
  10: [4, 6]
};

describe("PlaceBets", function () {
  async function enterPointAndClearLine(point = 5) {
    const fixture = await loadFixture(deployGameFixture);
    const { owner, alice, coordinator, game } = fixture;

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(100));
    await rollAndFulfill(game, coordinator, alice, ...POINT_DICE[point]);
    await game.connect(alice).removeBet(BetType.DONT_PASS);

    return fixture;
  }

  it("requires the puck to be on and enforces the correct place-bet multiples", async function () {
    const { owner, alice, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).openSession();

    await expect(game.connect(alice).placeBet(BetType.PLACE_4, usd(100)))
      .to.be.revertedWithCustomError(game, "BetUnavailable");

    const fixture = await enterPointAndClearLine(6);
    await expect(fixture.game.connect(fixture.alice).placeBet(BetType.PLACE_4, usd(100) + 1n))
      .to.be.revertedWithCustomError(fixture.game, "InvalidMultiple");
    await expect(fixture.game.connect(fixture.alice).placeBet(BetType.PLACE_6, usd(96) + 1n))
      .to.be.revertedWithCustomError(fixture.game, "InvalidMultiple");
  });

  it("pays the correct place-bet multiples and leaves winning bets up", async function () {
    const cases: Array<[number, number, bigint, bigint]> = [
      [BetType.PLACE_4, 4, usd(100), usd(180)],
      [BetType.PLACE_5, 5, usd(100), usd(140)],
      [BetType.PLACE_6, 6, usd(120), usd(140)],
      [BetType.PLACE_8, 8, usd(120), usd(140)],
      [BetType.PLACE_9, 9, usd(100), usd(140)],
      [BetType.PLACE_10, 10, usd(100), usd(180)]
    ];

    for (const [betType, hitNumber, amount, expectedPayout] of cases) {
      const mainPoint = hitNumber === 5 ? 6 : 5;
      const { alice, coordinator, game } = await enterPointAndClearLine(mainPoint);

      await game.connect(alice).placeBet(betType, amount);
      await rollAndFulfill(game, coordinator, alice, ...POINT_DICE[hitNumber]);

      const state = await game.getPlayerState(alice.address);
      expect(state.phase).to.equal(SessionPhase.POINT);
      expect(state.point).to.equal(BigInt(mainPoint));
      expect(state.available).to.equal(usd(9_950) - amount + expectedPayout);
      expect(state.inPlay).to.equal(amount);

      if (betType === BetType.PLACE_4) expect(state.bets.place4.amount).to.equal(amount);
      if (betType === BetType.PLACE_5) expect(state.bets.place5.amount).to.equal(amount);
      if (betType === BetType.PLACE_6) expect(state.bets.place6.amount).to.equal(amount);
      if (betType === BetType.PLACE_8) expect(state.bets.place8.amount).to.equal(amount);
      if (betType === BetType.PLACE_9) expect(state.bets.place9.amount).to.equal(amount);
      if (betType === BetType.PLACE_10) expect(state.bets.place10.amount).to.equal(amount);

      await assertInvariant(game, [alice]);
    }
  });

  it("supports place working toggles without removing funds from play", async function () {
    const { alice, coordinator, game } = await enterPointAndClearLine(5);

    await game.connect(alice).placeBet(BetType.PLACE_4, usd(100));
    await game.connect(alice).setPlaceWorking(4, false);
    await rollAndFulfill(game, coordinator, alice, 1, 3);

    let state = await game.getPlayerState(alice.address);
    expect(state.available).to.equal(usd(9_850));
    expect(state.inPlay).to.equal(usd(100));
    expect(state.bets.place4.amount).to.equal(usd(100));
    expect(state.bets.place4.working).to.equal(false);

    await game.connect(alice).setPlaceWorking(4, true);
    await rollAndFulfill(game, coordinator, alice, 1, 3);

    state = await game.getPlayerState(alice.address);
    expect(state.available).to.equal(usd(10_030));
    expect(state.inPlay).to.equal(usd(100));
    expect(state.bets.place4.working).to.equal(true);
  });

  it("sweeps all place bets on any seven, including OFF bets that survive into come-out", async function () {
    const { alice, coordinator, game } = await enterPointAndClearLine(5);

    await game.connect(alice).placeBet(BetType.PLACE_4, usd(100));
    await game.connect(alice).placeBet(BetType.PLACE_6, usd(120));
    await game.connect(alice).setPlaceWorking(6, false);

    await rollAndFulfill(game, coordinator, alice, ...POINT_DICE[5]);

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.bets.place4.amount).to.equal(usd(100));
    expect(state.bets.place6.amount).to.equal(usd(120));
    expect(state.bets.place6.working).to.equal(false);

    await game.connect(alice).setPlaceWorking(4, false);
    await rollAndFulfill(game, coordinator, alice, 3, 4);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.available).to.equal(usd(9_730));
    expect(state.inPlay).to.equal(0n);
    expect(state.bets.place4.amount).to.equal(0n);
    expect(state.bets.place6.amount).to.equal(0n);
  });
});
