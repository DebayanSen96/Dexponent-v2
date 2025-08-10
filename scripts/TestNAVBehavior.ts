import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { parseEther, formatUnits } from "ethers";

const confirmationsMap: Record<string, number> = { sepolia: 2, "base-sepolia": 2, hardhat: 1, localhost: 1 };

async function wait(tx: any) {
  const conf = confirmationsMap[network.name] ?? 1;
  await tx.wait(conf);
}

async function loadAddresses() {
  const filename = (() => {
    if (network.name === "base-sepolia" || network.name.includes("base")) return "base_addresses.json";
    if (network.name === "hardhat" || network.name === "localhost") return "hardhat_addresses.json";
    return `${network.name}_addresses.json`;
  })();
  const file = path.resolve(process.cwd(), "deployment", filename);
  const data = await fs.promises.readFile(file, "utf8");
  return JSON.parse(data) as Record<string, string>;
}

async function main() {
  const pk = process.env.WALLET_PRIVATE_KEY as string;
  if (!pk) throw new Error("WALLET_PRIVATE_KEY missing");
  const signer = new ethers.Wallet(pk, ethers.provider);
  const addresses = await loadAddresses();
  
  const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken, signer);
  const farm = await ethers.getContractAt("Farm", addresses.ModularFarm, signer);
  const protocolCore = await ethers.getContractAt("ProtocolCore", addresses.ProtocolCore, signer);

  console.log("\n=== NAV-Based Share Behavior Test ===");
  console.log("Network:", network.name);
  console.log("Signer:", signer.address);
  console.log("Farm:", addresses.ModularFarm);

  const ctAddr = await farm.claimToken();
  const vdxp = await ethers.getContractAt("FarmClaimToken", ctAddr, signer);

  const amount = parseEther("100");
  const now = Math.floor(Date.now() / 1000);
  const maturity = BigInt(now + 30 * 24 * 60 * 60);

  console.log("\n--- Initial State ---");
  let totalAssets = await farm.totalAssets();
  let totalShares = await farm.totalShares();
  let pricePerShare = await farm.pricePerShare();
  let accumulatedYield = await farm.accumulatedYieldDXP();
  console.log("totalAssets:", formatUnits(totalAssets, 18));
  console.log("totalShares:", formatUnits(totalShares, 18));
  console.log("pricePerShare:", formatUnits(pricePerShare, 18));
  console.log("accumulatedYieldDXP:", formatUnits(accumulatedYield, 18));

  console.log("\n--- Depositing 100 DXP ---");
  const appr = await dxp.approve(addresses.ModularFarm, amount);
  await wait(appr);
  const dep = await farm.provideLiquidity(amount, maturity);
  await wait(dep);

  const vdxpBalance = await vdxp.balanceOf(signer.address);
  console.log("vDXP received:", formatUnits(vdxpBalance, 18));

  totalAssets = await farm.totalAssets();
  totalShares = await farm.totalShares();
  pricePerShare = await farm.pricePerShare();
  console.log("totalAssets:", formatUnits(totalAssets, 18));
  console.log("totalShares:", formatUnits(totalShares, 18));
  console.log("pricePerShare:", formatUnits(pricePerShare, 18));

  console.log("\n--- Simulating Yield Harvest via principalReserve + ProtocolCore.pullFarmRevenue ---");
  const [_, recipient] = await ethers.getSigners();
  const vdxpToTransfer = vdxpBalance / 2n;
  const feeBps = await protocolCore.getTransferFeeRate();
  console.log("transferFeeBps:", feeBps.toString());
  const tx1 = await vdxp.transfer(recipient.address, vdxpToTransfer);
  await wait(tx1);
  const fid = await farm.farmId();
  const tx2 = await protocolCore.pullFarmRevenue(fid);
  await wait(tx2);

  totalAssets = await farm.totalAssets();
  totalShares = await farm.totalShares();
  pricePerShare = await farm.pricePerShare();
  accumulatedYield = await farm.accumulatedYieldDXP();
  
  console.log("\n--- After Yield Addition ---");
  console.log("totalAssets:", formatUnits(totalAssets, 18));
  console.log("totalShares:", formatUnits(totalShares, 18));
  console.log("pricePerShare:", formatUnits(pricePerShare, 18));
  console.log("accumulatedYieldDXP:", formatUnits(accumulatedYield, 18));

  console.log("\n--- Testing Second Deposit (should get fewer shares) ---");
  const preSecond = await vdxp.balanceOf(signer.address);
  const appr2 = await dxp.approve(addresses.ModularFarm, amount);
  await wait(appr2);
  const dep2 = await farm.provideLiquidity(amount, maturity);
  await wait(dep2);
  const postSecond = await vdxp.balanceOf(signer.address);
  const mintedSecond = postSecond - preSecond;
  console.log("vDXP received for second 100 DXP deposit:", formatUnits(mintedSecond, 18));
  console.log("Total vDXP balance:", formatUnits(postSecond, 18));

  totalAssets = await farm.totalAssets();
  totalShares = await farm.totalShares();
  pricePerShare = await farm.pricePerShare();
  
  console.log("\n--- Final State ---");
  console.log("totalAssets:", formatUnits(totalAssets, 18));
  console.log("totalShares:", formatUnits(totalShares, 18));
  console.log("pricePerShare:", formatUnits(pricePerShare, 18));

  console.log("\n=== NAV Analysis ===");
  if (mintedSecond < parseEther("100")) {
    console.log("✅ NAV-based shares working: Second deposit received fewer shares due to increased NAV");
  } else {
    console.log("❌ Still 1:1 behavior: Second deposit received same shares despite yield");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
