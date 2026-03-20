import { expect } from "chai";
import { ethers } from "hardhat";

const UNIT = 10n ** 6n;
const usd = (value: number) => BigInt(value) * UNIT;

const BetType = {
  PASS_LINE: 0,
  PASS_LINE_ODDS: 1,
  DONT_PASS: 2,
  DONT_PASS_ODDS: 3,
  COME: 4,
  COME_ODDS: 5,
  DONT_COME: 6,
  DONT_COME_ODDS: 7,
  PLACE_4: 8,
  PLACE_5: 9,
  PLACE_6: 10,
  PLACE_8: 11,
  PLACE_9: 12,
  PLACE_10: 13,
  FIELD: 14,
  HARD_4: 15,
  HARD_6: 16,
  HARD_8: 17,
  HARD_10: 18,
  ANY_7: 19,
  ANY_CRAPS: 20,
  CRAPS_2: 21,
  CRAPS_3: 22,
  YO: 23,
  TWELVE: 24,
  HORN: 25
} as const;

const emptyBet = () => ({ amount: 0n, oddsAmount: 0n, point: 0 });
const emptyPlaceBet = () => ({ amount: 0n, working: false });
const emptyBetSlots = () => ({
  passLine: emptyBet(),
  dontPass: emptyBet(),
  come: [emptyBet(), emptyBet(), emptyBet(), emptyBet()],
  dontCome: [emptyBet(), emptyBet(), emptyBet(), emptyBet()],
  place4: emptyPlaceBet(),
  place5: emptyPlaceBet(),
  place6: emptyPlaceBet(),
  place8: emptyPlaceBet(),
  place9: emptyPlaceBet(),
  place10: emptyPlaceBet(),
  hard4: { amount: 0n },
  hard6: { amount: 0n },
  hard8: { amount: 0n },
  hard10: { amount: 0n },
  oneRolls: {
    field: 0n,
    any7: 0n,
    anyCraps: 0n,
    craps2: 0n,
    craps3: 0n,
    yo: 0n,
    twelve: 0n,
    horn: 0n
  }
});

describe("PayoutMath", function () {
  async function deployHarness() {
    const harnessFactory = await ethers.getContractFactory("PayoutMathHarness");
    return harnessFactory.deploy();
  }

  it("returns the expected payout multipliers", async function () {
    const harness = await deployHarness();

    const cases: Array<[number, number, bigint, bigint]> = [
      [BetType.PASS_LINE, 0, 1n, 1n],
      [BetType.DONT_PASS, 0, 1n, 1n],
      [BetType.COME, 0, 1n, 1n],
      [BetType.DONT_COME, 0, 1n, 1n],
      [BetType.PASS_LINE_ODDS, 4, 2n, 1n],
      [BetType.PASS_LINE_ODDS, 5, 3n, 2n],
      [BetType.PASS_LINE_ODDS, 6, 6n, 5n],
      [BetType.DONT_PASS_ODDS, 4, 1n, 2n],
      [BetType.DONT_PASS_ODDS, 5, 2n, 3n],
      [BetType.DONT_PASS_ODDS, 6, 5n, 6n],
      [BetType.COME_ODDS, 10, 2n, 1n],
      [BetType.DONT_COME_ODDS, 9, 2n, 3n],
      [BetType.PLACE_4, 0, 9n, 5n],
      [BetType.PLACE_5, 0, 7n, 5n],
      [BetType.PLACE_6, 0, 7n, 6n],
      [BetType.PLACE_8, 0, 7n, 6n],
      [BetType.PLACE_9, 0, 7n, 5n],
      [BetType.PLACE_10, 0, 9n, 5n],
      [BetType.FIELD, 3, 1n, 1n],
      [BetType.FIELD, 2, 2n, 1n],
      [BetType.FIELD, 12, 2n, 1n],
      [BetType.HARD_4, 0, 7n, 1n],
      [BetType.HARD_6, 0, 9n, 1n],
      [BetType.ANY_7, 0, 4n, 1n],
      [BetType.ANY_CRAPS, 0, 7n, 1n],
      [BetType.CRAPS_2, 0, 30n, 1n],
      [BetType.CRAPS_3, 0, 15n, 1n],
      [BetType.YO, 0, 15n, 1n],
      [BetType.TWELVE, 0, 30n, 1n],
      [BetType.HORN, 2, 27n, 4n],
      [BetType.HORN, 3, 3n, 1n],
      [BetType.HORN, 11, 3n, 1n],
      [BetType.HORN, 12, 27n, 4n]
    ];

    for (const [betType, point, numerator, denominator] of cases) {
      const result = await harness.payoutMultiplier(betType, point);
      expect(result[0]).to.equal(numerator);
      expect(result[1]).to.equal(denominator);
    }
  });

  it("derives the worst-case payout for a come-out 2", async function () {
    const harness = await deployHarness();
    const bets = emptyBetSlots();

    bets.dontPass.amount = usd(500);
    bets.oneRolls.field = usd(500);
    bets.oneRolls.anyCraps = usd(100);
    bets.oneRolls.craps2 = usd(100);
    bets.oneRolls.horn = usd(100);

    expect(await harness.maxPossiblePayout(bets, 0)).to.equal(usd(5875));
  });

  it("derives the worst-case payout for a come-out 12", async function () {
    const harness = await deployHarness();
    const bets = emptyBetSlots();

    bets.oneRolls.field = usd(500);
    bets.oneRolls.anyCraps = usd(100);
    bets.oneRolls.twelve = usd(100);
    bets.oneRolls.horn = usd(100);

    expect(await harness.maxPossiblePayout(bets, 0)).to.equal(usd(5375));
  });

  it("derives the worst-case payout for a hard 4 while the point is 4", async function () {
    const harness = await deployHarness();
    const bets = emptyBetSlots();

    bets.passLine.amount = usd(500);
    bets.passLine.oddsAmount = usd(1500);

    for (let i = 0; i < 4; i += 1) {
      bets.come[i] = {
        amount: usd(500),
        oddsAmount: usd(1500),
        point: 4
      };
    }

    bets.place4 = { amount: usd(500), working: true };
    bets.hard4 = { amount: usd(100) };
    bets.oneRolls.field = usd(500);

    expect(await harness.maxPossiblePayout(bets, 4)).to.equal(usd(19600));
  });
});
