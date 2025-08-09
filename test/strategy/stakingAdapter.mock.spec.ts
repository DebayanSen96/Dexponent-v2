import { expect } from "chai";
import { ethers, network } from "hardhat";
import { parseEther } from "ethers";
import { loadAddresses } from "../utils/loadAddresses";

describe("MockStakingAdapter", function () {
  let deployer: any;
  let addresses: any;

  before(async () => {
    [deployer] = await ethers.getSigners();
    addresses = await loadAddresses(network.name);
  });

  it("deposit/withdraw updates totals and balances", async () => {
    const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken);
    const Adapter = await ethers.getContractFactory("MockStakingAdapter");
    const adapter = await Adapter.deploy();
    await adapter.waitForDeployment();

    const amt = parseEther("200");
    const startBal = await dxp.balanceOf(deployer.address);

    await dxp.connect(deployer).approve(await adapter.getAddress(), amt);
    await adapter.deposit(await dxp.getAddress(), amt);

    const afterDepUser = await dxp.balanceOf(deployer.address);
    const adapterBal = await dxp.balanceOf(await adapter.getAddress());
    const totalAssets = await adapter.totalAssets(await dxp.getAddress());

    expect(startBal - afterDepUser).to.equal(amt);
    expect(adapterBal).to.equal(amt);
    expect(totalAssets).to.equal(amt);

    const wd = parseEther("80");
    await adapter.withdraw(await dxp.getAddress(), wd);

    const afterWdUser = await dxp.balanceOf(deployer.address);
    const adapterBal2 = await dxp.balanceOf(await adapter.getAddress());
    const totalAssets2 = await adapter.totalAssets(await dxp.getAddress());

    expect(afterWdUser - afterDepUser).to.equal(wd);
    expect(adapterBal2).to.equal(amt - wd);
    expect(totalAssets2).to.equal(amt - wd);

    const pending = await adapter.pendingRewards(await dxp.getAddress());
    expect(pending).to.equal(0);
    const harvested = await adapter.harvest(await dxp.getAddress());
    expect(harvested).to.equal(0);
  });
});
