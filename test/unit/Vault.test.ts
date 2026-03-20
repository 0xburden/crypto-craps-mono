import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { encodeDice } from "./helpers/gameFixture";

const UNIT = 10n ** 6n;
const usd = (value: number) => BigInt(value) * UNIT;
const feeFor = (amount: bigint) => (amount * 50n) / 10_000n;

function makeRng(seed: bigint) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245n + 12_345n) % 2_147_483_648n;
    return state;
  };
}

describe("Vault", function () {
  async function deployFixture() {
    const [owner, alice, bob, carol, treasury] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
    const gameFactory = await ethers.getContractFactory("CrapsGameHarness");

    const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
    const coordinator = await coordinatorFactory.deploy();
    const game = await gameFactory.deploy(await token.getAddress(), await coordinator.getAddress(), true);

    const richAmount = usd(1_000_000);

    for (const signer of [owner, alice, bob, carol]) {
      await token.connect(signer).mint(signer.address, richAmount);
      await token.connect(signer).approve(await game.getAddress(), ethers.MaxUint256);
    }

    return { owner, alice, bob, carol, treasury, token, coordinator, game };
  }

  it("credits available balance, accrues fees, and preserves the invariant on deposit", async function () {
    const { alice, token, game } = await loadFixture(deployFixture);
    const amount = usd(1_000);
    const fee = feeFor(amount);

    await expect(game.connect(alice).deposit(amount))
      .to.emit(game, "Deposit")
      .withArgs(alice.address, amount, fee);

    expect(await game.availableBalanceOf(alice.address)).to.equal(amount - fee);
    expect(await game.inPlayBalanceOf(alice.address)).to.equal(0n);
    expect(await game.reservedBalanceOf(alice.address)).to.equal(0n);
    expect(await game.totalAvailable()).to.equal(amount - fee);
    expect(await game.totalInPlay()).to.equal(0n);
    expect(await game.totalReserved()).to.equal(0n);
    expect(await game.accruedFees()).to.equal(fee);
    expect(await token.balanceOf(await game.getAddress())).to.equal(amount);

    await game.exposedAssertInvariant();
  });

  it("reverts on zero-amount deposit and when paused", async function () {
    const { owner, alice, game } = await loadFixture(deployFixture);

    await expect(game.connect(alice).deposit(0)).to.be.revertedWithCustomError(game, "ZeroAmount");

    await game.connect(owner).pause();

    await expect(game.connect(alice).deposit(usd(10))).to.be.revertedWithCustomError(game, "EnforcedPause");
  });

  it("supports partial and full withdrawals while preserving the invariant", async function () {
    const { alice, token, game } = await loadFixture(deployFixture);
    const depositAmount = usd(1_000);
    const fee = feeFor(depositAmount);
    const net = depositAmount - fee;

    await game.connect(alice).deposit(depositAmount);

    await expect(game.connect(alice).withdraw(usd(400)))
      .to.emit(game, "Withdrawal")
      .withArgs(alice.address, usd(400));

    expect(await game.availableBalanceOf(alice.address)).to.equal(net - usd(400));
    expect(await token.balanceOf(await game.getAddress())).to.equal(depositAmount - usd(400));
    await game.exposedAssertInvariant();

    await game.connect(alice).withdraw(net - usd(400));

    expect(await game.availableBalanceOf(alice.address)).to.equal(0n);
    expect(await game.totalAvailable()).to.equal(0n);
    expect(await token.balanceOf(await game.getAddress())).to.equal(fee);
    await game.exposedAssertInvariant();
  });

  it("reverts when withdrawing more than available and still allows withdrawals while paused", async function () {
    const { owner, alice, game } = await loadFixture(deployFixture);

    await game.connect(alice).deposit(usd(100));

    await expect(game.connect(alice).withdraw(usd(100))).to.be.revertedWithCustomError(game, "InsufficientBalance");

    await game.connect(owner).pause();

    await expect(game.connect(alice).withdraw(usd(50))).to.not.be.reverted;
    expect(await game.availableBalanceOf(alice.address)).to.equal(usd(49_5) / 10n);
    await game.exposedAssertInvariant();
  });

  it("moves funds between available and in-play via the internal debit and credit helpers", async function () {
    const { alice, game } = await loadFixture(deployFixture);

    await game.connect(alice).deposit(usd(1_000));

    await game.exposedDebitAvailable(alice.address, usd(125));
    expect(await game.availableBalanceOf(alice.address)).to.equal(usd(870));
    expect(await game.inPlayBalanceOf(alice.address)).to.equal(usd(125));
    expect(await game.totalAvailable()).to.equal(usd(870));
    expect(await game.totalInPlay()).to.equal(usd(125));

    await game.exposedCreditAvailable(alice.address, usd(75));
    expect(await game.availableBalanceOf(alice.address)).to.equal(usd(945));
    expect(await game.inPlayBalanceOf(alice.address)).to.equal(usd(50));
    expect(await game.totalAvailable()).to.equal(usd(945));
    expect(await game.totalInPlay()).to.equal(usd(50));

    await game.exposedAssertInvariant();
  });

  it("moves bankroll into reserve and releases it correctly for zero, partial, and full payouts", async function () {
    const { owner, alice, game } = await loadFixture(deployFixture);
    const bankrollAmount = usd(20_000);

    await game.connect(owner).fundBankroll(bankrollAmount);

    await game.exposedReserveFromBankroll(alice.address, usd(1_000));
    expect(await game.bankroll()).to.equal(bankrollAmount - usd(1_000));
    expect(await game.reservedBalanceOf(alice.address)).to.equal(usd(1_000));
    expect(await game.totalReserved()).to.equal(usd(1_000));

    await game.exposedReleaseReserve(alice.address, 0);
    expect(await game.bankroll()).to.equal(bankrollAmount);
    expect(await game.reservedBalanceOf(alice.address)).to.equal(0n);
    expect(await game.availableBalanceOf(alice.address)).to.equal(0n);

    await game.exposedReserveFromBankroll(alice.address, usd(1_000));
    await game.exposedReleaseReserve(alice.address, usd(250));
    expect(await game.bankroll()).to.equal(bankrollAmount - usd(250));
    expect(await game.availableBalanceOf(alice.address)).to.equal(usd(250));
    expect(await game.reservedBalanceOf(alice.address)).to.equal(0n);

    await game.exposedReserveFromBankroll(alice.address, usd(1_000));
    await game.exposedReleaseReserve(alice.address, usd(1_000));
    expect(await game.bankroll()).to.equal(bankrollAmount - usd(1_250));
    expect(await game.availableBalanceOf(alice.address)).to.equal(usd(1_250));
    expect(await game.totalReserved()).to.equal(0n);

    await game.exposedAssertInvariant();
  });

  it("allows only the owner to withdraw fees, transfers the full amount, and zeroes accrued fees", async function () {
    const { alice, bob, treasury, token, game } = await loadFixture(deployFixture);

    await game.connect(alice).deposit(usd(1_000));
    await game.connect(bob).deposit(usd(500));

    const expectedFees = feeFor(usd(1_000)) + feeFor(usd(500));

    await expect(game.connect(alice).withdrawFees(treasury.address)).to.be.revertedWith("Only callable by owner");

    await expect(game.withdrawFees(treasury.address))
      .to.emit(game, "FeesWithdrawn")
      .withArgs(treasury.address, expectedFees);

    expect(await game.accruedFees()).to.equal(0n);
    expect(await token.balanceOf(treasury.address)).to.equal(expectedFees);
    await game.exposedAssertInvariant();
  });

  it("allows fee withdrawal while paused", async function () {
    const { owner, alice, treasury, token, game } = await loadFixture(deployFixture);

    await game.connect(alice).deposit(usd(1_000));
    await game.connect(owner).pause();

    const expectedFees = feeFor(usd(1_000));

    await expect(game.connect(owner).withdrawFees(treasury.address))
      .to.emit(game, "FeesWithdrawn")
      .withArgs(treasury.address, expectedFees);

    expect(await game.accruedFees()).to.equal(0n);
    expect(await token.balanceOf(treasury.address)).to.equal(expectedFees);
    await game.exposedAssertInvariant();
  });

  it("funds the bankroll bucket and preserves the invariant", async function () {
    const { owner, token, game } = await loadFixture(deployFixture);
    const amount = usd(50_000);

    await expect(game.connect(owner).fundBankroll(amount))
      .to.emit(game, "BankrollFunded")
      .withArgs(owner.address, amount);

    expect(await game.bankroll()).to.equal(amount);
    expect(await token.balanceOf(await game.getAddress())).to.equal(amount);
    expect(await game.totalAvailable()).to.equal(0n);
    expect(await game.totalInPlay()).to.equal(0n);
    expect(await game.totalReserved()).to.equal(0n);
    await game.exposedAssertInvariant();
  });

  it("restricts vault administration functions to the owner", async function () {
    const { alice, treasury, game } = await loadFixture(deployFixture);

    await expect(game.connect(alice).fundBankroll(usd(1_000))).to.be.revertedWith("Only callable by owner");
    await expect(game.connect(alice).withdrawBankroll(usd(1_000))).to.be.revertedWith("Only callable by owner");
    await expect(game.connect(alice).pause()).to.be.revertedWith("Only callable by owner");
    await expect(game.connect(alice).unpause()).to.be.revertedWith("Only callable by owner");
    await expect(game.connect(alice).withdrawFees(treasury.address)).to.be.revertedWith("Only callable by owner");
  });

  it("requires pause before bankroll withdrawal and decreases the bankroll bucket correctly", async function () {
    const { owner, token, game } = await loadFixture(deployFixture);
    const funded = usd(15_000);
    const withdrawn = usd(4_000);

    await game.connect(owner).fundBankroll(funded);

    await expect(game.connect(owner).withdrawBankroll(withdrawn)).to.be.revertedWithCustomError(game, "ExpectedPause");

    await game.connect(owner).pause();

    await expect(game.connect(owner).withdrawBankroll(withdrawn))
      .to.emit(game, "BankrollWithdrawn")
      .withArgs(owner.address, withdrawn);

    expect(await game.bankroll()).to.equal(funded - withdrawn);
    expect(await token.balanceOf(await game.getAddress())).to.equal(funded - withdrawn);
    await game.exposedAssertInvariant();
  });

  it("blocks bankroll withdrawal while VRF requests are still outstanding", async function () {
    const { owner, game } = await loadFixture(deployFixture);

    await game.connect(owner).fundBankroll(usd(15_000));
    await game.connect(owner).pause();
    await game.exposedSetPendingVRFRequests(1);

    await expect(game.connect(owner).withdrawBankroll(usd(1_000))).to.be.revertedWithCustomError(
      game,
      "PendingVRFRequestsOutstanding"
    );
  });

  it("exposes vault state through getPlayerState", async function () {
    const { owner, alice, game } = await loadFixture(deployFixture);

    await game.connect(alice).deposit(usd(1_000));
    await game.connect(owner).fundBankroll(usd(15_000));
    await game.exposedDebitAvailable(alice.address, usd(100));
    await game.exposedReserveFromBankroll(alice.address, usd(200));
    await game.connect(owner).pause();

    const state = await game.getPlayerState(alice.address);

    expect(state.phase).to.equal(0n);
    expect(state.puckState).to.equal(0n);
    expect(state.point).to.equal(0n);
    expect(state.pendingRequestId).to.equal(0n);
    expect(state.available).to.equal(usd(895));
    expect(state.inPlay).to.equal(usd(100));
    expect(state.reserved).to.equal(usd(200));
    expect(state.bankroll).to.equal(usd(14_800));
    expect(state.totalBankroll).to.equal(usd(15_000));
    expect(state.initialBankroll).to.equal(usd(50_000));
    expect(state.accruedFees).to.equal(usd(5));
    expect(state.paused).to.equal(true);
    expect(state.selfExcluded).to.equal(false);
    expect(state.operatorExcluded).to.equal(false);
    expect(state.reinstatementEligibleAt).to.equal(0n);
    expect(state.bets.passLine.amount).to.equal(0n);
  });

  it("maintains the literal five-bucket invariant across multiple players and bucket types", async function () {
    const { owner, alice, bob, carol, game } = await loadFixture(deployFixture);

    await game.connect(alice).deposit(usd(1_000));
    await game.connect(bob).deposit(usd(500));
    await game.connect(carol).deposit(usd(250));
    await game.connect(owner).fundBankroll(usd(20_000));

    await game.exposedDebitAvailable(alice.address, usd(100));
    await game.exposedDebitAvailable(bob.address, usd(50));
    await game.exposedReserveFromBankroll(alice.address, usd(300));
    await game.exposedReserveFromBankroll(carol.address, usd(150));
    await game.exposedReleaseReserve(carol.address, usd(25));

    expect(await game.totalAvailable()).to.equal(usd(161_625) / 100n);
    expect(await game.totalInPlay()).to.equal(usd(150));
    expect(await game.totalReserved()).to.equal(usd(300));
    expect(await game.bankroll()).to.equal(usd(19_675));
    expect(await game.accruedFees()).to.equal(usd(875) / 100n);

    await game.exposedAssertInvariant();
  });

  it("reverts on invalid internal helper operations", async function () {
    const { owner, alice, game } = await loadFixture(deployFixture);

    await game.connect(owner).fundBankroll(usd(1_000));
    await game.connect(alice).deposit(usd(100));

    await expect(game.exposedDebitAvailable(alice.address, usd(100))).to.be.revertedWithCustomError(
      game,
      "InsufficientBalance"
    );

    await expect(game.exposedCreditAvailable(alice.address, usd(1))).to.be.revertedWithCustomError(
      game,
      "InsufficientBalance"
    );

    await expect(game.exposedReserveFromBankroll(alice.address, usd(1_001))).to.be.revertedWithCustomError(
      game,
      "InsufficientBankroll"
    );

    await game.exposedReserveFromBankroll(alice.address, usd(100));

    await expect(game.exposedReleaseReserve(alice.address, usd(101))).to.be.revertedWithCustomError(
      game,
      "InsufficientBalance"
    );
  });

  it("skips invariant assertions when deployed with DEBUG disabled", async function () {
    const [owner, alice] = await ethers.getSigners();
    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
    const gameFactory = await ethers.getContractFactory("CrapsGameHarness");

    const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
    const coordinator = await coordinatorFactory.deploy();
    const game = await gameFactory.deploy(await token.getAddress(), await coordinator.getAddress(), false);

    await token.connect(alice).mint(alice.address, usd(100));
    await token.connect(alice).approve(await game.getAddress(), ethers.MaxUint256);

    await game.connect(alice).deposit(usd(100));

    expect(await game.DEBUG()).to.equal(false);
    expect(await game.availableBalanceOf(alice.address)).to.equal(usd(99_5) / 10n);
  });

  it("routes phase 4 entrypoints through live validation instead of placeholder reverts", async function () {
    const { owner, alice, coordinator, game } = await loadFixture(deployFixture);

    await coordinator.createSubscription();
    await coordinator.addConsumer(1, await game.getAddress());

    await game.connect(owner).fundBankroll(usd(100_000));
    await game.connect(alice).deposit(usd(1_000));
    await expect(game.connect(alice).openSession()).to.emit(game, "SessionOpened").withArgs(alice.address);

    await expect(game.connect(alice).placeIndexedBet(5, 0, usd(100)))
      .to.be.revertedWithCustomError(game, "BetUnavailable");
    await expect(game.connect(alice).removeIndexedBet(6, 0))
      .to.be.revertedWithCustomError(game, "NoActiveBet");
    await expect(game.connect(alice).setPlaceWorking(4, true))
      .to.be.revertedWithCustomError(game, "NoActiveBet");

    await game.connect(alice).placeBet(2, usd(100));
    await game.connect(alice).rollDice();
    const state = await game.getPlayerState(alice.address);
    await coordinator.fulfillRandomWords(state.pendingRequestId, [encodeDice(2, 3)]);

    await expect(game.connect(alice).placeIndexedBet(5, 0, usd(100)))
      .to.be.revertedWithCustomError(game, "NoActiveBet");
    await expect(game.connect(alice).setPlaceWorking(4, false))
      .to.be.revertedWithCustomError(game, "NoActiveBet");
  });

  it("survives 50 deterministic random deposit and withdraw operations with the invariant checked on every step", async function () {
    const { alice, bob, carol, game } = await loadFixture(deployFixture);
    const players = [alice, bob, carol];
    const available = new Map(players.map((player) => [player.address, 0n]));
    let expectedFees = 0n;

    const next = makeRng(1337n);

    for (let i = 0; i < 50; i += 1) {
      const player = players[Number(next() % BigInt(players.length))];
      const currentAvailable = available.get(player.address) ?? 0n;
      const doDeposit = currentAvailable === 0n || next() % 2n === 0n;

      if (doDeposit) {
        const amount = (next() % 500n + 1n) * UNIT;
        const fee = feeFor(amount);

        await game.connect(player).deposit(amount);

        available.set(player.address, currentAvailable + amount - fee);
        expectedFees += fee;
      } else {
        const maxUnits = currentAvailable / UNIT;
        const amount = (next() % maxUnits + 1n) * UNIT;

        await game.connect(player).withdraw(amount);

        available.set(player.address, currentAvailable - amount);
      }

      for (const signer of players) {
        expect(await game.availableBalanceOf(signer.address)).to.equal(available.get(signer.address));
      }
      expect(await game.accruedFees()).to.equal(expectedFees);
      await game.exposedAssertInvariant();
    }
  });
});
