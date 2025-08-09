import { expect } from "chai";
import { ethers } from "hardhat";
import { loadAddresses } from "../utils/loadAddresses";

describe("RootFarm (read)", function () {
  it("has ProtocolCore as owner and valid wiring", async function () {
    const a = loadAddresses();
    const farm = await ethers.getContractAt("RootFarm", a.RootFarm);
    const owner = await farm.owner();
    expect(owner.toLowerCase()).to.eq(a.ProtocolCore.toLowerCase());
    const protocol = await farm.protocolMaster();
    expect(protocol.toLowerCase()).to.eq(a.ProtocolCore.toLowerCase());
    const strategy = await farm.strategy();
    expect(strategy).to.properAddress;
    const claimToken = await farm.claimToken();
    expect(claimToken).to.properAddress;
  });

  it("exposes incentive splits and reserve data", async function () {
    const a = loadAddresses();
    const farm = await ethers.getContractAt("RootFarm", a.RootFarm);
    const lp = await farm.lpIncentiveSplit();
    const ver = await farm.verifierIncentiveSplit();
    const yy = await farm.yieldYodaIncentiveSplit();
    const fo = await farm.farmOwnerIncentiveSplit();
    const sum = lp + ver + yy + fo;
    expect(sum).to.be.greaterThan(0);
    expect(sum).to.be.lessThanOrEqual(100);
    const reserveRatio = await farm.reserveRatioBps();
    expect(reserveRatio).to.be.greaterThanOrEqual(0);
    const minReserve = await farm.minReserve();
    expect(minReserve).to.be.greaterThanOrEqual(0);
  });

  it("reports liquidity and yield accounting fields", async function () {
    const a = loadAddresses();
    const farm = await ethers.getContractAt("RootFarm", a.RootFarm);
    const total = await farm.totalLiquidity();
    const deployed = await farm.deployedLiquidity();
    expect(deployed).to.be.at.most(total);
    const available = await farm.availableLiquidity();
    expect(available).to.equal(total - deployed);
    const acc = await farm.accYieldPerShare();
    expect(acc).to.be.greaterThanOrEqual(0);
  });
});
