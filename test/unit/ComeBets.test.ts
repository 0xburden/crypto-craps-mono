import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { BetType, SessionPhase, deployGameFixture, rollAndFulfill, usd } from "./helpers/gameFixture";

const POINT_DICE: Record<number, [number, number]> = {
  4: [1, 3],
  5: [2, 3],
  6: [2, 4],
  8: [3, 5],
  9: [4, 5],
  10: [4, 6]
};

describe("ComeBets", function () {
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

  it("resolves come bet naturals and craps while the main point stays active", async function () {
    const naturalFixture = await enterPointAndClearLine(5);
    await naturalFixture.game.connect(naturalFixture.alice).placeBet(BetType.COME, usd(100));
    await rollAndFulfill(naturalFixture.game, naturalFixture.coordinator, naturalFixture.alice, 5, 6);

    let state = await naturalFixture.game.getPlayerState(naturalFixture.alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.point).to.equal(5n);
    expect(state.available).to.equal(usd(10_050));
    expect(state.bets.come[0].amount).to.equal(0n);

    const crapsFixture = await enterPointAndClearLine(5);
    await crapsFixture.game.connect(crapsFixture.alice).placeBet(BetType.COME, usd(100));
    await rollAndFulfill(crapsFixture.game, crapsFixture.coordinator, crapsFixture.alice, 1, 1);

    state = await crapsFixture.game.getPlayerState(crapsFixture.alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.point).to.equal(5n);
    expect(state.available).to.equal(usd(9_850));
    expect(state.bets.come[0].amount).to.equal(0n);
  });

  it("establishes, pays, and clears a come bet with attached odds", async function () {
    const { alice, coordinator, game } = await enterPointAndClearLine(5);

    await game.connect(alice).placeBet(BetType.COME, usd(100));
    await rollAndFulfill(game, coordinator, alice, 1, 3);

    let state = await game.getPlayerState(alice.address);
    expect(state.bets.come[0].amount).to.equal(usd(100));
    expect(state.bets.come[0].point).to.equal(4n);
    expect(state.available).to.equal(usd(9_850));

    await game.connect(alice).placeIndexedBet(BetType.COME_ODDS, 0, usd(300));
    await rollAndFulfill(game, coordinator, alice, 1, 3);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.point).to.equal(5n);
    expect(state.available).to.equal(usd(10_650));
    expect(state.bets.come[0].amount).to.equal(0n);
    expect(state.bets.come[0].oddsAmount).to.equal(0n);

    await game.exposedAssertInvariant();
  });

  it("resolves pending and established come bets in opposite directions on a seven-out", async function () {
    const { alice, coordinator, game } = await enterPointAndClearLine(5);

    await game.connect(alice).placeBet(BetType.COME, usd(100));
    await rollAndFulfill(game, coordinator, alice, 1, 3);
    await game.connect(alice).placeBet(BetType.COME, usd(100));

    await rollAndFulfill(game, coordinator, alice, 3, 4);

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.point).to.equal(0n);
    expect(state.available).to.equal(usd(9_950));
    expect(state.inPlay).to.equal(0n);
    expect(state.bets.come[0].amount).to.equal(0n);
    expect(state.bets.come[1].amount).to.equal(0n);
  });

  it("supports all four come slots and rejects a fifth concurrent come bet", async function () {
    const { alice, coordinator, game } = await enterPointAndClearLine(6);

    for (let i = 0; i < 4; i += 1) {
      await game.connect(alice).placeBet(BetType.COME, usd(100));
    }

    await expect(game.connect(alice).placeBet(BetType.COME, usd(100)))
      .to.be.revertedWithCustomError(game, "InvalidIndex");

    await rollAndFulfill(game, coordinator, alice, 1, 3);

    const state = await game.getPlayerState(alice.address);
    for (let i = 0; i < 4; i += 1) {
      expect(state.bets.come[i].amount).to.equal(usd(100));
      expect(state.bets.come[i].point).to.equal(4n);
    }
  });

  it("supports all four don't come slots and rejects a fifth concurrent don't come bet", async function () {
    const { alice, coordinator, game } = await enterPointAndClearLine(6);

    for (let i = 0; i < 4; i += 1) {
      await game.connect(alice).placeBet(BetType.DONT_COME, usd(100));
    }

    await expect(game.connect(alice).placeBet(BetType.DONT_COME, usd(100)))
      .to.be.revertedWithCustomError(game, "InvalidIndex");

    await rollAndFulfill(game, coordinator, alice, 1, 3);

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.point).to.equal(6n);
    for (let i = 0; i < 4; i += 1) {
      expect(state.bets.dontCome[i].amount).to.equal(usd(100));
      expect(state.bets.dontCome[i].point).to.equal(4n);
    }
  });

  it("mirrors don't come win, push, removal, and seven-out odds payout behavior", async function () {
    const winFixture = await enterPointAndClearLine(6);
    await winFixture.game.connect(winFixture.alice).placeBet(BetType.DONT_COME, usd(100));
    await rollAndFulfill(winFixture.game, winFixture.coordinator, winFixture.alice, 1, 1);

    let state = await winFixture.game.getPlayerState(winFixture.alice.address);
    expect(state.phase).to.equal(SessionPhase.POINT);
    expect(state.point).to.equal(6n);
    expect(state.available).to.equal(usd(10_050));

    const pushFixture = await enterPointAndClearLine(6);
    await pushFixture.game.connect(pushFixture.alice).placeBet(BetType.DONT_COME, usd(100));
    await rollAndFulfill(pushFixture.game, pushFixture.coordinator, pushFixture.alice, 6, 6);

    state = await pushFixture.game.getPlayerState(pushFixture.alice.address);
    expect(state.bets.dontCome[0].amount).to.equal(usd(100));
    expect(state.bets.dontCome[0].point).to.equal(0n);
    expect(state.available).to.equal(usd(9_850));

    const removalFixture = await enterPointAndClearLine(8);
    await removalFixture.game.connect(removalFixture.alice).placeBet(BetType.DONT_COME, usd(100));
    await rollAndFulfill(removalFixture.game, removalFixture.coordinator, removalFixture.alice, 1, 3);
    await removalFixture.game.connect(removalFixture.alice).placeIndexedBet(BetType.DONT_COME_ODDS, 0, usd(300));

    await expect(removalFixture.game.connect(removalFixture.alice).removeIndexedBet(BetType.DONT_COME, 0))
      .to.emit(removalFixture.game, "BetRemoved")
      .withArgs(removalFixture.alice.address, BetType.DONT_COME, usd(400));

    state = await removalFixture.game.getPlayerState(removalFixture.alice.address);
    expect(state.available).to.equal(usd(9_950));
    expect(state.bets.dontCome[0].amount).to.equal(0n);
    expect(state.bets.dontCome[0].oddsAmount).to.equal(0n);

    const sevenOutFixture = await enterPointAndClearLine(4);
    await sevenOutFixture.game.connect(sevenOutFixture.alice).placeBet(BetType.DONT_COME, usd(100));
    await rollAndFulfill(sevenOutFixture.game, sevenOutFixture.coordinator, sevenOutFixture.alice, 2, 4);
    await sevenOutFixture.game.connect(sevenOutFixture.alice).placeIndexedBet(BetType.DONT_COME_ODDS, 0, usd(300));
    await rollAndFulfill(sevenOutFixture.game, sevenOutFixture.coordinator, sevenOutFixture.alice, 3, 4);

    state = await sevenOutFixture.game.getPlayerState(sevenOutFixture.alice.address);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.point).to.equal(0n);
    expect(state.available).to.equal(usd(10_300));
    expect(state.bets.dontCome[0].amount).to.equal(0n);
    expect(state.bets.dontCome[0].oddsAmount).to.equal(0n);
  });
});
