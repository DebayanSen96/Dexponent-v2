import fs from "fs";
import path from "path";
import { network } from "hardhat";

export type AddressMap = Record<string, string>;

export function loadAddresses(): AddressMap {
  const filename = (() => {
    if (network.name === "base-sepolia" || network.name.includes("base")) return "base_addresses.json";
    if (network.name === "hardhat" || network.name === "localhost") return "hardhat_addresses.json";
    return `${network.name}_addresses.json`;
  })();
  const file = path.resolve(process.cwd(), "deployment", filename);
  const data = fs.readFileSync(file, "utf8");
  return JSON.parse(data) as AddressMap;
}
