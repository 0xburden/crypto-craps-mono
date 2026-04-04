import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { assertInvariant } from "../unit/helpers/gameFixture";
import {
  ActionKindV2,
  BetTypeV2,
  deployGameV2Fixture,
  placeBetV2,
  rollAndFulfillV2,
  usdV2 as usd,
} from "../unit/helpers/v2TestUtils";

const POINT_DICE: Record<number, [number, number]> = {
  4: [1, 3],
  5: [2, 3],
  6: [2, 4],
  8: [3, 5],
  9: [4, 5],
  10: [4, 6],
};

describe("Integration V2 / Multiplayer and pause", function () {
  it("keeps concurrent sessions isolated while batched turns are pending", async function () {
    const { owner, alice, bob, coordinator, game } = await loadFixture(deployGameV2Fixture);

    await game.connect(owner).fundBankroll(usd(100_000));

    for (const player of [alice, bob]) {
      await game.connect(player).deposit(usd(1_000));
      await placeBetV2(game, player, BetTypeV2.PASS_LINE, usd(100));
      await rollAndFulfillV2(game, coordinator, player, ...POINT_DICE[6]);
    }

    await game.connect(alice).executeTurn(
      [[ActionKindV2.PLACE_BET, BetTypeV2.LAY_6, 0, usd(60), false]],
      true,
    );
    await game.connect(bob).executeTurn(
      [[ActionKindV2.PLACE_BET, BetTypeV2.LAY_8, 0, usd(60), false]],
      true,
    );

    const alicePending = await game.getPlayerState(alice.address);
    const bobPending = await game.getPlayerState(bob.address);
    expect(alicePending.phase).to.equal(3n);
    expect(bobPending.phase).to.equal(3n);
    expect(alicePending.pendingRequestId).to.not.equal(0n);
    expect(bobPending.pendingRequestId).to.not.equal(0n);

    await coordinator.fulfillRandomWords(alicePending.pendingRequestId, [0n]);
    await coordinator.fulfillRandomWords(bobPending.pendingRequestId, [0n]);

    await assertInvariant(game, [alice, bob]);
  });

  it("blocks executeTurn while paused and preserves existing bankroll state", async function () {
    const { owner, alice, game } = await loadFixture(deployGameV2Fixture);

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(1_000));

    await game.connect(owner).pause();
    await expect(
      game.connect(alice).executeTurn(
        [[ActionKindV2.PLACE_BET, BetTypeV2.FIELD, 0, usd(5), false]],
        true,
      ),
    ).to.be.reverted;

    await game.connect(owner).unpause();
    await placeBetV2(game, alice, BetTypeV2.FIELD, usd(5));
    const state = await game.getPlayerState(alice.address);
    expect(state.inPlay).to.equal(usd(5));

    await assertInvariant(game, [alice]);
  });
});
