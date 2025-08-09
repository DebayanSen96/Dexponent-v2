import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { parseEther, ZeroAddress, formatUnits } from "ethers";

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

async function getAdapters(strategy: any, max = 4): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    try {
      const a = await strategy.adapters(i);
      if (a && a !== ZeroAddress) out.push(a);
    } catch {
      break;
    }
  }
  return out;
}

async function main() {
  const pk = process.env.WALLET_PRIVATE_KEY as string;
  if (!pk) throw new Error("WALLET_PRIVATE_KEY missing");
  const signer = new ethers.Wallet(pk, ethers.provider);
  const addresses = await loadAddresses();
  const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken, signer);
  const farm = await ethers.getContractAt("Farm", addresses.ModularFarm, signer);
  const strategy = await ethers.getContractAt("StakingStrategy", addresses.ModularStakingStrategy, signer);

  console.log("\n=== Dexponent Modular Farm Stake Demo ===");
  console.log("Network:", network.name);
  console.log("Signer:", signer.address);
  console.log("DXPToken:", addresses.DXPToken);
  console.log("Farm:", addresses.ModularFarm);
  console.log("Strategy:", addresses.ModularStakingStrategy);

  let poolAddr: string | undefined;
  try {
    // @ts-ignore
    poolAddr = await (farm as any).pool();
  } catch {}
  if (!poolAddr || poolAddr === ZeroAddress) {
    console.log("\n--- Pool not set, deploying MockPool and setting it ---");
    const MockPool = await ethers.getContractFactory("MockPool", signer);
    const mockPool = await MockPool.deploy(addresses.DXPToken);
    await wait(mockPool.deploymentTransaction());
    poolAddr = await mockPool.getAddress();
    console.log("MockPool:", poolAddr);
    const tx = await farm.setPool(poolAddr);
    await wait(tx);
    console.log("Pool set on Farm.");
  } else {
    console.log("Pool:", poolAddr);
  }

  const amount = parseEther("250");
  const wd = parseEther("100");
  const now = Math.floor(Date.now() / 1000); 
  const maturity = BigInt(now + 30 * 24 * 60 * 60); // 30 days from now

  console.log("\n--- Reading pre-state ---");
  const preDXP = await dxp.balanceOf(signer.address);
  const preFarmDXP = await dxp.balanceOf(addresses.ModularFarm);
  const ctAddr = await farm.claimToken();
  const vdxp = await ethers.getContractAt("FarmClaimToken", ctAddr, signer);
  const preVDXP = await vdxp.balanceOf(signer.address);
  console.log("Signer DXP:", formatUnits(preDXP, 18));
  console.log("Farm DXP:", formatUnits(preFarmDXP, 18));
  console.log("vDXP token:", ctAddr);
  console.log("Signer vDXP:", formatUnits(preVDXP, 18));

  console.log("\n--- Approving Farm to spend DXP ---");
  const appr = await dxp.approve(addresses.ModularFarm, amount);
  await wait(appr);
  console.log("Approved:", formatUnits(amount, 18), "DXP");

  console.log("\n--- Providing Liquidity ---");
  console.log("Amount:", formatUnits(amount, 18), "DXP");
  console.log("Maturity:", maturity.toString());
  const dep = await farm.provideLiquidity(amount, maturity);
  await wait(dep);
  console.log("Deposit tx confirmed.");

  const midDXP = await dxp.balanceOf(signer.address);
  const midFarmDXP = await dxp.balanceOf(addresses.ModularFarm);
  const midVDXP = await vdxp.balanceOf(signer.address);
  console.log("\n--- Post-deposit balances ---");
  console.log("Signer DXP:", formatUnits(midDXP, 18));
  console.log("Farm DXP:", formatUnits(midFarmDXP, 18));
  console.log("Signer vDXP:", formatUnits(midVDXP, 18));

  const owner = await farm.farmOwner();
  console.log("\nFarm owner:", owner);
  if (owner.toLowerCase() === signer.address.toLowerCase()) {
    console.log("\n--- Deploying Liquidity to Strategy (owner) ---");
    const depLiq = await farm.deployLiquidity(amount);
    await wait(depLiq);
    console.log("Deployed:", formatUnits(amount, 18), "DXP to Strategy");
  }

  const adapters = await getAdapters(strategy, 4);
  const adapterTotals: { addr: string; total: bigint }[] = [];
  for (const a of adapters) {
    const adapter = await ethers.getContractAt("MockStakingAdapter", a, signer);
    const t = await adapter.totalAssets(await dxp.getAddress());
    adapterTotals.push({ addr: a, total: t });
  }
  console.log("\n--- Strategy adapters ---");
  if (adapters.length === 0) {
    console.log("No adapters exposed by strategy interface.");
  } else {
    for (const x of adapterTotals) {
      console.log("Adapter:", x.addr, "totalAssets:", formatUnits(x.total, 18));
    }
  }

  console.log("\n--- Withdrawing Liquidity ---");
  console.log("Amount:", formatUnits(wd, 18), "DXP");
  const wdTx = await farm.withdrawLiquidity(wd, false);
  await wait(wdTx);
  console.log("Withdraw tx confirmed.");

  const postDXP = await dxp.balanceOf(signer.address);
  const postFarmDXP = await dxp.balanceOf(addresses.ModularFarm);
  const postVDXP = await vdxp.balanceOf(signer.address);
  console.log("\n--- Final balances ---");
  console.log("Signer DXP:", formatUnits(postDXP, 18));
  console.log("Farm DXP:", formatUnits(postFarmDXP, 18));
  console.log("Signer vDXP:", formatUnits(postVDXP, 18));

  const vdxpDelta = postVDXP - preVDXP;
  const dxpDelta = preDXP - postDXP;
  console.log("\n=== Summary ===");
  console.log("Deposited:", formatUnits(amount, 18), "DXP");
  console.log("vDXP minted:", formatUnits(vdxpDelta, 18));
  console.log("Deployed to strategy (if owner):", formatUnits(amount, 18));
  console.log("Withdrew:", formatUnits(wd, 18), "DXP");
  console.log("Signer DXP net change:", formatUnits(dxpDelta, 18));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
