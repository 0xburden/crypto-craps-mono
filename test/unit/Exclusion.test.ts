import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

import { BetType, SessionPhase, deployGameFixture, usd } from "./helpers/gameFixture";

describe("Exclusion", function () {
  it("self-excludes immediately, expires any active session, and still allows withdrawal", async function () {
    const { alice, game, token } = await loadFixture(deployGameFixture);

    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.PASS_LINE, usd(10));

    await expect(game.connect(alice).selfExclude()).to.emit(game, "SelfExcluded").withArgs(alice.address);

    const state = await game.getPlayerState(alice.address);
    expect(state.selfExcluded).to.equal(true);
    expect(state.phase).to.equal(SessionPhase.INACTIVE);
    expect(state.available).to.equal(usd(99_5) / 10n);
    expect(state.inPlay).to.equal(0n);

    await expect(game.connect(alice).deposit(usd(10))).to.be.revertedWithCustomError(game, "PlayerExcluded");
    await expect(game.connect(alice).openSession()).to.be.revertedWithCustomError(game, "PlayerExcluded");

    const balanceBefore = await token.balanceOf(alice.address);
    await expect(game.connect(alice).withdraw(usd(20))).to.emit(game, "Withdrawal").withArgs(alice.address, usd(20));
    expect(await token.balanceOf(alice.address)).to.equal(balanceBefore + usd(20));

    await game.exposedAssertInvariant();
  });

  it("supports the self-reinstatement delay flow", async function () {
    const { alice, game } = await loadFixture(deployGameFixture);

    await game.connect(alice).selfExclude();

    await expect(game.connect(alice).requestSelfReinstatement()).to.emit(game, "SelfReinstatementRequested");

    const eligibleAt = await game.reinstatementEligibleAt(alice.address);
    expect(eligibleAt).to.be.greaterThan(0n);

    await expect(game.connect(alice).completeSelfReinstatement()).to.be.revertedWithCustomError(
      game,
      "NotEligibleForReinstatement"
    );

    await time.increaseTo(eligibleAt);

    await expect(game.connect(alice).completeSelfReinstatement())
      .to.emit(game, "SelfReinstated")
      .withArgs(alice.address);

    const state = await game.getPlayerState(alice.address);
    expect(state.selfExcluded).to.equal(false);
    expect(state.reinstatementEligibleAt).to.equal(0n);

    await expect(game.connect(alice).openSession()).to.emit(game, "SessionOpened").withArgs(alice.address);
  });

  it("operator exclusion immediately closes the session and operator reinstatement restores play access", async function () {
    const { owner, alice, game, token } = await loadFixture(deployGameFixture);

    await game.connect(alice).deposit(usd(100));
    await game.connect(alice).openSession();
    await game.connect(alice).placeBet(BetType.DONT_PASS, usd(10));

    await expect(game.connect(owner).operatorExclude(alice.address))
      .to.emit(game, "OperatorExcluded")
      .withArgs(alice.address);

    let state = await game.getPlayerState(alice.address);
    expect(state.operatorExcluded).to.equal(true);
    expect(state.phase).to.equal(SessionPhase.INACTIVE);
    expect(state.available).to.equal(usd(99_5) / 10n);

    await expect(game.connect(alice).deposit(usd(10))).to.be.revertedWithCustomError(game, "PlayerExcluded");

    const balanceBefore = await token.balanceOf(alice.address);
    await game.connect(alice).withdraw(usd(25));
    expect(await token.balanceOf(alice.address)).to.equal(balanceBefore + usd(25));

    await expect(game.connect(owner).operatorReinstate(alice.address))
      .to.emit(game, "OperatorReinstated")
      .withArgs(alice.address);

    state = await game.getPlayerState(alice.address);
    expect(state.operatorExcluded).to.equal(false);

    await expect(game.connect(alice).openSession()).to.emit(game, "SessionOpened").withArgs(alice.address);
  });

  it("resets the self-reinstatement timer when the player self-excludes again", async function () {
    const { alice, game } = await loadFixture(deployGameFixture);

    await game.connect(alice).selfExclude();
    await game.connect(alice).requestSelfReinstatement();

    const firstEligibleAt = await game.reinstatementEligibleAt(alice.address);
    await time.increase(24 * 60 * 60);

    await game.connect(alice).selfExclude();
    expect(await game.reinstatementEligibleAt(alice.address)).to.equal(0n);

    await game.connect(alice).requestSelfReinstatement();
    const secondEligibleAt = await game.reinstatementEligibleAt(alice.address);

    expect(secondEligibleAt).to.be.greaterThan(firstEligibleAt);
  });
});
