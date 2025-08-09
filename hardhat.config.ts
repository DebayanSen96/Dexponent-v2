import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
      { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
      { version: "0.8.17", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
    ],
    overrides: {
      "contracts/FarmFactory.sol": {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: false,
          metadata: { bytecodeHash: "none" }
        }
      }
    },
  },
  networks: {
    hardhat: { allowUnlimitedContractSize: true },
    "base-sepolia": {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: process.env.WALLET_PRIVATE_KEY ? [process.env.WALLET_PRIVATE_KEY] : [],
    },
  },
};

export default config;
