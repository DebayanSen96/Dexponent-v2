import { expect } from "chai";
import { ethers } from "hardhat";
import { loadAddresses } from "../utils/loadAddresses";
import { isContract } from "../utils/evm";

describe("RootAnchorMMStrategy (read)", function () {
  it("is linked to the RootFarm and reports addresses", async function () {
    const a = loadAddresses();
    const strategy = await ethers.getContractAt("RootAnchorMMStrategy", a.RootAnchorMMStrategy);
    const farm = await strategy.farm();
    expect(farm.toLowerCase()).to.eq(a.RootFarm.toLowerCase());
    const asset = await strategy.asset();
    expect(await isContract(asset)).to.be.true;
  });

  it("exposes tvl and basic getters without revert", async function () {
    const a = loadAddresses();
    const strategy = await ethers.getContractAt("RootAnchorMMStrategy", a.RootAnchorMMStrategy);
    const tvl = await strategy.getStrategyTVL();
    expect(tvl).to.be.greaterThanOrEqual(0);
  });
});
