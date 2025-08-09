import { expect } from "chai";
import { ethers } from "hardhat";
import { loadAddresses } from "../utils/loadAddresses";

describe("FarmFactory (read)", function () {
  it("is owned by ProtocolCore and exposes ids", async function () {
    const a = loadAddresses();
    const factory = await ethers.getContractAt("FarmFactory", a.FarmFactory);
    const owner = await factory.owner();
    expect(owner.toLowerCase()).to.eq(a.ProtocolCore.toLowerCase());
    const id = await factory.currentFarmId();
    expect(id).to.be.greaterThan(0n);
  });
});
