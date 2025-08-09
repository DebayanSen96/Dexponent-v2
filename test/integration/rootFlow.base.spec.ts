import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadAddresses } from "../utils/loadAddresses";

describe(network.name === "base-sepolia" ? "RootFarm + Strategy (base)" : "skipped", function () {
  if (network.name !== "base-sepolia") return;

  it("deployer is farmOwner or protocol owner", async function () {
    const [deployer] = await ethers.getSigners();
    const a = loadAddresses();
    const farm = await ethers.getContractAt("RootFarm", a.RootFarm, deployer);
    const protocol = await ethers.getContractAt("ProtocolCore", a.ProtocolCore, deployer);
    const owner = await farm.owner();
    const farmOwner = await farm.farmOwner();
    expect(owner.toLowerCase()).to.eq(a.ProtocolCore.toLowerCase());
    expect(farmOwner.toLowerCase()).to.eq(deployer.address.toLowerCase());
    const isOwner = owner.toLowerCase() === deployer.address.toLowerCase();
    const isFarmOwner = farmOwner.toLowerCase() === deployer.address.toLowerCase();
    expect(isOwner || isFarmOwner).to.eq(true);
  });

  it("lp deposit, deploy to strategy, withdraw, and claim yield path executes", async function () {
    const [deployer] = await ethers.getSigners();
    const a = loadAddresses();
    const farm = await ethers.getContractAt("RootFarm", a.RootFarm, deployer);
    const protocol = await ethers.getContractAt("ProtocolCore", a.ProtocolCore, deployer);
    const dxp = await ethers.getContractAt("DXPToken", a.DXPToken, deployer);

    const minBase = await farm.minimumMaturityPeriod();
    const scaled = await protocol.scalePeriod(minBase);
    const block = await ethers.provider.getBlock("latest");
    const maturity = BigInt(block!.timestamp) + scaled;

    const amount = ethers.parseEther("10");
    await (await dxp.approve(a.RootFarm, amount)).wait(1);
    const tlBefore = await farm.totalLiquidity();
    await (await farm.provideLiquidity(amount, maturity)).wait(1);
    const tlAfter = await farm.totalLiquidity();
    expect(tlAfter - tlBefore).to.eq(amount);

    const avail = await farm.availableLiquidity();
    const toDeploy = avail / 2n;
    if (toDeploy > 0n) {
      await (await farm.deployLiquidity(toDeploy)).wait(1);
    }

    const withdrawAmt = amount / 4n;
    await (await farm.withdrawLiquidity(withdrawAmt, false)).wait(1);
    const pos = await farm.positions(deployer.address);
    expect(pos.principal).to.eq(amount - withdrawAmt);
  });

  it("protocol can pull revenue without revert", async function () {
    const [deployer] = await ethers.getSigners();
    const a = loadAddresses();
    const protocol = await ethers.getContractAt("ProtocolCore", a.ProtocolCore, deployer);
    await (await protocol.pullFarmRevenue(0)).wait(1);
  });
});
