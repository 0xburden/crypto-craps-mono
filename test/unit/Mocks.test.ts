import { expect } from "chai";
import { ethers } from "hardhat";

const UNIT = 10n ** 6n;

describe("Mocks", function () {
  it("MockERC20 supports 6 decimals, minting, and EIP-2612 permit", async function () {
    const [deployer, owner, spender] = await ethers.getSigners();
    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const token = await tokenFactory.deploy("Mock USDC", "mUSDC");

    expect(await token.decimals()).to.equal(6);

    await token.connect(spender).mint(owner.address, 250n * UNIT);
    expect(await token.balanceOf(owner.address)).to.equal(250n * UNIT);

    const nonce = await token.nonces(owner.address);
    const deadline = ethers.MaxUint256;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const signature = await owner.signTypedData(
      {
        name: "Mock USDC",
        version: "1",
        chainId,
        verifyingContract: await token.getAddress()
      },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      },
      {
        owner: owner.address,
        spender: spender.address,
        value: 25n * UNIT,
        nonce,
        deadline
      }
    );

    const { v, r, s } = ethers.Signature.from(signature);

    await token
      .connect(deployer)
      .permit(owner.address, spender.address, 25n * UNIT, deadline, v, r, s);

    expect(await token.allowance(owner.address, spender.address)).to.equal(25n * UNIT);
  });

  it("MockVRFCoordinator stores pending requests and fulfills them", async function () {
    const [owner] = await ethers.getSigners();
    const coordinatorFactory = await ethers.getContractFactory("MockVRFCoordinator");
    const consumerFactory = await ethers.getContractFactory("MockVRFConsumer");

    const coordinator = await coordinatorFactory.deploy();
    const consumer = await consumerFactory.deploy(await coordinator.getAddress());

    await coordinator.createSubscription();
    await coordinator.addConsumer(1, await consumer.getAddress());

    await consumer.requestRandomWords(ethers.ZeroHash, 1, 3, 500_000, 2);

    const request = await coordinator.pendingRequests(1);
    expect(request.consumer).to.equal(await consumer.getAddress());
    expect(request.subId).to.equal(1);
    expect(request.numWords).to.equal(2);
    expect(request.exists).to.equal(true);
    expect(await coordinator.pendingRequestExists(1)).to.equal(true);

    await coordinator.fulfillRandomWords(1, [123n, 456n]);

    expect(await consumer.lastRequestId()).to.equal(1);
    expect(await consumer.lastFulfilledRequestId()).to.equal(1);
    expect(await consumer.getLastRandomWords()).to.deep.equal([123n, 456n]);
    expect(await coordinator.pendingRequestExists(1)).to.equal(false);

    const subscription = await coordinator.getSubscription(1);
    expect(subscription[2]).to.equal(1);
    expect(subscription[3]).to.equal(owner.address);
  });
});
