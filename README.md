# DexponentV2

A modular farming protocol with ERC4626-style share accounting, modular strategies, and adapter integrations. This README explains how to set up, deploy, and test locally or on Base Sepolia.

## Prerequisites
- Node.js LTS and npm
- Hardhat toolchain
- A wallet private key for deployments/tests that send txs
- Optional: Base Sepolia ETH for on-chain tests

## Install
- npm install

## Environment
Create a .env file at the repo root:

WALLET_PRIVATE_KEY=your_private_key

- For Base Sepolia testing, fund the wallet with some Base Sepolia ETH.

## Deployment & Testing Overview
There are two main flows: transient local deployments for unit testing, and persistent node deployments that tests can connect to. You can also deploy to Base Sepolia for on-chain testing.

### 1) Quick local deployment (transient)
- npx ts-node scripts/ProtocolDeployNew.ts
- This deploys to an ephemeral in-process Hardhat network and writes deployment/hardhat_addresses.json. Contracts do not persist after the script exits, so direct hardhat tests without a persistent node will not find those addresses.

### 2) Persistent local node + tests
- Terminal 1: npx hardhat node
- Terminal 2: npx ts-node scripts/ProtocolDeployNew.ts --network localhost
- Then run tests against the persistent node:
- npx hardhat test --network localhost
- This ensures tests use real, active contracts on your local node and addresses under deployment/hardhat_addresses.json.

Alternatively, run everything in one shot (Recommended):
- bash scripts/run-local-tests.sh
- This script starts/stops the local node, deploys, and runs tests automatically.

### 3) Base Sepolia on-chain deployment
- npx ts-node scripts/ProtocolDeployNew.ts --network base-sepolia
- This writes deployment/base_addresses.json with live addresses (e.g., DXPToken, FarmFactory, ProtocolCore, ModularFarm, ModularStakingStrategy, MockPool).

### 4) On-chain interaction test (staking flow)
- npx ts-node scripts/ModularFarmStake.ts --network base-sepolia
- This script uses deployment/base_addresses.json and exercises deposit, deploy liquidity (owner), and withdrawal flows on the modular farm.

## Major Contract Changes
- ProtocolCore: light updates to own the factory, mediate governance, and set protocol modules.
- Farm: significant refactor to ERC4626-style accounting, maturity/early-withdraw handling, liquidity deployment/withdraw, and pool dependency for DXP settlement.
- Strategy (e.g., StakingStrategy): major changes to enforce onlyFarm, orchestrate adapters, and harvest returns to Farm.
- FarmFactory: updated to use deployers with CREATE2 for deterministic addresses.
- Adapters: new integration layer contracts (e.g., testnet MockStakingAdapter) for external protocol interactions.

## Key Scripts
- scripts/ProtocolDeployNew.ts: end-to-end protocol deployer (local or Base Sepolia).
- scripts/run-local-tests.sh: spins a local node, deploys, runs tests, and tears down.
- scripts/ModularFarmStake.ts: example on-chain staking flow using deployed addresses.

## Deployment Artifacts
- deployment/hardhat_addresses.json: local node addresses.
- deployment/base_addresses.json: Base Sepolia addresses.

## Notes
- For Base Sepolia or any live network, use a funded WALLET_PRIVATE_KEY in .env.
- If tests require persistent contracts, use the persistent node flow or run the helper script.
- Ensure deployment JSON files exist for the selected network before running interaction scripts.
