import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { BetType, encodeDice, PuckState, SessionPhase, usd } from "../unit/helpers/gameFixture";

const UNIT = 1_000_000n;
const PLAYERS = ["alice", "bob", "carol"] as const;
const STEP_COUNT = 200;
const BANKROLL_TOP_UP_THRESHOLD = usd(80_000);
const BANKROLL_TOP_UP_TARGET = usd(200_000);

function makeRng(seed: bigint) {
  let state = seed;

  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return state;
  };
}

function pickIndex(rng: () => bigint, length: number) {
  return Number(rng() % BigInt(length));
}

function usdBig(units: bigint) {
  return units * UNIT;
}

function chooseUnits(rng: () => bigint, minUnits: bigint, maxUnits: bigint, stepUnits = 1n) {
  if (maxUnits < minUnits) {
    return 0n;
  }

  const span = (maxUnits - minUnits) / stepUnits;
  return minUnits + (span === 0n ? 0n : (rng() % (span + 1n)) * stepUnits);
}

function pointOddsDenominator(point: bigint) {
  if (point === 4n || point === 10n) return 1n;
  if (point === 5n || point === 9n) return 2n;
  if (point === 6n || point === 8n) return 5n;
  return 0n;
}

async function deployIntegrationFixture() {
  const [owner, alice, bob, carol] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory("MockERC20");
  const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
  const gameFactory = await ethers.getContractFactory("CrapsGame");

  const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
  const coordinator = await coordinatorFactory.deploy();
  const game = await gameFactory.deploy(await token.getAddress(), await coordinator.getAddress(), 1n, ethers.ZeroHash, true);

  const minted = usd(1_000_000);
  for (const signer of [owner, alice, bob, carol]) {
    await token.connect(signer).mint(signer.address, minted);
    await token.connect(signer).approve(await game.getAddress(), ethers.MaxUint256);
  }

  await coordinator.createSubscription();
  await coordinator.addConsumer(1, await game.getAddress());
  await game.connect(owner).fundBankroll(usd(250_000));

  for (const player of [alice, bob, carol]) {
    await game.connect(player).deposit(usd(1_000));
    await game.connect(player).openSession();
    await game.connect(player).placeBet(BetType.PASS_LINE, usd(10));
  }

  return { owner, alice, bob, carol, token, coordinator, game };
}

async function assertFiveBucketInvariant(
  game: Awaited<ReturnType<typeof deployIntegrationFixture>>["game"],
  token: Awaited<ReturnType<typeof deployIntegrationFixture>>["token"],
  players: Array<Awaited<ReturnType<typeof ethers.getSigners>>[number]>
) {
  const contractBalance = await token.balanceOf(await game.getAddress());
  const houseState = await game.getPlayerState(players[0].address);

  let sum = 0n;
  for (const player of players) {
    const state = await game.getPlayerState(player.address);
    sum += state.available + state.inPlay + state.reserved;
  }

  expect(contractBalance).to.equal(sum + houseState.bankroll + houseState.accruedFees);
}

async function expireAnyExpiredSessions(
  game: Awaited<ReturnType<typeof deployIntegrationFixture>>["game"],
  owner: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  players: Array<Awaited<ReturnType<typeof ethers.getSigners>>[number]>
) {
  const activePlayers: string[] = [];
  for (const player of players) {
    const state = await game.getPlayerState(player.address);
    if (state.phase !== SessionPhase.INACTIVE) {
      activePlayers.push(player.address);
    }
  }

  if (activePlayers.length === 0) {
    return false;
  }

  await time.increase(24 * 60 * 60 + 1);
  for (const address of activePlayers) {
    await game.connect(owner).expireSession(address);
  }
  return true;
}

function placeAmount(
  rng: () => bigint,
  maxAvailable: bigint,
  minUnits: bigint,
  maxUnits: bigint,
  stepUnits = 1n
) {
  const maxByWallet = maxAvailable / UNIT;
  const cappedMax = maxUnits < maxByWallet ? maxUnits : maxByWallet;
  const units = chooseUnits(rng, minUnits, cappedMax, stepUnits);
  return units === 0n ? 0n : usdBig(units);
}

