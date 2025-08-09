import { expect } from "chai";
import { ethers, network } from "hardhat";
import { parseEther } from "ethers";
import { loadAddresses } from "../utils/loadAddresses";

describe("RootFarm owner flows", function () {
  let addresses: any;
  let deployer: any;

  before(async () => {
    [deployer] = await ethers.getSigners();
    addresses = await loadAddresses(network.name);
  });

  it("deploy/withdraw liquidity and rebalance as farmOwner", async () => {
    const farm = await ethers.getContractAt("RootFarm", addresses.RootFarm);
    const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken);
    const strat = await ethers.getContractAt("RootAnchorMMStrategy", addresses.RootAnchorMMStrategy);

    const depositAmt = parseEther("1000");
    await dxp.connect(deployer).approve(await farm.getAddress(), depositAmt);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await farm.connect(deployer).provideLiquidity(depositAmt, BigInt(now + 60 * 60 * 24 * 35));

    const availBefore = await farm.availableLiquidity();
    const tvlBefore = await strat.getStrategyTVL();

    const toDeploy = depositAmt / 2n;
    await farm.connect(deployer).deployLiquidity(toDeploy);
    const availAfterDeploy = await farm.availableLiquidity();
    const tvlAfterDeploy = await strat.getStrategyTVL();

    expect(availAfterDeploy).to.equal(availBefore - toDeploy);
    expect(tvlAfterDeploy).to.equal(tvlBefore + toDeploy);

    const toWithdraw = toDeploy / 2n;
    await farm.connect(deployer).withdrawFromStrategy(toWithdraw);
    const availAfterW = await farm.availableLiquidity();
    const tvlAfterW = await strat.getStrategyTVL();

    expect(availAfterW).to.equal(availAfterDeploy + toWithdraw);
    expect(tvlAfterW).to.equal(tvlAfterDeploy - toWithdraw);

    await expect(farm.connect(deployer).rebalanceStrategy()).to.not.be.reverted;
    await expect(farm.connect(deployer).rebalanceStrategy("0x")).to.not.be.reverted;
  });

  it("start epoch, set reserves and rebalance to target", async () => {
    const farm = await ethers.getContractAt("RootFarm", addresses.RootFarm);

    await farm.connect(deployer).setReserveRatioBps(2000);
    await farm.connect(deployer).setMinReserve(parseEther("100"));
    await farm.connect(deployer).startEpoch(3000, parseEther("50"));

    await expect(farm.connect(deployer).rebalanceToTarget()).to.not.be.reverted;
  });

  it("pause/unpause gates LP actions", async () => {
    const farm = await ethers.getContractAt("RootFarm", addresses.RootFarm);
    const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken);

    const amt = parseEther("10");
    await dxp.connect(deployer).approve(await farm.getAddress(), amt);

    await farm.connect(deployer).pause();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await expect(
      farm.connect(deployer).provideLiquidity(amt, BigInt(now + 60 * 60 * 24 * 40))
    ).to.be.reverted;

    await farm.connect(deployer).unpause();
    await expect(
      farm.connect(deployer).provideLiquidity(amt, BigInt(now + 60 * 60 * 24 * 40))
    ).to.not.be.reverted;
  });

  it("migrate strategy after pause", async () => {
    const farm = await ethers.getContractAt("RootFarm", addresses.RootFarm);
    const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken);

    await farm.connect(deployer).pause();

    const Strat = await ethers.getContractFactory("RootAnchorMMStrategy");
    const newStrat = await Strat.deploy(await farm.getAddress(), await dxp.getAddress());
    await newStrat.waitForDeployment();
    await newStrat.initialize(3000, BigInt("79228162514264337593543950336"), parseEther("100"), parseEther("50"),
      "0xE358a174c91C01E3804b96a34f4839750F062bD9", addresses.MockLiquidityManager, parseEther("1"), 3600);

    await expect(farm.connect(deployer).migrateStrategy(await newStrat.getAddress())).to.not.be.reverted;
  });
});
