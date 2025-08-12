import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { parseEther } from "ethers";

async function wait(tx: any) {
  if (!tx) return;
  const rc = await tx.wait(1);
  return rc;
}

async function loadAddresses() {
  const filename = (() => {
    if (network.name === "base-sepolia" || network.name.includes("base")) return "base_addresses.json";
    if (network.name === "hardhat" || network.name === "localhost") return "hardhat_addresses.json";
    return `${network.name}_addresses.json`;
  })();
  const outPath = path.resolve(process.cwd(), "deployment", filename);
  const raw = await fs.promises.readFile(outPath, "utf-8");
  return JSON.parse(raw) as Record<string, string>;
}

async function resolveFarmIds(protocolAddr: string, targets: string[]) {
  const protocol = await ethers.getContractAt("ProtocolCore", protocolAddr);
  const farmIds: Record<string, bigint> = {};
  // ProtocolCore exposes farmAddressOf(id). Iterate a small range to match.
  // We also try FarmFactory.currentFarmId() to set an upper bound.
  const farmFactoryAddr = await protocol.farmFactory();
  const farmFactory = await ethers.getContractAt("FarmFactory", farmFactoryAddr);
  const current = await farmFactory.currentFarmId();
  for (let i = 1n; i <= current; i++) {
    try {
      const addr = await protocol.farmAddressOf(i);
      for (const t of targets) {
        if (addr.toLowerCase() === t.toLowerCase()) {
          farmIds[t] = i;
        }
      }
    } catch {}
  }
  return farmIds;
}

async function actOnFarm(
  dxpAddr: string,
  protocolAddr: string,
  farmAddr: string,
  farmId: bigint,
  label: string
) {
  const [deployer] = await ethers.getSigners();
  const dxp = await ethers.getContractAt("DXPToken", dxpAddr);
  const farm = await ethers.getContractAt("Farm", farmAddr);
  const protocol = await ethers.getContractAt("ProtocolCore", protocolAddr);

  console.log(`\n=== ${label} ===`);
  console.log("Farm:", farmAddr, "FarmId:", farmId.toString());

  const asset = await farm.asset();
  if (asset.toLowerCase() !== dxpAddr.toLowerCase()) {
    console.log("Warning: Farm asset != DXP, skipping deposit");
    return;
  }

  // Approve and deposit
  const depositAmt = parseEther("1000");
  await wait(await dxp.approve(farmAddr, depositAmt));
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const maturity = BigInt(now) + 3n * 24n * 60n * 60n; // +3 days
  await wait(await farm.provideLiquidity(depositAmt, Number(maturity)));
  console.log("Deposited:", depositAmt.toString());

  // Deploy liquidity (only farm owner)
  await wait(await farm.deployLiquidity(depositAmt));
  console.log("Deployed liquidity:", depositAmt.toString());

  // Read strategy address and TVL
  const strategyAddr = await farm.strategy();
  const strat = await ethers.getContractAt("FarmStrategy", strategyAddr);
  const tvlBefore = await strat.getStrategyTVL();
  console.log("Strategy:", strategyAddr);
  console.log("Strategy TVL (before harvest):", tvlBefore.toString());

  // Check pending rewards on strategy and only pull revenue if non-zero
  const pendingStrat = await strat.getPendingRewards();
  console.log("Strategy pending rewards:", pendingStrat.toString());
  if (pendingStrat > 0n) {
    const revenue = await protocol.pullFarmRevenue(farmId);
    const rc = await wait(revenue);
    console.log("pullFarmRevenue tx mined. Hash:", rc?.hash);
  } else {
    console.log("No pending strategy rewards; skipping pullFarmRevenue to avoid revert.");
  }

  // TVL after harvest
  const tvlAfter = await strat.getStrategyTVL();
  console.log("Strategy TVL (after harvest):", tvlAfter.toString());

  // Pending yield and claim for deployer
  const pending = await farm.pendingYield(deployer.address);
  console.log("Pending LP yield (DXP):", pending.toString());
  if (pending > 0n) {
    await wait(await farm.claimYield());
    const bal = await dxp.balanceOf(deployer.address);
    console.log("Claimed yield. Deployer DXP balance:", bal.toString());
  }
}

async function main() {
  const addresses = await loadAddresses();
  const protocolAddr = addresses.ProtocolCore;
  const dxpAddr = addresses.DXPToken;
  const stakingFarmAddr = addresses.ModularFarm;
  const lendingFarmAddr = addresses.ModularLendingFarm;

  if (!protocolAddr || !dxpAddr || !stakingFarmAddr || !lendingFarmAddr) {
    throw new Error("Missing addresses in deployment JSON");
  }

  const ids = await resolveFarmIds(protocolAddr, [stakingFarmAddr, lendingFarmAddr]);
  const stakingId = ids[stakingFarmAddr];
  const lendingId = ids[lendingFarmAddr];
  if (!stakingId || !lendingId) {
    throw new Error("Could not resolve farm ids");
  }

  await actOnFarm(dxpAddr, protocolAddr, stakingFarmAddr, stakingId, "Staking Farm");
  await actOnFarm(dxpAddr, protocolAddr, lendingFarmAddr, lendingId, "Lending Farm");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