describe("Integration / invariant random", function () {
  it("preserves the five-bucket invariant across 200 randomized multi-player actions", async function () {
    this.timeout(180_000);

    const { owner, alice, bob, carol, token, coordinator, game } = await loadFixture(deployIntegrationFixture);
    const players = [alice, bob, carol];
    const rng = makeRng(0xC0FFEEn);

    await assertFiveBucketInvariant(game, token, players);

    for (let step = 0; step < STEP_COUNT; step += 1) {
      if (step > 0 && step % 50 === 0) {
        await expireAnyExpiredSessions(game, owner, players);
        await assertFiveBucketInvariant(game, token, players);
      }

      const bankroll = (await game.getPlayerState(owner.address)).bankroll;
      if (bankroll < BANKROLL_TOP_UP_THRESHOLD) {
        const topUpAmount = BANKROLL_TOP_UP_TARGET - bankroll;
        await game.connect(owner).fundBankroll(topUpAmount);
        await assertFiveBucketInvariant(game, token, players);
        continue;
      }

      const accruedFees = (await game.getPlayerState(owner.address)).accruedFees;
      if (accruedFees >= usd(100)) {
        await game.connect(owner).withdrawFees(owner.address);
        await assertFiveBucketInvariant(game, token, players);
        continue;
      }

      const player = players[pickIndex(rng, players.length)];
      const state = await game.getPlayerState(player.address);
      const actions: Array<() => Promise<void>> = [];

      if (state.phase === SessionPhase.INACTIVE) {
        actions.push(async () => {
          await game.connect(player).openSession();
        });
      } else {
        actions.push(async () => {
          await game.connect(player).closeSession();
        });
      }

      if (state.available >= usd(1)) {
        const depositAmount = placeAmount(rng, state.available, 1n, 25n);
        if (depositAmount !== 0n) {
          actions.push(async () => {
            await game.connect(player).deposit(depositAmount);
          });
        }
      }

      if (state.available >= usd(1)) {
        const withdrawAmount = placeAmount(rng, state.available, 1n, 25n);
        if (withdrawAmount !== 0n) {
          actions.push(async () => {
            await game.connect(player).withdraw(withdrawAmount);
          });
        }
      }

      if (state.phase !== SessionPhase.INACTIVE && state.phase !== SessionPhase.ROLL_PENDING) {
        if (state.puckState === PuckState.OFF) {
          if (state.bets.dontPass.amount === 0n) {
            const amount = placeAmount(rng, state.available, 1n, 25n);
            if (amount !== 0n) {
              actions.push(async () => {
                await game.connect(player).placeBet(BetType.DONT_PASS, amount);
              });
            }
          }

          for (const betType of [BetType.FIELD, BetType.ANY_7, BetType.ANY_CRAPS, BetType.CRAPS_2, BetType.CRAPS_3, BetType.YO, BetType.TWELVE] as const) {
            const minUnits = betType === BetType.ANY_7 || betType === BetType.ANY_CRAPS || betType === BetType.YO ? 1n : 1n;
            const maxUnits = betType === BetType.CRAPS_2 || betType === BetType.CRAPS_3 || betType === BetType.TWELVE ? 5n : 25n;
            const amount = placeAmount(rng, state.available, minUnits, maxUnits);
            if (amount !== 0n) {
              actions.push(async () => {
                await game.connect(player).placeBet(betType, amount);
              });
            }
          }

          const hornAmount = placeAmount(rng, state.available, 4n, 8n, 4n);
          if (hornAmount !== 0n) {
            actions.push(async () => {
              await game.connect(player).placeBet(BetType.HORN, hornAmount);
            });
          }
        } else {
          for (const betType of [
            BetType.FIELD,
            BetType.COME,
            BetType.DONT_COME,
            BetType.PLACE_4,
            BetType.PLACE_5,
            BetType.PLACE_6,
            BetType.PLACE_8,
            BetType.PLACE_9,
            BetType.PLACE_10,
            BetType.HARD_4,
            BetType.HARD_6,
            BetType.HARD_8,
            BetType.HARD_10,
            BetType.ANY_7,
            BetType.ANY_CRAPS,
            BetType.CRAPS_2,
            BetType.CRAPS_3,
            BetType.YO,
            BetType.TWELVE,
            BetType.HORN
          ] as const) {
            let amount: bigint;
            if (
              betType === BetType.PLACE_4 ||
              betType === BetType.PLACE_5 ||
              betType === BetType.PLACE_9 ||
              betType === BetType.PLACE_10
            ) {
              amount = placeAmount(rng, state.available, 5n, 25n, 5n);
            } else if (betType === BetType.PLACE_6 || betType === BetType.PLACE_8) {
              amount = placeAmount(rng, state.available, 6n, 24n, 6n);
            } else if (betType === BetType.HORN) {
              amount = placeAmount(rng, state.available, 4n, 8n, 4n);
            } else if (betType === BetType.HARD_4 || betType === BetType.HARD_6 || betType === BetType.HARD_8 || betType === BetType.HARD_10) {
              amount = placeAmount(rng, state.available, 1n, 10n);
            } else if (betType === BetType.ANY_7 || betType === BetType.ANY_CRAPS || betType === BetType.YO) {
              amount = placeAmount(rng, state.available, 1n, 10n);
            } else if (betType === BetType.CRAPS_2 || betType === BetType.CRAPS_3 || betType === BetType.TWELVE) {
              amount = placeAmount(rng, state.available, 1n, 5n);
            } else {
              amount = placeAmount(rng, state.available, 1n, 25n);
            }

            if (amount !== 0n) {
              actions.push(async () => {
                await game.connect(player).placeBet(betType, amount);
              });
            }
          }

          const activeComeSlot = state.bets.come.findIndex((bet) => bet.amount > 0n && bet.point > 0n);
          if (activeComeSlot >= 0) {
            const comeBet = state.bets.come[activeComeSlot];
            const denominator = pointOddsDenominator(BigInt(comeBet.point));
            const remainingMax = comeBet.amount * 3n - comeBet.oddsAmount;
            const maxUnits = remainingMax / UNIT;
            if (denominator > 0n && maxUnits >= denominator) {
              const oddsUnits = chooseUnits(rng, denominator, maxUnits, denominator);
              if (oddsUnits !== 0n) {
                actions.push(async () => {
                  await game.connect(player).placeIndexedBet(BetType.COME_ODDS, activeComeSlot, usdBig(oddsUnits));
                });
              }
            }
            if (comeBet.oddsAmount > 0n) {
              actions.push(async () => {
                await game.connect(player).removeIndexedBet(BetType.COME_ODDS, activeComeSlot);
              });
            }
          }

          const activeDontComeSlot = state.bets.dontCome.findIndex((bet) => bet.amount > 0n && bet.point > 0n);
          if (activeDontComeSlot >= 0) {
            const dontComeBet = state.bets.dontCome[activeDontComeSlot];
            const denominator = pointOddsDenominator(BigInt(dontComeBet.point));
            const remainingMax = dontComeBet.amount * 3n - dontComeBet.oddsAmount;
            const maxUnits = remainingMax / UNIT;
            if (denominator > 0n && maxUnits >= denominator) {
              const oddsUnits = chooseUnits(rng, denominator, maxUnits, denominator);
              if (oddsUnits !== 0n) {
                actions.push(async () => {
                  await game.connect(player).placeIndexedBet(BetType.DONT_COME_ODDS, activeDontComeSlot, usdBig(oddsUnits));
                });
              }
            }
            if (dontComeBet.oddsAmount > 0n) {
              actions.push(async () => {
                await game.connect(player).removeIndexedBet(BetType.DONT_COME_ODDS, activeDontComeSlot);
              });
            }
          }

          const placeSlots = [
            { betType: BetType.PLACE_4, number: 4, amount: state.bets.place4.amount, working: state.bets.place4.working },
            { betType: BetType.PLACE_5, number: 5, amount: state.bets.place5.amount, working: state.bets.place5.working },
            { betType: BetType.PLACE_6, number: 6, amount: state.bets.place6.amount, working: state.bets.place6.working },
            { betType: BetType.PLACE_8, number: 8, amount: state.bets.place8.amount, working: state.bets.place8.working },
            { betType: BetType.PLACE_9, number: 9, amount: state.bets.place9.amount, working: state.bets.place9.working },
            { betType: BetType.PLACE_10, number: 10, amount: state.bets.place10.amount, working: state.bets.place10.working }
          ] as const;

          for (const slot of placeSlots) {
            if (slot.amount > 0n) {
              actions.push(async () => {
                await game.connect(player).removeBet(slot.betType);
              });
              actions.push(async () => {
                await game.connect(player).setPlaceWorking(slot.number, !slot.working);
              });
            }
          }

          for (const [betType, amount] of [
            [BetType.HARD_4, state.bets.hard4.amount],
            [BetType.HARD_6, state.bets.hard6.amount],
            [BetType.HARD_8, state.bets.hard8.amount],
            [BetType.HARD_10, state.bets.hard10.amount]
          ] as const) {
            if (amount > 0n) {
              actions.push(async () => {
                await game.connect(player).removeBet(betType);
              });
            }
          }

          for (const [betType, amount] of [
            [BetType.FIELD, state.bets.oneRolls.field],
            [BetType.ANY_7, state.bets.oneRolls.any7],
            [BetType.ANY_CRAPS, state.bets.oneRolls.anyCraps],
            [BetType.CRAPS_2, state.bets.oneRolls.craps2],
            [BetType.CRAPS_3, state.bets.oneRolls.craps3],
            [BetType.YO, state.bets.oneRolls.yo],
            [BetType.TWELVE, state.bets.oneRolls.twelve],
            [BetType.HORN, state.bets.oneRolls.horn]
          ] as const) {
            if (amount > 0n) {
              actions.push(async () => {
                await game.connect(player).removeBet(betType);
              });
            }
          }

          if (state.inPlay > 0n) {
            actions.push(async () => {
              const die1 = Number((rng() % 6n) + 1n);
              const die2 = Number((rng() % 6n) + 1n);
              await game.connect(player).rollDice();
              const pendingState = await game.getPlayerState(player.address);
              await coordinator.fulfillRandomWords(pendingState.pendingRequestId, [encodeDice(die1, die2)]);
            });
          }
        }
      }

      expect(actions.length, `no valid actions for step ${step} and player ${player.address}`).to.be.greaterThan(0);
      await actions[pickIndex(rng, actions.length)]();
      await assertFiveBucketInvariant(game, token, players);
    }

    await assertFiveBucketInvariant(game, token, players);
  });
});
