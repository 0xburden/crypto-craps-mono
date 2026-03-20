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

const PASS_ODDS_PAYOUT: Record<number, bigint> = {
  4: usd(600),
  5: usd(450),
  6: usd(360),
  8: usd(360),
  9: usd(450),
  10: usd(600)
};

const DONT_PASS_ODDS_PAYOUT: Record<number, bigint> = {
  4: usd(150),
  5: usd(200),
  6: usd(250),
  8: usd(250),
  9: usd(200),
  10: usd(150)
};

describe("OddsBets", function () {
  async function establishPoint(point: number, lineBetType: number) {
    const fixture = await loadFixture(deployGameFixture);
    const { owner, alice, coordinator, game } = fixture;

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(lineBetType, usd(100));
    await rollAndFulfill(game, coordinator, alice, ...POINT_DICE[point]);

    return fixture;
  }

  it("only allows line odds after a point is established and enforces caps and multiples", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameFixture);

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(100));
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(100));

    await expect(game.connect(alice).placeBet(BetType.PASS_LINE_ODDS, usd(300)))
      .to.be.revertedWithCustomError(game, "BetUnavailable");
    await expect(game.connect(alice).placeBet(BetType.DONT_PASS_ODDS, usd(300)))
      .to.be.revertedWithCustomError(game, "BetUnavailable");

    await rollAndFulfill(game, coordinator, alice, ...POINT_DICE[5]);

    await expect(game.connect(alice).placeBet(BetType.PASS_LINE_ODDS, usd(302)))
      .to.be.revertedWithCustomError(game, "InvalidAmount");
    await expect(game.connect(alice).placeBet(BetType.PASS_LINE_ODDS, usd(299) + 1n))
      .to.be.revertedWithCustomError(game, "InvalidMultiple");
    await expect(game.connect(alice).placeBet(BetType.DONT_PASS_ODDS, usd(302)))
      .to.be.revertedWithCustomError(game, "InvalidAmount");
    await expect(game.connect(alice).placeBet(BetType.DONT_PASS_ODDS, usd(299) + 2n))
      .to.be.revertedWithCustomError(game, "InvalidMultiple");
  });

  it("pays pass line odds at true odds for all six points", async function () {
    for (const point of [4, 5, 6, 8, 9, 10]) {
      const { alice, coordinator, game } = await establishPoint(point, BetType.PASS_LINE);

      const initialAvailable = (await game.getPlayerState(alice.address)).available;
      expect(initialAvailable).to.equal(usd(9_850));

      await game.connect(alice).placeBet(BetType.PASS_LINE_ODDS, usd(300));
      await rollAndFulfill(game, coordinator, alice, ...POINT_DICE[point]);

      const state = await game.getPlayerState(alice.address);
      expect(state.phase).to.equal(SessionPhase.COME_OUT);
      expect(state.point).to.equal(0n);
      expect(state.bets.passLine.amount).to.equal(0n);
      expect(state.bets.passLine.oddsAmount).to.equal(0n);
      expect(state.available).to.equal(usd(9_950) + usd(100) + PASS_ODDS_PAYOUT[point]);
      expect(state.inPlay).to.equal(0n);
      expect(state.reserved).to.equal(0n);

      await assertInvariant(game, [alice]);
    }
  });

  it("pays don't pass odds at true odds on a seven-out for all six points", async function () {
    for (const point of [4, 5, 6, 8, 9, 10]) {
      const { alice, coordinator, game } = await establishPoint(point, BetType.DONT_PASS);

      await game.connect(alice).placeBet(BetType.DONT_PASS_ODDS, usd(300));
      await rollAndFulfill(game, coordinator, alice, 3, 4);

      const state = await game.getPlayerState(alice.address);
      expect(state.phase).to.equal(SessionPhase.COME_OUT);
      expect(state.point).to.equal(0n);
      expect(state.bets.dontPass.amount).to.equal(0n);
      expect(state.bets.dontPass.oddsAmount).to.equal(0n);
      expect(state.available).to.equal(usd(9_950) + usd(100) + DONT_PASS_ODDS_PAYOUT[point]);
      expect(state.inPlay).to.equal(0n);
      expect(state.reserved).to.equal(0n);

      await assertInvariant(game, [alice]);
    }
  });

  it("allows pass and don't pass odds to be removed independently of the flat bet", async function () {
    const { alice, game } = await establishPoint(6, BetType.PASS_LINE);

    await game.connect(alice).placeBet(BetType.PASS_LINE_ODDS, usd(300));
    await expect(game.connect(alice).removeBet(BetType.PASS_LINE_ODDS))
      .to.emit(game, "BetRemoved")
      .withArgs(alice.address, BetType.PASS_LINE_ODDS, usd(300));

    let state = await game.getPlayerState(alice.address);
    expect(state.bets.passLine.amount).to.equal(usd(100));
    expect(state.bets.passLine.oddsAmount).to.equal(0n);
    expect(state.available).to.equal(usd(9_850));

    await expect(game.connect(alice).removeBet(BetType.PASS_LINE_ODDS))
      .to.be.revertedWithCustomError(game, "NoActiveBet");

    const fixture = await establishPoint(8, BetType.DONT_PASS);
    await fixture.game.connect(fixture.alice).placeBet(BetType.DONT_PASS_ODDS, usd(300));
    await expect(fixture.game.connect(fixture.alice).removeBet(BetType.DONT_PASS_ODDS))
      .to.emit(fixture.game, "BetRemoved")
      .withArgs(fixture.alice.address, BetType.DONT_PASS_ODDS, usd(300));

    state = await fixture.game.getPlayerState(fixture.alice.address);
    expect(state.bets.dontPass.amount).to.equal(usd(100));
    expect(state.bets.dontPass.oddsAmount).to.equal(0n);
    expect(state.available).to.equal(usd(9_850));
  });
});
