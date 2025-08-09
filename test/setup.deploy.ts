import { run, network } from "hardhat";

before(async function () {
  if (network.name === "hardhat" || network.name === "localhost") {
    await run("run", { script: "scripts/ProtocolDeployNew.ts" });
  }
});
