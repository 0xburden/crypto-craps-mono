import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

import { assertInvariant } from "../unit/helpers/gameFixture";
import {
  ActionKindV2,
  BetTypeV2,
  deployGameV2Fixture,
  encodeDiceV2,
  placeBetV2,
  rollAndFulfillV2,
  usdV2 as usd,
} from "../unit/helpers/v2TestUtils";

const SESSION_TIMEOUT_SECONDS = 24 * 60 * 60;
const POINT_DICE: Record<number, [number, number]> = {
  4: [1, 3],
  5: [2, 3],
  6: [2, 4],
  8: [3, 5],
  9: [4, 5],
  10: [4, 6],
};

describe("Integration V2 / Session flows", function () {
  it("supports a one-tx first turn, then a lay turn, then clean close and withdraw", async function () {
    const { owner, alice, coordinator, game, token } = await loadFixture(deployGameV2Fixture);

    const aliceStart = await token.balanceOf(alice.address);
    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(500));

    await game.connect(alice).executeTurn(
      [[ActionKindV2.PLACE_BET, BetTypeV2.PASS_LINE, 0, usd(100), false]],
      true,
    );

    const pending = await game.getPlayerState(alice.address);
    await coordinator.fulfillRandomWords(pending.pendingRequestId, [encodeDiceV2(2, 4)]);

    await placeBetV2(game, alice, BetTypeV2.LAY_4, usd(20));
    await rollAndFulfillV2(game, coordinator, alice, 3, 4);

    await game.connect(alice).closeSession();
    const closed = await game.getPlayerState(alice.address);
    expect(closed.phase).to.equal(0n);
    expect(closed.inPlay).to.equal(0n);

    const withdrawAmount = closed.available;
    await expect(game.connect(alice).withdraw(withdrawAmount)).to.emit(game, "Withdrawal");
    expect(await token.balanceOf(alice.address)).to.equal(aliceStart - usd(500) + withdrawAmount);

    await assertInvariant(game, [alice]);
  });

  it("expires an active session with lays and returns funds to available", async function () {
    const { owner, alice, bob, coordinator, game } = await loadFixture(deployGameV2Fixture);

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(500));
    await placeBetV2(game, alice, BetTypeV2.PASS_LINE, usd(100));
    await rollAndFulfillV2(game, coordinator, alice, ...POINT_DICE[6]);
    await placeBetV2(game, alice, BetTypeV2.LAY_6, usd(60));

    const beforeExpiry = await game.getPlayerState(alice.address);
    expect(beforeExpiry.phase).to.equal(2n);
    expect(beforeExpiry.inPlay).to.equal(usd(160));

    await time.increase(SESSION_TIMEOUT_SECONDS + 1);

    await expect(game.connect(bob).expireSession(alice.address)).to.emit(game, "SessionExpired");

    const afterExpiry = await game.getPlayerState(alice.address);
    expect(afterExpiry.phase).to.equal(0n);
    expect(afterExpiry.inPlay).to.equal(0n);
    expect(afterExpiry.reserved).to.equal(0n);
    expect(afterExpiry.bets.lay6.amount).to.equal(0n);

    await assertInvariant(game, [alice]);
  });
});
