import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { BetType, SessionPhase, assertInvariant, deployGameFixture, rollAndFulfill, usd } from "./helpers/gameFixture";

const POINT_DICE: Record<number, [number, number]> = {
  5: [2, 3]
};

describe("HardwayBets", function () {
  async function enterPointAndClearLine() {
    const fixture = await loadFixture(deployGameFixture);
    const { owner, alice, coordinator, game } = fixture;

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(100));
    await rollAndFulfill(game, coordinator, alice, ...POINT_DICE[5]);
    await game.connect(alice).removeBet(BetType.DONT_PASS);

    return fixture;
  }

  it("wins each hardway on the matching pair and clears the bet", async function () {
    const cases: Array<[number, [number, number], bigint]> = [
      [BetType.HARD_4, [2, 2], usd(10_650)],
      [BetType.HARD_6, [3, 3], usd(10_850)],
      [BetType.HARD_8, [4, 4], usd(10_850)],
      [BetType.HARD_10, [5, 5], usd(10_650)]
    ];

    for (const [betType, dice, expectedAvailable] of cases) {
      const { alice, coordinator, game } = await enterPointAndClearLine();

      await game.connect(alice).placeBet(betType, usd(100));
      await rollAndFulfill(game, coordinator, alice, ...dice);

      const state = await game.getPlayerState(alice.address);
      expect(state.phase).to.equal(SessionPhase.POINT);
      expect(state.point).to.equal(5n);
      expect(state.available).to.equal(expectedAvailable);
      expect(state.inPlay).to.equal(0n);
      expect(state.bets.hard4.amount + state.bets.hard6.amount + state.bets.hard8.amount + state.bets.hard10.amount).to.equal(0n);

      await assertInvariant(game, [alice]);
    }
  });

  it("loses each hardway on the easy way", async function () {
    const cases: Array<[number, [number, number]]> = [
      [BetType.HARD_4, [1, 3]],
      [BetType.HARD_6, [2, 4]],
      [BetType.HARD_8, [3, 5]],
      [BetType.HARD_10, [4, 6]]
    ];

    for (const [betType, dice] of cases) {
      const { alice, coordinator, game } = await enterPointAndClearLine();

      await game.connect(alice).placeBet(betType, usd(100));
      await rollAndFulfill(game, coordinator, alice, ...dice);

      const state = await game.getPlayerState(alice.address);
      expect(state.available).to.equal(usd(9_850));
      expect(state.inPlay).to.equal(0n);
      expect(state.bets.hard4.amount + state.bets.hard6.amount + state.bets.hard8.amount + state.bets.hard10.amount).to.equal(0n);
    }
  });

  it("persists through irrelevant rolls and loses on any seven", async function () {
    const { alice, coordinator, game } = await enterPointAndClearLine();

    await game.connect(alice).placeBet(BetType.HARD_4, usd(100));
    await rollAndFulfill(game, coordinator, alice, 3, 3);

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.point).to.equal(5n);
    expect(state.available).to.equal(usd(9_850));
    expect(state.bets.hard4.amount).to.equal(usd(100));

    await rollAndFulfill(game, coordinator, alice, 3, 4);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.point).to.equal(0n);
    expect(state.available).to.equal(usd(9_850));
    expect(state.inPlay).to.equal(0n);
    expect(state.bets.hard4.amount).to.equal(0n);
  });
});
