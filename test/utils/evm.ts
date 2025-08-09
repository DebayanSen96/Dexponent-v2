import { ethers } from "hardhat";

export async function isContract(addr: string): Promise<boolean> {
  const code = await ethers.provider.getCode(addr);
  return code && code !== "0x";
}
