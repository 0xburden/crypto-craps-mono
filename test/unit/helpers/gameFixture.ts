import { ethers } from "hardhat";

export const UNIT = 10n ** 6n;
export const usd = (value: number) => BigInt(value) * UNIT;

export const BetType = {
  PASS_LINE: 0,
  DONT_PASS: 2,
  FIELD: 14
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
  const gameFactory = await ethers.getContractFactory("CrapsGameHarness");

  const token = await tokenFactory.deploy("Mock USDC", "mUSDC");
  const coordinator = await coordinatorFactory.deploy();
  const game = await gameFactory.deploy(await token.getAddress(), await coordinator.getAddress(), true);

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
