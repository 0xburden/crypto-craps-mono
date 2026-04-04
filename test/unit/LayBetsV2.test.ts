import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { assertInvariant } from "./helpers/gameFixture";
import {
  BetTypeV2,
  deployGameV2Fixture,
  placeBetV2,
  removeBetV2,
  rollAndFulfillV2,
  setBoxWorkingV2,
  usdV2 as usd,
} from "./helpers/v2TestUtils";

const POINT_DICE: Record<number, [number, number]> = {
  4: [1, 3],
  5: [2, 3],
  6: [2, 4],
  8: [3, 5],
  9: [4, 5],
  10: [4, 6],
};

const LAY_TARGET_DICE: Record<number, [number, number]> = {
  4: [2, 2],
  5: [2, 3],
  6: [3, 3],
  8: [4, 4],
  9: [4, 5],
  10: [5, 5],
};

function layGrossWinForPoint(stake: bigint, point: number) {
  if (point === 4 || point === 10) {
    return stake / 2n;
  }
  if (point === 5 || point === 9) {
    return (stake * 2n) / 3n;
  }
  return (stake * 5n) / 6n;
}

function layBetTypeForPoint(point: number): number {
  switch (point) {
    case 4:
      return BetTypeV2.LAY_4;
    case 5:
      return BetTypeV2.LAY_5;
    case 6:
      return BetTypeV2.LAY_6;
    case 8:
      return BetTypeV2.LAY_8;
    case 9:
      return BetTypeV2.LAY_9;
    case 10:
      return BetTypeV2.LAY_10;
    default:
      throw new Error(`Unsupported point: ${point}`);
  }
}

describe("V2 / Lay bets", function () {
  async function establishPoint(point: number) {
    const fixture = await loadFixture(deployGameV2Fixture);
    const { owner, alice, coordinator, game } = fixture;

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await placeBetV2(game, alice, BetTypeV2.PASS_LINE, usd(100));
    await rollAndFulfillV2(game, coordinator, alice, ...POINT_DICE[point]);

    return fixture;
  }

  it("places, toggles, and removes lays on box numbers", async function () {
    const { alice, coordinator, game } = await establishPoint(6);

    await expect(placeBetV2(game, alice, BetTypeV2.LAY_4, usd(20)))
      .to.emit(game, "BetPlaced")
      .withArgs(alice.address, BetTypeV2.LAY_4, usd(20));

    let state = await game.getPlayerState(alice.address);
    expect(state.bets.lay4.amount).to.equal(usd(20));
    expect(state.bets.lay4.working).to.equal(true);

    await expect(setBoxWorkingV2(game, alice, BetTypeV2.LAY_4, false))
      .to.emit(game, "BoxWorkingSet")
      .withArgs(alice.address, BetTypeV2.LAY_4, false);

    state = await game.getPlayerState(alice.address);
    expect(state.bets.lay4.working).to.equal(false);

    await expect(removeBetV2(game, alice, BetTypeV2.LAY_4))
      .to.emit(game, "BetRemoved")
      .withArgs(alice.address, BetTypeV2.LAY_4, usd(20));

    state = await game.getPlayerState(alice.address);
    expect(state.bets.lay4.amount).to.equal(0n);
    expect(state.bets.lay4.working).to.equal(false);
    expect(state.available).to.equal(usd(9_850));

    await assertInvariant(game, [alice]);

    await expect(placeBetV2(game, alice, BetTypeV2.LAY_4, usd(20) + 1n))
      .to.be.revertedWithCustomError(game, "InvalidMultiple");

    await expect(placeBetV2(game, alice, BetTypeV2.LAY_4, usd(0)))
      .to.be.revertedWithCustomError(game, "ZeroAmount");

    await placeBetV2(game, alice, BetTypeV2.LAY_4, usd(20));
    await expect(placeBetV2(game, alice, BetTypeV2.LAY_4, usd(20)))
      .to.emit(game, "BetPlaced")
      .withArgs(alice.address, BetTypeV2.LAY_4, usd(20));

    await rollAndFulfillV2(game, coordinator, alice, 3, 4);
  });

  it("wins lays on 7, pays net of vig, and loses on the target number", async function () {
    for (const point of [4, 5, 6, 8, 9, 10]) {
      const activePoint = point === 6 ? 8 : 6;
      const { alice, coordinator, game } = await establishPoint(activePoint);
      const layBetType = layBetTypeForPoint(point);
      const stake = point === 6 || point === 8 ? usd(60) : usd(30);
      const grossWin = layGrossWinForPoint(stake, point);
      const expectedNetWin = grossWin - (grossWin * 500n) / 10_000n;

      const before = await game.getPlayerState(alice.address);
      await placeBetV2(game, alice, layBetType, stake);

      const afterPlace = await game.getPlayerState(alice.address);
      expect(afterPlace.available).to.equal(before.available - stake);
      expect(afterPlace.inPlay).to.equal(before.inPlay + stake);

      await rollAndFulfillV2(game, coordinator, alice, 3, 4);

      let state = await game.getPlayerState(alice.address);
      expect(state.phase).to.equal(1n);
      expect(state.point).to.equal(0n);
      expect(state.bets[`lay${point}` as keyof typeof state.bets]?.amount ?? 0n).to.equal(0n);
      expect(state.available).to.equal(before.available + expectedNetWin);
      expect(state.inPlay).to.equal(0n);
      expect(state.reserved).to.equal(0n);

      await assertInvariant(game, [alice]);

      const targetFixture = await establishPoint(activePoint);
      const { alice: targetAlice, coordinator: targetCoordinator, game: targetGame } = targetFixture;
      const targetBefore = await targetGame.getPlayerState(targetAlice.address);
      await placeBetV2(targetGame, targetAlice, layBetType, stake);
      await rollAndFulfillV2(targetGame, targetCoordinator, targetAlice, ...LAY_TARGET_DICE[point]);

      state = await targetGame.getPlayerState(targetAlice.address);
      expect(state.phase).to.equal(2n);
      expect(state.point).to.equal(activePoint);
      expect(state.available).to.equal(targetBefore.available - stake);
      expect(state.inPlay).to.equal(targetBefore.inPlay);
      expect(state.reserved).to.equal(0n);
      expect(state.bets[`lay${point}` as keyof typeof state.bets]?.amount ?? 0n).to.equal(0n);

      await assertInvariant(targetGame, [targetAlice]);
    }
  });

  it("rejects lay placement on come-out and supports first-class session cleanup", async function () {
    const { alice, game } = await loadFixture(deployGameV2Fixture);

    await game.connect(alice).deposit(usd(100));

    await expect(placeBetV2(game, alice, BetTypeV2.LAY_4, usd(20)))
      .to.be.revertedWithCustomError(game, "BetUnavailable");

    await placeBetV2(game, alice, BetTypeV2.PASS_LINE, usd(10));
    await game.connect(alice).closeSession();
    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(0n);
    expect(state.inPlay).to.equal(0n);
  });
});
