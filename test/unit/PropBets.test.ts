import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { BetType, SessionPhase, deployGameFixture, rollAndFulfill, usd } from "./helpers/gameFixture";

describe("PropBets", function () {
  async function fundedSession() {
    const fixture = await loadFixture(deployGameFixture);
    const { owner, alice, game } = fixture;

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).openSession();

    return fixture;
  }

  it("pays each one-roll prop correctly on a win", async function () {
    const cases: Array<[number, [number, number], bigint, bigint]> = [
      [BetType.ANY_7, [3, 4], usd(100), usd(10_350)],
      [BetType.ANY_CRAPS, [1, 1], usd(100), usd(10_650)],
      [BetType.CRAPS_2, [1, 1], usd(100), usd(12_950)],
      [BetType.CRAPS_3, [1, 2], usd(100), usd(11_450)],
      [BetType.YO, [5, 6], usd(100), usd(11_450)],
      [BetType.TWELVE, [6, 6], usd(100), usd(12_950)],
      [BetType.HORN, [1, 1], usd(100), usd(10_625)],
      [BetType.HORN, [5, 6], usd(100), usd(10_250)]
    ];

    for (const [betType, dice, amount, expectedAvailable] of cases) {
      const { alice, coordinator, game } = await fundedSession();

      await game.connect(alice).placeBet(betType, amount);
      await rollAndFulfill(game, coordinator, alice, ...dice);

      const state = await game.getPlayerState(alice.address);
      expect(state.phase).to.equal(SessionPhase.COME_OUT);
      expect(state.available).to.equal(expectedAvailable);
      expect(state.inPlay).to.equal(0n);
      expect(state.bets.oneRolls.any7).to.equal(0n);
      expect(state.bets.oneRolls.anyCraps).to.equal(0n);
      expect(state.bets.oneRolls.craps2).to.equal(0n);
      expect(state.bets.oneRolls.craps3).to.equal(0n);
      expect(state.bets.oneRolls.yo).to.equal(0n);
      expect(state.bets.oneRolls.twelve).to.equal(0n);
      expect(state.bets.oneRolls.horn).to.equal(0n);
    }
  });

  it("clears and loses each one-roll prop on a miss", async function () {
    const cases: Array<[number, [number, number], bigint]> = [
      [BetType.ANY_7, [1, 1], usd(100)],
      [BetType.ANY_CRAPS, [3, 4], usd(100)],
      [BetType.CRAPS_2, [1, 2], usd(100)],
      [BetType.CRAPS_3, [1, 1], usd(100)],
      [BetType.YO, [1, 1], usd(100)],
      [BetType.TWELVE, [5, 6], usd(100)],
      [BetType.HORN, [3, 4], usd(100)]
    ];

    for (const [betType, dice, amount] of cases) {
      const { alice, coordinator, game } = await fundedSession();

      await game.connect(alice).placeBet(betType, amount);
      await rollAndFulfill(game, coordinator, alice, ...dice);

      const state = await game.getPlayerState(alice.address);
      expect(state.available).to.equal(usd(9_850));
      expect(state.inPlay).to.equal(0n);
      expect(state.bets.oneRolls.any7).to.equal(0n);
      expect(state.bets.oneRolls.anyCraps).to.equal(0n);
      expect(state.bets.oneRolls.craps2).to.equal(0n);
      expect(state.bets.oneRolls.craps3).to.equal(0n);
      expect(state.bets.oneRolls.yo).to.equal(0n);
      expect(state.bets.oneRolls.twelve).to.equal(0n);
      expect(state.bets.oneRolls.horn).to.equal(0n);
    }
  });

  it("enforces the horn multiple of four", async function () {
    const { alice, game } = await fundedSession();

    await expect(game.connect(alice).placeBet(BetType.HORN, usd(99) + 1n))
      .to.be.revertedWithCustomError(game, "InvalidMultiple");
  });
});
