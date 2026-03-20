import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { BetType, PuckState, SessionPhase, deployGameFixture, rollAndFulfill, usd } from "./helpers/gameFixture";

const POINT_DICE: Record<number, [number, number]> = {
  4: [1, 3],
  5: [2, 3],
  6: [2, 4],
  8: [3, 5],
  9: [4, 5],
  10: [4, 6]
};

describe("CoverageEdges", function () {
  async function fundedFixture() {
    const fixture = await loadFixture(deployGameFixture);
    const { owner, alice, game } = fixture;

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).openSession();

    return fixture;
  }

  async function enterPoint(point = 5) {
    const fixture = await fundedFixture();
    const { alice, coordinator, game } = fixture;

    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(100));
    await rollAndFulfill(game, coordinator, alice, ...POINT_DICE[point]);

    return fixture;
  }

  async function enterPointAndClearDontPass(point = 5) {
    const fixture = await enterPoint(point);
    await fixture.game.connect(fixture.alice).removeBet(BetType.DONT_PASS);
    return fixture;
  }

  it("covers public getters plus pause/unpause flow", async function () {
    const { owner, alice, token, coordinator, game } = await loadFixture(deployGameFixture);

    expect(await game.token()).to.equal(await token.getAddress());
    expect(await game.vrfCoordinator()).to.equal(await coordinator.getAddress());
    expect(await game.availableBalanceOf(alice.address)).to.equal(0n);
    expect(await game.inPlayBalanceOf(alice.address)).to.equal(0n);
    expect(await game.reservedBalanceOf(alice.address)).to.equal(0n);

    await game.connect(owner).pause();
    await game.connect(owner).unpause();

    await expect(game.connect(alice).deposit(usd(10))).to.not.be.reverted;
    await game.connect(alice).openSession();

    await expect(game.connect(alice).setPlaceWorking(8, false))
      .to.be.revertedWithCustomError(game, "NoActiveBet");
    await expect(game.connect(alice).setPlaceWorking(9, false))
      .to.be.revertedWithCustomError(game, "NoActiveBet");
    await expect(game.connect(alice).setPlaceWorking(10, false))
      .to.be.revertedWithCustomError(game, "NoActiveBet");
    await expect(game.connect(alice).setPlaceWorking(7, false))
      .to.be.revertedWithCustomError(game, "InvalidPoint");
  });

  it("rejects unsupported entrypoint bet types on the generic bet APIs", async function () {
    const pointFixture = await enterPointAndClearDontPass(5);

    await expect(pointFixture.game.connect(pointFixture.alice).placeBet(BetType.COME_ODDS, usd(10)))
      .to.be.revertedWithCustomError(pointFixture.game, "InvalidBetType");
    await expect(pointFixture.game.connect(pointFixture.alice).placeIndexedBet(BetType.PASS_LINE, 0, usd(10)))
      .to.be.revertedWithCustomError(pointFixture.game, "InvalidBetType");
    await expect(pointFixture.game.connect(pointFixture.alice).removeBet(BetType.PASS_LINE))
      .to.be.revertedWithCustomError(pointFixture.game, "InvalidBetType");
    await expect(pointFixture.game.connect(pointFixture.alice).removeIndexedBet(BetType.COME, 0))
      .to.be.revertedWithCustomError(pointFixture.game, "InvalidBetType");
  });

  it("removes live field, place, hardway, prop, and indexed-odds bets", async function () {
    const fixture = await enterPointAndClearDontPass(5);
    const { alice, coordinator, game } = fixture;

    await game.connect(alice).placeBet(BetType.FIELD, usd(100));
    await expect(game.connect(alice).removeBet(BetType.FIELD))
      .to.emit(game, "BetRemoved")
      .withArgs(alice.address, BetType.FIELD, usd(100));

    await game.connect(alice).placeBet(BetType.PLACE_5, usd(100));
    await expect(game.connect(alice).removeBet(BetType.PLACE_5))
      .to.emit(game, "BetRemoved")
      .withArgs(alice.address, BetType.PLACE_5, usd(100));

    await game.connect(alice).placeBet(BetType.HARD_4, usd(100));
    await expect(game.connect(alice).removeBet(BetType.HARD_4))
      .to.emit(game, "BetRemoved")
      .withArgs(alice.address, BetType.HARD_4, usd(100));

    await game.connect(alice).placeBet(BetType.ANY_7, usd(100));
    await expect(game.connect(alice).removeBet(BetType.ANY_7))
      .to.emit(game, "BetRemoved")
      .withArgs(alice.address, BetType.ANY_7, usd(100));

    await game.connect(alice).placeBet(BetType.COME, usd(100));
    await rollAndFulfill(game, coordinator, alice, 1, 3);
    await game.connect(alice).placeIndexedBet(BetType.COME_ODDS, 0, usd(300));
    await expect(game.connect(alice).removeIndexedBet(BetType.COME_ODDS, 0))
      .to.emit(game, "BetRemoved")
      .withArgs(alice.address, BetType.COME_ODDS, usd(300));

    await game.connect(alice).placeBet(BetType.DONT_COME, usd(100));
    await rollAndFulfill(game, coordinator, alice, 2, 4);
    await game.connect(alice).placeIndexedBet(BetType.DONT_COME_ODDS, 0, usd(300));
    await expect(game.connect(alice).removeIndexedBet(BetType.DONT_COME_ODDS, 0))
      .to.emit(game, "BetRemoved")
      .withArgs(alice.address, BetType.DONT_COME_ODDS, usd(300));
  });

  it("covers uncovered losing resolution branches for dont pass, dont come, and place bets", async function () {
    const dontPassFixture = await enterPoint(5);
    await dontPassFixture.game.connect(dontPassFixture.alice).placeBet(BetType.DONT_PASS_ODDS, usd(300));
    await rollAndFulfill(dontPassFixture.game, dontPassFixture.coordinator, dontPassFixture.alice, 2, 3);

    let state = await dontPassFixture.game.getPlayerState(dontPassFixture.alice.address);
    expect(state.bets.dontPass.amount).to.equal(0n);
    expect(state.bets.dontPass.oddsAmount).to.equal(0n);

    const pendingDontComeFixture = await enterPointAndClearDontPass(6);
    await pendingDontComeFixture.game.connect(pendingDontComeFixture.alice).placeBet(BetType.DONT_COME, usd(100));
    await rollAndFulfill(pendingDontComeFixture.game, pendingDontComeFixture.coordinator, pendingDontComeFixture.alice, 5, 6);

    state = await pendingDontComeFixture.game.getPlayerState(pendingDontComeFixture.alice.address);
    expect(state.bets.dontCome[0].amount).to.equal(0n);

    const establishedDontComeFixture = await enterPointAndClearDontPass(4);
    await establishedDontComeFixture.game.connect(establishedDontComeFixture.alice).placeBet(BetType.DONT_COME, usd(100));
    await rollAndFulfill(establishedDontComeFixture.game, establishedDontComeFixture.coordinator, establishedDontComeFixture.alice, 2, 4);
    await establishedDontComeFixture.game.connect(establishedDontComeFixture.alice).placeIndexedBet(BetType.DONT_COME_ODDS, 0, usd(300));
    await rollAndFulfill(establishedDontComeFixture.game, establishedDontComeFixture.coordinator, establishedDontComeFixture.alice, 2, 4);

    state = await establishedDontComeFixture.game.getPlayerState(establishedDontComeFixture.alice.address);
    expect(state.bets.dontCome[0].amount).to.equal(0n);
    expect(state.bets.dontCome[0].oddsAmount).to.equal(0n);

    const placeFixture = await enterPointAndClearDontPass(6);
    await placeFixture.game.connect(placeFixture.alice).placeBet(BetType.PLACE_5, usd(100));
    await placeFixture.game.connect(placeFixture.alice).placeBet(BetType.PLACE_8, usd(120));
    await placeFixture.game.connect(placeFixture.alice).placeBet(BetType.PLACE_9, usd(100));
    await placeFixture.game.connect(placeFixture.alice).placeBet(BetType.PLACE_10, usd(100));
    await rollAndFulfill(placeFixture.game, placeFixture.coordinator, placeFixture.alice, 3, 4);

    state = await placeFixture.game.getPlayerState(placeFixture.alice.address);
    expect(state.bets.place5.amount).to.equal(0n);
    expect(state.bets.place8.amount).to.equal(0n);
    expect(state.bets.place9.amount).to.equal(0n);
    expect(state.bets.place10.amount).to.equal(0n);
  });

  it("keeps line bets alive on irrelevant point rolls and handles edge-case VRF callbacks", async function () {
    const pointFixture = await fundedFixture();
    const { alice, coordinator, game } = pointFixture;

    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(100));
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(100));
    await rollAndFulfill(game, coordinator, alice, 1, 3);
    await rollAndFulfill(game, coordinator, alice, 1, 5);

    let state = await game.getPlayerState(alice.address);
    expect(state.point).to.equal(4n);
    expect(state.puckState).to.equal(PuckState.ON);
    expect(state.bets.passLine.point).to.equal(4n);
    expect(state.bets.dontPass.point).to.equal(4n);

    const emptyWordsFixture = await fundedFixture();
    await emptyWordsFixture.game.connect(emptyWordsFixture.alice).placeBet(BetType.PASS_LINE, usd(100));
    await emptyWordsFixture.game.connect(emptyWordsFixture.alice).rollDice();
    state = await emptyWordsFixture.game.getPlayerState(emptyWordsFixture.alice.address);
    await emptyWordsFixture.coordinator.fulfillRandomWordsUnchecked(state.pendingRequestId, []);

    state = await emptyWordsFixture.game.getPlayerState(emptyWordsFixture.alice.address);
    expect(state.pendingRequestId).to.equal(0n);
    expect(state.point).to.equal(0n);

    const mismatchFixture = await fundedFixture();
    await mismatchFixture.game.connect(mismatchFixture.alice).placeBet(BetType.PASS_LINE, usd(100));
    await mismatchFixture.game.connect(mismatchFixture.alice).rollDice();
    state = await mismatchFixture.game.getPlayerState(mismatchFixture.alice.address);
    await mismatchFixture.game.exposedSetSessionState(
      mismatchFixture.alice.address,
      SessionPhase.ROLL_PENDING,
      0,
      state.pendingRequestId + 1n,
      state.lastActivityTime
    );
    await mismatchFixture.coordinator.fulfillRandomWords(state.pendingRequestId, [1n]);

    state = await mismatchFixture.game.getPlayerState(mismatchFixture.alice.address);
    expect(state.pendingRequestId).to.equal(0n);
    expect(state.phase).to.equal(SessionPhase.COME_OUT);
    expect(state.reserved).to.equal(0n);
  });

  it("covers invalid payout multiplier fallbacks in PayoutMath", async function () {
    const harnessFactory = await ethers.getContractFactory("PayoutMathHarness");
    const harness = await harnessFactory.deploy();

    expect(await harness.payoutMultiplier(BetType.PASS_LINE_ODDS, 0)).to.deep.equal([0n, 1n]);
    expect(await harness.payoutMultiplier(BetType.DONT_PASS_ODDS, 0)).to.deep.equal([0n, 1n]);
    expect(await harness.payoutMultiplier(BetType.HORN, 7)).to.deep.equal([0n, 1n]);
  });
});
