import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { assertInvariant } from "./helpers/gameFixture";
import {
  BetTypeV3,
  SessionPhaseV3,
  deployGameV3Fixture,
  placeBetV3,
  removeBetV3,
  rollAndFulfillV3,
  setBoxWorkingV3,
  usdV3 as usd,
} from "./helpers/v3TestUtils";

async function establishPointWithPassLine(pointDice: [number, number] = [3, 5]) {
  const fixture = await loadFixture(deployGameV3Fixture);
  const { owner, alice, coordinator, game } = fixture;

  await game.connect(owner).fundBankroll(usd(100_000));
  await game.connect(alice).deposit(usd(10_000));
  await placeBetV3(game, alice, BetTypeV3.PASS_LINE, usd(100));
  await rollAndFulfillV3(game, coordinator, alice, ...pointDice);

  const state = await game.getPlayerState(alice.address);
  expect(state.phase).to.equal(SessionPhaseV3.POINT);
  expect(state.point).to.equal(BigInt(pointDice[0] + pointDice[1]));

  return fixture;
}

async function establishPointWithRemovableDontPass(pointDice: [number, number] = [3, 5]) {
  const fixture = await loadFixture(deployGameV3Fixture);
  const { owner, alice, coordinator, game } = fixture;

  await game.connect(owner).fundBankroll(usd(100_000));
  await game.connect(alice).deposit(usd(10_000));
  await placeBetV3(game, alice, BetTypeV3.DONT_PASS, usd(100));
  await rollAndFulfillV3(game, coordinator, alice, ...pointDice);
  await removeBetV3(game, alice, BetTypeV3.DONT_PASS);

  const state = await game.getPlayerState(alice.address);
  expect(state.phase).to.equal(SessionPhaseV3.POINT);
  expect(state.point).to.equal(BigInt(pointDice[0] + pointDice[1]));
  expect(state.inPlay).to.equal(0n);

  return fixture;
}

