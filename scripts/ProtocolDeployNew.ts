import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { parseEther, ZeroAddress, keccak256, toUtf8Bytes } from "ethers";

const confirmationsMap: Record<string, number> = { sepolia: 5, "base-sepolia": 5, hardhat: 1, localhost: 1 };

async function wait(tx: any) {
  const conf = confirmationsMap[network.name] ?? 1;
  await tx.wait(conf);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const addresses: Record<string, string> = {};
  const DXPToken = await ethers.getContractFactory("DXPToken");
  const dxp = await DXPToken.deploy();
  await wait(dxp.deploymentTransaction());
  console.log("DXPToken:", await dxp.getAddress());
  addresses.DXPToken = await dxp.getAddress();
  const DXPFaucet = await ethers.getContractFactory("DXPFaucet");
  const faucet = await DXPFaucet.deploy(await dxp.getAddress(), parseEther("100"), 86400);
  await wait(faucet.deploymentTransaction());
  console.log("DXPFaucet:", await faucet.getAddress());
  addresses.DXPFaucet = await faucet.getAddress();
  const FarmDeployer = await ethers.getContractFactory("FarmDeployer");
  const farmDeployer = await FarmDeployer.deploy();
  await wait(farmDeployer.deploymentTransaction());
  console.log("FarmDeployer:", await farmDeployer.getAddress());

  const RestakeFarmDeployer = await ethers.getContractFactory("RestakeFarmDeployer");
  const restakeFarmDeployer = await RestakeFarmDeployer.deploy();
  await wait(restakeFarmDeployer.deploymentTransaction());
  console.log("RestakeFarmDeployer:", await restakeFarmDeployer.getAddress());

  const FarmFactory = await ethers.getContractFactory("FarmFactory");
  const farmFactory = await FarmFactory.deploy(
    await farmDeployer.getAddress(),
    await restakeFarmDeployer.getAddress()
  );
  await wait(farmFactory.deploymentTransaction());
  console.log("FarmFactory:", await farmFactory.getAddress());
  addresses.FarmFactory = await farmFactory.getAddress();
  const ProtocolCore = await ethers.getContractFactory("ProtocolCore");
  const protocol = await ProtocolCore.deploy(await dxp.getAddress(), 70, 20, 20, await farmFactory.getAddress());
  await wait(protocol.deploymentTransaction());
  console.log("ProtocolCore:", await protocol.getAddress());
  addresses.ProtocolCore = await protocol.getAddress();
  await wait(await farmFactory.transferOwnership(await protocol.getAddress()));
  console.log("FarmFactory ownership -> ProtocolCore");
  const MockBridgeAdapter = await ethers.getContractFactory("MockBridgeAdapter");
  const mockBridge = await MockBridgeAdapter.deploy();
  await wait(mockBridge.deploymentTransaction());
  console.log("MockBridgeAdapter:", await mockBridge.getAddress());
  addresses.MockBridgeAdapter = await mockBridge.getAddress();
  const usdc = "0xE358a174c91C01E3804b96a34f4839750F062bD9";
  const MockLiquidityManager = await ethers.getContractFactory("MockLiquidityManager");
  const mockLM = await MockLiquidityManager.deploy(await dxp.getAddress(), usdc);
  await wait(mockLM.deploymentTransaction());
  console.log("MockLiquidityManager:", await mockLM.getAddress());
  addresses.MockLiquidityManager = await mockLM.getAddress();
  const Consensus = await ethers.getContractFactory("Consensus");
  const existingConsensus = await protocol.consensus();
  if (existingConsensus === ZeroAddress) {
    const consensus = await Consensus.deploy(await protocol.getAddress(), 3);
    await wait(consensus.deploymentTransaction());
    await wait(await protocol.setConsensusModule(await consensus.getAddress()));
    console.log("Consensus set:", await consensus.getAddress());
    addresses.Consensus = await consensus.getAddress();
  }
  if ((await protocol.bridgeAdapter()) !== (await mockBridge.getAddress())) {
    await wait(await protocol.setBridgingAdaptor(await mockBridge.getAddress()));
    console.log("BridgeAdapter set:", await mockBridge.getAddress());
  }
  if ((await protocol.liquidityManager()) !== (await mockLM.getAddress())) {
    await wait(await protocol.setLiquidityManager(await mockLM.getAddress()));
    console.log("LiquidityManager set:", await mockLM.getAddress());
  }
  const root = await protocol.rootFarm();
  if (root === ZeroAddress) {
    const vdxp = await protocol.vdxpToken();
    const RootFarm = await ethers.getContractFactory("RootFarm");
    const rf = await RootFarm.deploy(
      0,
      await dxp.getAddress(),
      2592000,
      20,
      0,
      80,
      0,
      ZeroAddress,
      await protocol.getAddress(),
      vdxp,
      deployer.address
    );
    await wait(rf.deploymentTransaction());
    await wait(await protocol.setRootFarm(await rf.getAddress()));
    console.log("RootFarm:", await rf.getAddress());
    addresses.RootFarm = await rf.getAddress();
    const RootAnchorMMStrategy = await ethers.getContractFactory("RootAnchorMMStrategy");
    const strat = await RootAnchorMMStrategy.deploy(await rf.getAddress(), await dxp.getAddress());
    await wait(strat.deploymentTransaction());
    await wait(
      await strat.initialize(
        3000,
        BigInt("79228162514264337593543950336"),
        parseEther("100"),
        parseEther("50"),
        usdc,
        await mockLM.getAddress(),
        parseEther("1"),
        3600
      )
    );
    const rootFarm = await ethers.getContractAt("RootFarm", await rf.getAddress());
    await wait(await rootFarm.updateStrategy(await strat.getAddress()));
    console.log("RootAnchorMMStrategy:", await strat.getAddress());
    addresses.RootAnchorMMStrategy = await strat.getAddress();
  }
  {
    const nextIdBefore = await (await ethers.getContractAt("FarmFactory", await farmFactory.getAddress())).currentFarmId();
    const isApproved = await protocol.approvedFarmOwners(deployer.address);
    if (!isApproved) {
      await wait(await protocol.setApprovedFarmOwner(deployer.address, true));
      console.log("Approved farm owner:", deployer.address);
    }
    const salt = keccak256(toUtf8Bytes("modular-farm-1"));
    const maturityPeriod = 86400;
    const splits = { lps: 70, verifiers: 10, yodas: 10, owner: 10 };
    const tx = await protocol.createApprovedFarm(
      salt,
      await dxp.getAddress(),
      maturityPeriod,
      splits.verifiers,
      splits.yodas,
      splits.lps,
      splits.owner,
      ZeroAddress,
      "mDXP",
      "mDXP",
      false,
      ZeroAddress
    );
    const rc = await tx.wait(confirmationsMap[network.name] ?? 1);
    const newFarmId = nextIdBefore;
    const modularFarmAddr = await protocol.farmAddressOf(newFarmId);
    console.log("Modular Farm:", modularFarmAddr, "id=", newFarmId.toString());
    addresses.ModularFarm = modularFarmAddr;
    const Adapter = await ethers.getContractFactory("MockStakingAdapter");
    const adapterA = await Adapter.deploy();
    await wait(adapterA.deploymentTransaction());
    const adapterB = await Adapter.deploy();
    await wait(adapterB.deploymentTransaction());
    const StakingStrategy = await ethers.getContractFactory("StakingStrategy");
    const adapters = [await adapterA.getAddress(), await adapterB.getAddress()];
    const weights = [5000, 5000];
    const stakingStrat = await StakingStrategy.deploy(
      modularFarmAddr,
      await dxp.getAddress(),
      await dxp.getAddress(),
      maturityPeriod,
      parseEther("1"),
      parseEther("1000000"),
      500,
      false,
      splits.lps,
      splits.verifiers,
      splits.yodas,
      splits.owner,
      adapters,
      weights
    );
    await wait(stakingStrat.deploymentTransaction());
    const modularFarm = await ethers.getContractAt("Farm", modularFarmAddr);
    await wait(await modularFarm.updateStrategy(await stakingStrat.getAddress()));
    console.log("Modular StakingStrategy:", await stakingStrat.getAddress());
    addresses.ModularStakingStrategy = await stakingStrat.getAddress();
  }
  const dxpCtr = await ethers.getContractAt("DXPToken", await dxp.getAddress());
  const toFarmOwner = parseEther("100000");
  await wait(await dxpCtr.transfer(deployer.address, toFarmOwner));
  const bal = await dxpCtr.balanceOf(deployer.address);
  const half = bal / 2n;
  await wait(await dxpCtr.transfer(await protocol.getAddress(), half));
  await wait(await dxpCtr.transferOwnership(await protocol.getAddress()));
  console.log("DXP transferred to deployer:", toFarmOwner.toString());
  console.log("DXP transferred to ProtocolCore:", half.toString());
  console.log("DXP ownership -> ProtocolCore");
  const filename = (() => {
    if (network.name === "base-sepolia" || network.name.includes("base")) return "base_addresses.json";
    if (network.name === "hardhat" || network.name === "localhost") return "hardhat_addresses.json";
    return `${network.name}_addresses.json`;
  })();
  const dir = path.resolve(process.cwd(), "deployment");
  await fs.promises.mkdir(dir, { recursive: true });
  const outPath = path.resolve(dir, filename);
  const payload = {
    network: network.name,
    deployer: deployer.address,
    ...addresses,
  };
  await fs.promises.writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log("Addresses saved:", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
