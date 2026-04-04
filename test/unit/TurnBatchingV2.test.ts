import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { assertInvariant } from "./helpers/gameFixture";
import {
  ActionKindV2,
  BetTypeV2,
  deployGameV2Fixture,
  rollAndFulfillV2,
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

describe("V2 / Turn batching", function () {
  it("supports first-bet and roll in a single confirmation", async function () {
    const { owner, alice, game } = await loadFixture(deployGameV2Fixture);

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(1_000));

    const actions = [
      [ActionKindV2.PLACE_BET, BetTypeV2.PASS_LINE, 0, usd(100), false],
    ] as const;

    await expect(game.connect(alice).executeTurn(actions, true)).to.emit(game, "TurnExecuted");
    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(3n);
    expect(state.pendingRequestId).to.not.equal(0n);
  });

  it("supports lay placement plus roll after a point is established", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameV2Fixture);

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).executeTurn([[ActionKindV2.PLACE_BET, BetTypeV2.PASS_LINE, 0, usd(100), false]], false);
    await rollAndFulfillV2(game, coordinator, alice, ...POINT_DICE[6]);

    const actions = [
      [ActionKindV2.PLACE_BET, BetTypeV2.LAY_4, 0, usd(20), false],
      [ActionKindV2.SET_BOX_WORKING, BetTypeV2.LAY_4, 0, 0n, true],
    ] as const;

    const tx = await game.connect(alice).executeTurn(actions, true);
    await expect(tx).to.emit(game, "TurnExecuted");

    const pending = await game.getPlayerState(alice.address);
    expect(pending.phase).to.equal(3n);
    expect(pending.bets.lay4.amount).to.equal(usd(20));
    expect(pending.pendingRequestId).to.not.equal(0n);

    await assertInvariant(game, [alice]);
  });

  it("rejects empty turns without a roll and enforces action ordering atomically", async function () {
    const { alice, game } = await loadFixture(deployGameV2Fixture);

    await expect(game.connect(alice).executeTurn([], false)).to.be.revertedWithCustomError(game, "EmptyTurn");

    const badActions = [
      [ActionKindV2.PLACE_BET, BetTypeV2.PASS_LINE_ODDS, 0, usd(300), false],
    ] as const;

    await expect(game.connect(alice).executeTurn(badActions, true)).to.be.reverted;
  });

  it("uses post-action state for reserve math when executeTurn rolls", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployGameV2Fixture);

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(10_000));
    await game.connect(alice).executeTurn([[ActionKindV2.PLACE_BET, BetTypeV2.PASS_LINE, 0, usd(100), false]], false);
    await rollAndFulfillV2(game, coordinator, alice, ...POINT_DICE[4]);

    const actions = [
      [ActionKindV2.PLACE_BET, BetTypeV2.LAY_4, 0, usd(20), false],
    ] as const;

    await expect(game.connect(alice).executeTurn(actions, true)).to.emit(game, "TurnExecuted");
    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(3n);
    expect(state.reserved).to.not.equal(0n);
    expect(state.bets.lay4.amount).to.equal(usd(20));
  });
});
