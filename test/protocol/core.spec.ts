import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadAddresses } from "../utils/loadAddresses";

describe("ProtocolCore", function () {
  it("wires core modules", async function () {
    const a = loadAddresses();
    const core = await ethers.getContractAt("ProtocolCore", a.ProtocolCore);
    const factoryAddr = await core.farmFactory();
    expect(factoryAddr.toLowerCase()).to.eq(a.FarmFactory.toLowerCase());
    const consensus = await core.consensus();
    expect(consensus.toLowerCase()).to.eq(a.Consensus.toLowerCase());
    const bridge = await core.bridgeAdapter();
    expect(bridge.toLowerCase()).to.eq(a.MockBridgeAdapter.toLowerCase());
    const lm = await core.liquidityManager();
    expect(lm.toLowerCase()).to.eq(a.MockLiquidityManager.toLowerCase());
  });

  it("owns DXP token", async function () {
    const a = loadAddresses();
    const dxp = await ethers.getContractAt("DXPToken", a.DXPToken);
    const owner = await dxp.owner();
    expect(owner.toLowerCase()).to.eq(a.ProtocolCore.toLowerCase());
  });
});
