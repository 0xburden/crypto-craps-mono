import { expect } from "chai";
import { ethers } from "hardhat";

export const UNIT = 10n ** 6n;
export const usd = (value: number) => BigInt(value) * UNIT;

export const BetType = {
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

export const SessionPhase = {
  INACTIVE: 0n,
  COME_OUT: 1n,
  POINT: 2n,
  ROLL_PENDING: 3n
} as const;

export const PuckState = {
  OFF: 0n,
  ON: 1n
} as const;

export const encodeDice = (die1: number, die2: number) => {
  const high = BigInt(die2 - 1);
  const low = (BigInt(die1 - 1) - ((high << 8n) % 6n) + 6n) % 6n;
  return low | (high << 8n);
};

export async function deployGameFixture() {
  const [owner, alice, bob, carol, treasury] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory("MockERC20");
  const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
  const gameFactory = await ethers.getContractFactory("CrapsGame");

  const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
  const coordinator = await coordinatorFactory.deploy();
  const game = await gameFactory.deploy(await token.getAddress(), await coordinator.getAddress(), 1, ethers.ZeroHash, true);

  const richAmount = usd(1_000_000);
  for (const signer of [owner, alice, bob, carol]) {
    await token.connect(signer).mint(signer.address, richAmount);
    await token.connect(signer).approve(await game.getAddress(), ethers.MaxUint256);
  }

  await coordinator.createSubscription();
  await coordinator.addConsumer(1, await game.getAddress());

  return { owner, alice, bob, carol, treasury, token, coordinator, game };
}

export async function rollAndFulfill(
  game: Awaited<ReturnType<typeof deployGameFixture>>["game"],
  coordinator: Awaited<ReturnType<typeof deployGameFixture>>["coordinator"],
  roller: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  die1: number,
  die2: number
) {
  await game.connect(roller).rollDice();
  const state = await game.getPlayerState(roller.address);
  await coordinator.fulfillRandomWords(state.pendingRequestId, [encodeDice(die1, die2)]);
  return state.pendingRequestId;
}

export async function assertInvariant(
  game: Awaited<ReturnType<typeof deployGameFixture>>["game"],
  players: Array<Awaited<ReturnType<typeof ethers.getSigners>>[number]>
) {
  const states = await Promise.all(players.map((player) => game.getPlayerState(player.address)));

  let sumAvailable = 0n;
  let sumInPlay = 0n;
  let sumReserved = 0n;

  for (const state of states) {
    sumAvailable += state.available;
    sumInPlay += state.inPlay;
    sumReserved += state.reserved;
  }

  const token = await ethers.getContractAt("MockERC20", await game.token());
  const contractBalance = await token.balanceOf(await game.getAddress());
  const houseState = states[0];
  expect(contractBalance).to.equal(sumAvailable + sumInPlay + sumReserved + houseState.bankroll + houseState.accruedFees);
}
