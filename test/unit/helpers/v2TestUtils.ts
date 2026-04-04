import { existsSync } from "fs";
import { ethers } from "hardhat";

export const V2_UNIT = 10n ** 6n;
export const usdV2 = (value: number) => BigInt(value) * V2_UNIT;

export const BetTypeV2 = {
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
  HORN: 25,
  LAY_4: 26,
  LAY_5: 27,
  LAY_6: 28,
  LAY_8: 29,
  LAY_9: 30,
  LAY_10: 31,
} as const;

export const ActionKindV2 = {
  PLACE_BET: 0,
  PLACE_INDEXED_BET: 1,
  REMOVE_BET: 2,
  REMOVE_INDEXED_BET: 3,
  SET_BOX_WORKING: 4,
} as const;

export const SessionPhaseV2 = {
  INACTIVE: 0n,
  COME_OUT: 1n,
  POINT: 2n,
  ROLL_PENDING: 3n,
} as const;

export const hasV2Artifacts = () =>
  existsSync("artifacts/contracts/CrapsGameV2.sol/CrapsGameV2.json") ||
  existsSync("artifacts/contracts/CrapsGameV2.sol/CrapsGameV2.dbg.json");

export async function deployGameV2Fixture() {
  const [owner, alice, bob, carol, treasury] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory("MockERC20");
  const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
  const resolverFactory = await ethers.getContractFactory("RollResolutionV2");

  const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
  const coordinator = await coordinatorFactory.deploy();
  const resolver = await resolverFactory.deploy();
  const gameFactory = await ethers.getContractFactory("CrapsGameV2", {
    libraries: {
      RollResolutionV2: await resolver.getAddress(),
    },
  });
  const game = await gameFactory.deploy(
    await token.getAddress(),
    await coordinator.getAddress(),
    1,
    ethers.ZeroHash,
  );

  const richAmount = usdV2(1_000_000);
  for (const signer of [owner, alice, bob, carol]) {
    await token.connect(signer).mint(signer.address, richAmount);
    await token.connect(signer).approve(await game.getAddress(), ethers.MaxUint256);
  }

  await coordinator.createSubscription();
  await coordinator.addConsumer(1, await game.getAddress());

  return { owner, alice, bob, carol, treasury, token, coordinator, resolver, game };
}

export async function placeBetV2(
  game: Awaited<ReturnType<typeof deployGameV2Fixture>>["game"],
  player: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  betType: number,
  amount: bigint,
) {
  return game.connect(player).executeTurn([[ActionKindV2.PLACE_BET, betType, 0, amount, false]], false);
}

export async function placeIndexedBetV2(
  game: Awaited<ReturnType<typeof deployGameV2Fixture>>["game"],
  player: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  betType: number,
  index: number,
  amount: bigint,
) {
  return game.connect(player).executeTurn([[ActionKindV2.PLACE_INDEXED_BET, betType, index, amount, false]], false);
}

export async function removeBetV2(
  game: Awaited<ReturnType<typeof deployGameV2Fixture>>["game"],
  player: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  betType: number,
) {
  return game.connect(player).executeTurn([[ActionKindV2.REMOVE_BET, betType, 0, 0n, false]], false);
}

export async function setBoxWorkingV2(
  game: Awaited<ReturnType<typeof deployGameV2Fixture>>["game"],
  player: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  betType: number,
  working: boolean,
) {
  return game.connect(player).executeTurn([[ActionKindV2.SET_BOX_WORKING, betType, 0, 0n, working]], false);
}

export async function rollAndFulfillV2(
  game: Awaited<ReturnType<typeof deployGameV2Fixture>>["game"],
  coordinator: Awaited<ReturnType<typeof deployGameV2Fixture>>["coordinator"],
  roller: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  die1: number,
  die2: number,
) {
  await game.connect(roller).executeTurn([], true);
  const state = await game.getPlayerState(roller.address);
  await coordinator.fulfillRandomWords(state.pendingRequestId, [encodeDiceV2(die1, die2)]);
  return state.pendingRequestId;
}

export function encodeDiceV2(die1: number, die2: number) {
  const high = BigInt(die2 - 1);
  const low = (BigInt(die1 - 1) - ((high << 8n) % 6n) + 6n) % 6n;
  return low | (high << 8n);
}
