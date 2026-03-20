import { expect } from "chai";
import { ethers } from "hardhat";

import { usd } from "./helpers/gameFixture";

describe("WorstCaseAudit", function () {
  it("matches the PLAN.md phase-4 bankroll sizing worst-case reserve derivation", async function () {
    const harnessFactory = await ethers.getContractFactory("PayoutMathHarness");
    const harness = await harnessFactory.deploy();

    const bets = {
      passLine: { amount: usd(500), oddsAmount: usd(1_500), point: 4 },
      dontPass: { amount: 0n, oddsAmount: 0n, point: 0 },
      come: Array.from({ length: 4 }, () => ({ amount: usd(500), oddsAmount: usd(1_500), point: 4 })),
      dontCome: Array.from({ length: 4 }, () => ({ amount: 0n, oddsAmount: 0n, point: 0 })),
      place4: { amount: usd(500), working: true },
      place5: { amount: 0n, working: false },
      place6: { amount: 0n, working: false },
      place8: { amount: 0n, working: false },
      place9: { amount: 0n, working: false },
      place10: { amount: 0n, working: false },
      hard4: { amount: usd(100) },
      hard6: { amount: 0n },
      hard8: { amount: 0n },
      hard10: { amount: 0n },
      oneRolls: {
        field: usd(500),
        any7: 0n,
        anyCraps: 0n,
        craps2: 0n,
        craps3: 0n,
        yo: 0n,
        twelve: 0n,
        horn: 0n
      }
    };

    expect(await harness.maxPossiblePayout(bets, 4)).to.equal(usd(19_600));
  });
});