describe("V3 / Active and non-working bet resolution", function () {
  it("keeps non-working place bets through 7-out while working place bets lose", async function () {
    const { alice, coordinator, game } = await establishPointWithPassLine();

    await placeBetV3(game, alice, BetTypeV3.PLACE_6, usd(60));
    await placeBetV3(game, alice, BetTypeV3.PLACE_8, usd(60));
    await setBoxWorkingV3(game, alice, BetTypeV3.PLACE_6, false);

    await rollAndFulfillV3(game, coordinator, alice, 3, 4);

    const state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhaseV3.COME_OUT);
    expect(state.point).to.equal(0n);
    expect(state.bets.place6.amount).to.equal(usd(60));
    expect(state.bets.place6.working).to.equal(false);
    expect(state.bets.place8.amount).to.equal(0n);
    expect(state.bets.place8.working).to.equal(false);
    expect(state.inPlay).to.equal(usd(60));
    expect(state.reserved).to.equal(0n);

    await assertInvariant(game, [alice]);
  });

  it("does not pay non-working place bets on their number but pays working place bets", async function () {
    const { alice, coordinator, game } = await establishPointWithPassLine();

    await placeBetV3(game, alice, BetTypeV3.PLACE_6, usd(60));
    await setBoxWorkingV3(game, alice, BetTypeV3.PLACE_6, false);
    await placeBetV3(game, alice, BetTypeV3.HARD_4, usd(1));

    const beforeOffRoll = await game.getPlayerState(alice.address);
    await rollAndFulfillV3(game, coordinator, alice, 2, 4);

    let state = await game.getPlayerState(alice.address);
    expect(state.bets.place6.amount).to.equal(usd(60));
    expect(state.bets.place6.working).to.equal(false);
    expect(state.available).to.equal(beforeOffRoll.available);
    expect(state.inPlay).to.equal(beforeOffRoll.inPlay);
    expect(state.reserved).to.equal(0n);

    await setBoxWorkingV3(game, alice, BetTypeV3.PLACE_6, true);
    const beforeWorkingRoll = await game.getPlayerState(alice.address);
    await rollAndFulfillV3(game, coordinator, alice, 2, 4);

    state = await game.getPlayerState(alice.address);
    expect(state.bets.place6.amount).to.equal(usd(60));
    expect(state.bets.place6.working).to.equal(true);
    expect(state.available).to.equal(beforeWorkingRoll.available + usd(70));
    expect(state.inPlay).to.equal(beforeWorkingRoll.inPlay);
    expect(state.reserved).to.equal(0n);

    await assertInvariant(game, [alice]);
  });

  it("keeps non-working lay bets through 7 and target rolls", async function () {
    const { alice, coordinator, game } = await establishPointWithPassLine();

    await placeBetV3(game, alice, BetTypeV3.LAY_6, usd(60));
    await setBoxWorkingV3(game, alice, BetTypeV3.LAY_6, false);
    await placeBetV3(game, alice, BetTypeV3.HARD_4, usd(1));

    const beforeTargetRoll = await game.getPlayerState(alice.address);
    await rollAndFulfillV3(game, coordinator, alice, 3, 3);

    let state = await game.getPlayerState(alice.address);
    expect(state.bets.lay6.amount).to.equal(usd(60));
    expect(state.bets.lay6.working).to.equal(false);
    expect(state.available).to.equal(beforeTargetRoll.available);
    expect(state.inPlay).to.equal(beforeTargetRoll.inPlay);
    expect(state.reserved).to.equal(0n);

    await rollAndFulfillV3(game, coordinator, alice, 3, 4);

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhaseV3.COME_OUT);
    expect(state.bets.lay6.amount).to.equal(usd(60));
    expect(state.bets.lay6.working).to.equal(false);
    expect(state.inPlay).to.equal(usd(60));
    expect(state.reserved).to.equal(0n);

    await assertInvariant(game, [alice]);
  });

  it("resolves working lay bets on 7 and target rolls", async function () {
    const { alice, coordinator, game } = await establishPointWithPassLine();
    const stake = usd(60);
    const expectedNetWin = ((stake * 5n) / 6n) - (((stake * 5n) / 6n) * 500n) / 10_000n;

    const beforeWin = await game.getPlayerState(alice.address);
    await placeBetV3(game, alice, BetTypeV3.LAY_6, stake);
    await rollAndFulfillV3(game, coordinator, alice, 3, 4);

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhaseV3.COME_OUT);
    expect(state.bets.lay6.amount).to.equal(0n);
    expect(state.available).to.equal(beforeWin.available + expectedNetWin);
    expect(state.reserved).to.equal(0n);

    const targetFixture = await establishPointWithPassLine();
    const { alice: targetAlice, coordinator: targetCoordinator, game: targetGame } = targetFixture;
    const beforeLoss = await targetGame.getPlayerState(targetAlice.address);
    await placeBetV3(targetGame, targetAlice, BetTypeV3.LAY_6, stake);
    await rollAndFulfillV3(targetGame, targetCoordinator, targetAlice, 3, 3);

    state = await targetGame.getPlayerState(targetAlice.address);
    expect(state.phase).to.equal(SessionPhaseV3.POINT);
    expect(state.point).to.equal(8n);
    expect(state.bets.lay6.amount).to.equal(0n);
    expect(state.available).to.equal(beforeLoss.available - stake);
    expect(state.inPlay).to.equal(beforeLoss.inPlay);
    expect(state.reserved).to.equal(0n);

    await assertInvariant(targetGame, [targetAlice]);
  });

  it("rejects rolling with only non-working place and lay bets", async function () {
    const { alice, game } = await establishPointWithRemovableDontPass();

    await placeBetV3(game, alice, BetTypeV3.PLACE_6, usd(60));
    await placeBetV3(game, alice, BetTypeV3.LAY_6, usd(60));
    await setBoxWorkingV3(game, alice, BetTypeV3.PLACE_6, false);
    await setBoxWorkingV3(game, alice, BetTypeV3.LAY_6, false);

    const beforeRollAttempt = await game.getPlayerState(alice.address);
    expect(beforeRollAttempt.inPlay).to.equal(usd(120));

    await expect(game.connect(alice).executeTurn([], true))
      .to.be.revertedWithCustomError(game, "InvalidAmount")
      .withArgs(0);

    let state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhaseV3.POINT);
    expect(state.pendingRequestId).to.equal(0n);
    expect(state.bets.place6.amount).to.equal(usd(60));
    expect(state.bets.lay6.amount).to.equal(usd(60));

    await setBoxWorkingV3(game, alice, BetTypeV3.LAY_6, true);
    await expect(game.connect(alice).executeTurn([], true)).to.emit(game, "RollRequested");

    state = await game.getPlayerState(alice.address);
    expect(state.phase).to.equal(SessionPhaseV3.ROLL_PENDING);
  });
});
