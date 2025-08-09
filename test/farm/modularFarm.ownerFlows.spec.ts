import { expect } from "chai";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import { loadAddresses } from "../utils/loadAddresses";

describe("Modular Farm owner flows", function () {
  let addresses: any;
  let deployer: any;
  let ownerSigner: any;

  before(async () => {
    [deployer] = await ethers.getSigners();
    addresses = await loadAddresses();
  });

  it("deposit, claim token mint, owner deploy/withdraw, adapter TVL changes", async () => {
    const farm = await ethers.getContractAt("Farm", addresses.ModularFarm);
    const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken);

    const farmOwnerAddr = await farm.farmOwner();
    ownerSigner = deployer.address.toLowerCase() === farmOwnerAddr.toLowerCase() ? deployer : await ethers.getImpersonatedSigner(farmOwnerAddr);
    if (ownerSigner.address.toLowerCase() !== deployer.address.toLowerCase()) {
      const bal = await ethers.provider.getBalance(ownerSigner.address);
      if (bal === 0n) {
        await deployer.sendTransaction({ to: ownerSigner.address, value: parseEther("1") });
      }
    }

    const claimTokenAddr = await farm.claimToken();
    const claim = await ethers.getContractAt("FarmClaimToken", claimTokenAddr);

    const depositAmt = parseEther("500");
    await dxp.connect(deployer).approve(await farm.getAddress(), depositAmt);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await farm.connect(deployer).provideLiquidity(depositAmt, BigInt(now + 86400 * 40));

    const ctBalAfter = await claim.balanceOf(deployer.address);
    expect(ctBalAfter).to.equal(depositAmt);

    const stratAddr = await farm.strategy();
    const stakingStrat = await ethers.getContractAt("StakingStrategy", stratAddr);

    const tvlBefore = await stakingStrat.getStrategyTVL();
    const availBefore = await farm.availableLiquidity();

    const toDeploy = depositAmt / 2n;
    await farm.connect(ownerSigner).deployLiquidity(toDeploy);

    const tvlAfterDeploy = await stakingStrat.getStrategyTVL();
    const availAfterDeploy = await farm.availableLiquidity();

    expect(tvlAfterDeploy).to.equal(tvlBefore + toDeploy);
    expect(availAfterDeploy).to.equal(availBefore - toDeploy);

    const toWithdraw = toDeploy / 2n;
    await farm.connect(ownerSigner).withdrawFromStrategy(toWithdraw);
    const tvlAfterW = await stakingStrat.getStrategyTVL();
    const availAfterW = await farm.availableLiquidity();

    expect(tvlAfterW).to.equal(tvlAfterDeploy - toWithdraw);
    expect(availAfterW).to.equal(availAfterDeploy + toWithdraw);

    await expect((await ethers.getContractAt("Farm", addresses.ModularFarm)).connect(ownerSigner)["rebalanceStrategy()"]()).to.not.be.reverted;
    await expect((await ethers.getContractAt("Farm", addresses.ModularFarm)).connect(ownerSigner)["rebalanceStrategy(bytes)"]( "0x" )).to.not.be.reverted;
  });

  it("epoch params and rebalance to target", async () => {
    const farm = await ethers.getContractAt("Farm", addresses.ModularFarm);

    const farmOwnerAddr = await farm.farmOwner();
    ownerSigner = deployer.address.toLowerCase() === farmOwnerAddr.toLowerCase() ? deployer : await ethers.getImpersonatedSigner(farmOwnerAddr);
    if (ownerSigner.address.toLowerCase() !== deployer.address.toLowerCase()) {
      const bal = await ethers.provider.getBalance(ownerSigner.address);
      if (bal === 0n) {
        await deployer.sendTransaction({ to: ownerSigner.address, value: parseEther("1") });
      }
    }

    await farm.connect(ownerSigner).setReserveRatioBps(1500);
    await farm.connect(ownerSigner).setMinReserve(parseEther("25"));
    await farm.connect(ownerSigner).startEpoch(2000, parseEther("50"));

    await expect(farm.connect(ownerSigner).rebalanceToTarget()).to.not.be.reverted;
  });

  it("withdraw burns claim token and pause gates deposits", async () => {
    const farm = await ethers.getContractAt("Farm", addresses.ModularFarm);
    const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken);
    const claimTokenAddr = await farm.claimToken();
    const claim = await ethers.getContractAt("FarmClaimToken", claimTokenAddr);

    const amt = parseEther("50");
    await dxp.connect(deployer).approve(await farm.getAddress(), amt);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await farm.connect(deployer).provideLiquidity(amt, BigInt(now + 86400 * 35));

    const balBefore = await claim.balanceOf(deployer.address);
    await farm.connect(deployer).withdrawLiquidity(amt / 2n, false);
    const balAfter = await claim.balanceOf(deployer.address);
    expect(balAfter).to.equal(balBefore - amt / 2n);

    const farmOwnerAddr = await farm.farmOwner();
    ownerSigner = deployer.address.toLowerCase() === farmOwnerAddr.toLowerCase() ? deployer : await ethers.getImpersonatedSigner(farmOwnerAddr);
    await farm.connect(ownerSigner).pause();
    await dxp.connect(deployer).approve(await farm.getAddress(), amt);
    await expect(
      farm.connect(deployer).provideLiquidity(amt, BigInt(now + 86400 * 40))
    ).to.be.reverted;
    await farm.connect(ownerSigner).unpause();
    await expect(
      farm.connect(deployer).provideLiquidity(amt, BigInt(now + 86400 * 40))
    ).to.not.be.reverted;
  });
});
