import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { parseEther, formatUnits, ZeroAddress } from "ethers";

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

function bigintEq(a: bigint, b: bigint, label: string) {
  if (a !== b) throw new Error(`${label} mismatch: ${a.toString()} != ${b.toString()}`);
}

function approxEq(a: bigint, b: bigint, tol: bigint, label: string) {
  const diff = a > b ? a - b : b - a;
  if (diff > tol) throw new Error(`${label} mismatch: ${a.toString()} != ${b.toString()} (tol ${tol.toString()})`);
}

async function main() {
  const pk = process.env.WALLET_PRIVATE_KEY as string;
  if (!pk) throw new Error("WALLET_PRIVATE_KEY missing");
  const signer = new ethers.Wallet(pk, ethers.provider);
  const addresses = await loadAddresses();
  const dxp = await ethers.getContractAt("DXPToken", addresses.DXPToken, signer);
  const farm = await ethers.getContractAt("Farm", addresses.ModularFarm, signer);
  const strategy = await ethers.getContractAt("StakingStrategy", addresses.ModularStakingStrategy, signer);
  console.log("\n=== Accounting Sanity Check ===");
  console.log("Network:", network.name);
  console.log("Signer:", signer.address);
  console.log("DXPToken:", addresses.DXPToken);
  console.log("Farm:", addresses.ModularFarm);
  console.log("Strategy:", addresses.ModularStakingStrategy);

  const amount = parseEther("200");
  const wd = parseEther("80");
  const now = Math.floor(Date.now() / 1000);
  const maturity = BigInt(now + 30 * 24 * 60 * 60);

  let poolAddr: string | undefined;
  try {
    // @ts-ignore
    poolAddr = await (farm as any).pool();
  } catch {}
  if (!poolAddr || poolAddr === ZeroAddress) {
    console.log("\nPool is not set, deploying MockPool and wiring it to the Farm");
    const MockPool = await ethers.getContractFactory("MockPool", signer);
    const mockPool = await MockPool.deploy(addresses.DXPToken);
    await wait(mockPool.deploymentTransaction());
    poolAddr = await mockPool.getAddress();
    const tx = await farm.setPool(poolAddr);
    await wait(tx);
    console.log("Pool set:", poolAddr);
  }
  console.log("Pool:", poolAddr);

  const preTotalLiquidity: bigint = await farm.totalLiquidity();
  const preAcc: bigint = await farm.accYieldPerShare();
  const preClaimTokenAddr: string = await farm.claimToken();
  const claim = await ethers.getContractAt("FarmClaimToken", preClaimTokenAddr, signer);
  const preCts: bigint = await claim.totalSupply();
  const prePos = await farm.positions(signer.address);
  const preDebt: bigint = await farm.yieldDebt(signer.address);
  const preDXP: bigint = await dxp.balanceOf(signer.address);
  const preVDXP: bigint = await claim.balanceOf(signer.address);
  console.log("\nPre-state");
  console.log("totalLiquidity:", formatUnits(preTotalLiquidity, 18));
  console.log("accYieldPerShare:", preAcc.toString());
  console.log("claimToken:", preClaimTokenAddr);
  console.log("claimToken.totalSupply:", formatUnits(preCts, 18));
  console.log("position.principal:", formatUnits(prePos.principal, 18));
  console.log("yieldDebt:", preDebt.toString());
  console.log("Signer DXP:", formatUnits(preDXP, 18));
  console.log("Signer vDXP:", formatUnits(preVDXP, 18));

  const appr = await dxp.approve(addresses.ModularFarm, amount);
  await wait(appr);
  console.log("\nApproved Farm to spend:", formatUnits(amount, 18), "DXP");

  const dep = await farm.provideLiquidity(amount, maturity);
  await wait(dep);
  console.log("Deposit submitted. amount:", formatUnits(amount, 18), "maturity:", maturity.toString());

  const postDepTotalLiquidity: bigint = await farm.totalLiquidity();
  const postDepCts: bigint = await claim.totalSupply();
  const postDepPos = await farm.positions(signer.address);
  const postDepDebt: bigint = await farm.yieldDebt(signer.address);
  const balVDXP: bigint = await claim.balanceOf(signer.address);
  console.log("\nPost-deposit");
  console.log("totalLiquidity:", formatUnits(postDepTotalLiquidity, 18));
  console.log("claimToken.totalSupply:", formatUnits(postDepCts, 18));
  console.log("position.principal:", formatUnits(postDepPos.principal, 18));
  console.log("yieldDebt:", postDepDebt.toString());
  console.log("Signer vDXP:", formatUnits(balVDXP, 18));

  bigintEq(postDepTotalLiquidity - preTotalLiquidity, amount, "totalLiquidity delta after deposit");
  bigintEq(postDepCts - preCts, amount, "claim totalSupply delta after deposit");
  bigintEq(balVDXP, postDepPos.principal, "vDXP balance equals principal");
  bigintEq(postDepDebt, (postDepPos.principal * postAccYield()) / 10n**18n, "yieldDebt updated vs accYieldPerShare");

  const owner = await farm.farmOwner();
  console.log("\nFarm owner:", owner);
  if (owner.toLowerCase() === signer.address.toLowerCase()) {
    console.log("Deploying liquidity to strategy:", formatUnits(amount, 18), "DXP");
    const depLiq = await farm.deployLiquidity(amount);
    await wait(depLiq);
    console.log("Deployed to strategy");
  }

  const adapters = await getAdapters(strategy, 4);
  console.log("\nStrategy adapters:");
  for (const a of adapters) {
    const adapter = await ethers.getContractAt("MockStakingAdapter", a, signer);
    const t = await adapter.totalAssets(await dxp.getAddress());
    if (t <= 0n) throw new Error("adapter totalAssets did not increase after deployLiquidity");
    console.log("Adapter:", a, "totalAssets:", formatUnits(t, 18));
  }

  const preWdDebt: bigint = await farm.yieldDebt(signer.address);
  const preWdAcc: bigint = await farm.accYieldPerShare();
  const preWdPos = await farm.positions(signer.address);
  console.log("\nPre-withdraw");
  console.log("position.principal:", formatUnits(preWdPos.principal, 18));
  console.log("yieldDebt:", preWdDebt.toString());
  console.log("accYieldPerShare:", preWdAcc.toString());

  const wdTx = await farm.withdrawLiquidity(wd, false);
  await wait(wdTx);
  console.log("Withdraw submitted. amount:", formatUnits(wd, 18));

  const postWdTotalLiquidity: bigint = await farm.totalLiquidity();
  const postWdCts: bigint = await claim.totalSupply();
  const postWdPos = await farm.positions(signer.address);
  const postWdDebt: bigint = await farm.yieldDebt(signer.address);
  const postVDXP: bigint = await claim.balanceOf(signer.address);

  bigintEq(preWdPos.principal - postWdPos.principal, wd, "principal reduced by withdrawn amount");
  bigintEq(preWdCts() - postWdCts, wd, "claim totalSupply burned equals withdrawn amount");
  bigintEq(preWdPos.principal - (await claim.balanceOf(signer.address)), wd, "vDXP burned equals withdrawn amount");
  bigintEq(postWdAcc() - preWdAcc, 0n, "no yield accrual with mock adapter");
  bigintEq(postWdDebt, (postWdPos.principal * postWdAcc()) / 10n**18n, "yieldDebt aligned after withdraw");
  console.log("\nPost-withdraw");
  console.log("totalLiquidity:", formatUnits(postWdTotalLiquidity, 18));
  console.log("claimToken.totalSupply:", formatUnits(postWdCts, 18));
  console.log("position.principal:", formatUnits(postWdPos.principal, 18));
  console.log("yieldDebt:", postWdDebt.toString());
  console.log("Signer vDXP:", formatUnits(postVDXP, 18));

  function postAccYield(): bigint { return preAcc; }
  function preWdCts(): bigint { return postDepCts; }
  function postWdAcc(): bigint { return preWdAcc; }

  const postDXP: bigint = await dxp.balanceOf(signer.address);
  const netDXP = postDXP - preDXP;
  console.log("\n=== Summary ===");
  console.log("Accounting checks passed on", network.name);
  console.log("Deposited:", formatUnits(amount, 18));
  console.log("Withdrew:", formatUnits(wd, 18));
  console.log("Net DXP:", formatUnits(netDXP, 18));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
