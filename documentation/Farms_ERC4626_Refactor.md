# Dexponent Farms & Strategy Refactor: ERC4626-Style Rewards

This document proposes refactor from the legacy time-based reward model to an ERC4626-style, share-proportional rewards model. It also clarifies contract responsibilities, authority boundaries, configuration flows, and integration with the broader protocol (e.g., ProtocolCore). Use this as the authoritative guide for the new architecture.

## 1. Executive Summary
- Legacy was time-based with a dummy `rewardRate`; rewards accrued over time using stake timestamps and were claimed directly in Strategy.
- New model removes time-based logic entirely and adopts ERC4626-style proportional rewards:
  - Investors receive claim tokens representing their share of total farm liquidity (TVL).
  - Rewards harvested from underlying protocols are split dynamically and distributed proportionally to claim token holders via `accYieldPerShare` in Farm.
  - Non-LP allocations are distributed directly to designated recipients configured in Strategy.
- Management surfaces are consolidated: Farm owner manages Strategy via onlyFarm-gated functions; Strategy enforces authorization.
- Protocol configuration is performed post-deployment, after Farm authorization.

## 2. Legacy Model (For Context)
- Strategy tracked `rewardRate`, `lastRewardTime`, and `accumulatedRewards` per staker.
- Rewards were derived from elapsed time, not actual harvested yield.
- Non-LP splits were implicit or hardcoded on the Farm side.
- Factory wired protocol configuration during Strategy deployment, leading to early permission issues.

## 3. New Architecture Overview
- Farm is the front-door and accounting layer for LPs. It holds the principal ERC20, issues `FarmClaimToken` shares, accounts LP yield via `accYieldPerShare`, and orchestrates Strategy actions.
- Strategy (e.g., `MultiProtocolStrategy` here is a simple staking strategy we have implemented for example) is the integration and execution layer. It maintains incentive splits and distribution recipient addresses, deploys to/withdraws from external protocols using adapters (since different protocols have different interfaces to interact with their contracts), and harvests rewards to the Farm.
- Protocol adapters are per-integration modules implementing standardized deposit/withdraw/harvest functions specific to the external protocol like we can have adapters for Lido, Aave, etc.
- Deployment Service deploys Farm and Strategy, then authorizes the Farm on Strategy. Protocol configuration and recipient settings occur after authorization via Farm.

## 4. Contracts & Responsibilities

### Farm
- Maintains LP accounting:
  - `claimToken` as the 'share' token (implements `BaseClaimToken`).
  - `accYieldPerShare` to attribute harvested yield to LPs pro‑rata.
  - `yieldDebt[lp]` to preserve pending when positions change.
- Orchestrates lifecycle:
  - `provideLiquidity(amount, maturity)`: transfers principal from the user to the Farm, mints claim tokens 1:1 with principal, updates the LP position’s `principal` and `weightedMaturity`.
  - `withdrawLiquidity(amount, returnBonus)`: applies a 0.5% early‑withdraw slash if before weighted maturity, optionally reduces LP bonus, burns claim tokens, and returns principal. If on‑farm liquidity is insufficient, it pulls from Strategy.
  - Yield settlement occurs during withdrawals via `_claimYield` based on `accYieldPerShare` and `yieldDebt`.
- Liquidity accounting:
  - `totalLiquidity`, `deployedLiquidity`, and `availableLiquidity()` reflect principal held vs deployed.
- Pool dependency:
  - `pool` implements `IFarmLiquidityPool` and must provide `getDXPToken()` for yield settlement paths.
- Management (only owner/farmOwner):
  - Strategy: `updateStrategy(strategy)`, `rebalanceStrategy()`, `rebalanceStrategy(bytes)`, `migrateStrategy(newStrategy)`.
  - Liquidity controls: `deployLiquidity(amount)`, `withdrawFromStrategy(amount)`, `rebalanceToTarget()`.
  - Reserves/epochs: `setReserveRatioBps(bps)`, `setMinReserve(min)`, `startEpoch(targetReserveBps, minReserve)`.
  - Pool: `setPool(address)`.
  - Ops: `pause()`, `unpause()`.
- Read/View APIs:
  - Liquidity: `availableLiquidity()`, `totalLiquidity`, `deployedLiquidity`.
  - Positions/yield: `positions(lp)`, `pendingYield(lp)`, `accYieldPerShare`, `principalReserve`.
  - Reserve/epoch: `reserveRatioBps`, `minReserve`, `currentEpochId`, `epochs(id)`.
  - Wiring: `claimToken()`, `strategy()`, `pool()`, `protocolMaster()`, `farmOwner()`, `farmId()`.

### Strategy (e.g., `StakingStrategy`)
- Holds adapter set and weights; routes `deployLiquidity` and `withdrawLiquidity` across adapters. (for example, it can have adapters for Lido & Aave with weights 0.5 & 0.5, which splits the liquidity between the two protocols as per the weights.)
- Enforces `onlyFarm` for state‑changing calls; the Farm address is set at construction and via Farm’s `updateStrategy`.
- `harvestRewards()` collects principal‑denominated rewards from adapters and transfers to the Farm; no time‑weighted accrual in Strategy.
- Exposes adapter views and internal accounting as implemented per strategy module.
- Ops: `pause`, `unpause`.

### Protocol Adapters
- Uniform adapter contracts for interacting with external protocols implement deposit/withdraw/harvest for the Farm’s principal asset.
- Strategy selects targets and splits by configured weights; adapters hold any protocol‑specific receipts internally.

### ProtocolCore Integration
- Owns `FarmFactory` and creates farms deterministically via deployers.
- Sets protocol‑wide components (e.g., Liquidity Manager, Bridge Adapter, Consensus). Farms read protocol state where relevant.
- Approves farm owners and mediates governance operations; day‑to‑day Strategy management flows from Farm owner to Strategy via onlyFarm‑gated calls.

#### Factory and Deployer Pattern (CREATE2)
- Previously: `FarmFactory` constructed farms directly on behalf of `ProtocolCore`.
- Now: `FarmFactory` delegates to deployer contracts (`deployers/FarmDeployer.sol`, `deployers/RestakeFarmDeployer.sol`) and uses `new Contract{salt: ...}` (CREATE2) for deterministic addresses.
- Determinism: the factory computes a `finalSalt = keccak256(abi.encodePacked(msg.sender, salt))` so the same salt from different callers yields distinct addresses while remaining predictable per caller.
- Ownership: `ProtocolCore` owns `FarmFactory`; only the owner can call `createFarm`/`createRestakeFarm`.
- Upgradability: the factory holds deployer addresses; swapping a deployer updates construction logic without replacing the factory.
 - Rationale: the direct-construction approach made the factory monolithic and risked breaching the EVM contract bytecode size limit (~24 KB). Splitting logic into deployers keeps the factory small, focused, and easier to evolve while retaining deterministic addresses.
 - Note on proxies: the current implementation does not use minimal proxies or upgradeable proxies. If size or upgrade concerns grow, EIP‑1167 minimal proxies or EIP‑1967 proxy patterns can be introduced at the deployer layer without changing the factory interface.

## 5. Authority & Access Control
- Farm
  - `Ownable`; the Farm owner manages Strategy wiring and operational controls.
  - Users interact only with Farm for deposit/withdraw.
- Strategy
  - `onlyFarm` gating; Farm address is set in construction and updated by Farm when swapping strategies.
- ProtocolCore
  - Owns `FarmFactory`, approves farm owners, and sets protocol modules.

## 6. ERC4626-Style Rewards Accounting
- Shares: `claimToken` represents LP shares; Farm mints/burns 1:1 with principal and tracks `totalLiquidity`.
- Yield distribution
  - Strategy sends harvested principal‑denominated rewards to Farm.
  - Farm attributes LP portion via `accYieldPerShare` and pays non‑LP portions per configured splits/recipients.
- Pending accounting
  - On deposit: pending is preserved via `yieldDebt` updates.
  - On withdraw: Farm settles pending yield and returns principal (subject to early slash if before maturity).

## 7. Incentive Splits & Recipients
- Splits define LP and non‑LP allocations and must sum to 10000 bps. LP share is accounted in Farm; non‑LP shares are routed to recipients.
- Recipients are stored where configured by the strategy module and/or farm; zero addresses fall back to farm owner where implemented.

## 8. Management & Operations
- Deployment Flow
  1. `ProtocolCore` creates farms via `FarmFactory` and approved deployers.
  2. Deploy strategy with the Farm address; Farm calls `updateStrategy` to finalize wiring.
  3. Configure adapters/weights at the strategy level if applicable.
  4. Set recipients and splits per module design.
- Runtime
  - LPs call `provideLiquidity(amount, maturity)` and `withdrawLiquidity(amount, returnBonus)`.
  - Farm owner may call `deployLiquidity(amount)` to route funds into Strategy; Farm pulls back from Strategy during user withdrawals if needed.
- Safety
  - `pause/unpause` on Farm and Strategy.

## 9. Removed Legacy Elements
- From Strategy
  - `rewardRate`, `totalRewards`, `RewardsClaimed` event, and `setRewardRate` function removed.
  - Time-based accrual (`stakeTime/lastRewardTime/accumulatedRewards`) removed from reward calculations.
- From Farm
  - `IFarmStrategy.setRewardRate` and Farm’s `setRewardRate` wrapper and related event removed.

## 10. Migration Guide (Legacy → New)
- Deploy Farm via `ProtocolCore` → `FarmFactory`; deploy Strategy with Farm address.
- Wire Farm to Strategy using `updateStrategy`.
- Configure adapters/weights, splits, and recipients.
- Remove time‑based reward logic references.
- Validate end‑to‑end by:
  - Depositing with multiple users.
  - Harvesting and verifying `accYieldPerShare` changes.
  - Checking non-LP transfers align with configured recipients.
  - Withdrawing and confirming pending yield payout and share burn.

## 11. Security & Risk Considerations
- Access control
  - Ensure only the intended Farm is authorized on Strategy; revoke if Farm is rotated.
  - Keep Strategy ownership secure; reserve for break-glass controls.
- Split correctness
  - Enforce sum to 10000; handle zero-recipient fallback deterministically.
- Adapter interactions
  - Validate approvals and receipt handling; confirm adapter success flags.
- Accounting integrity
  - Verify share mint/burn logic and rounding; use `1e12` precision in `accYieldPerShare`.
- Pausing and emergency flows
  - Exercise `pause` and `emergencyWithdraw` in staging.

## 12. Testing Checklist
- Deploy → authorize → configure protocols → set splits/recipients.
- Multi-user deposit; confirm share issuance relative to TVL.
- Harvest; confirm LP/non-LP split; verify recipients get paid.
- Deposit after prior pending; confirm pending preserved.
- Withdraw; confirm pending paid plus principal returned.
- Pause/unpause behavior; emergency flows.

## 13. Appendix: Key Interfaces & Functions (Summary)
- Farm (owner): `updateStrategy`, `deployLiquidity`, `pause`, `unpause`
- Farm (LP): `provideLiquidity(amount, maturity)`, `withdrawLiquidity(amount, returnBonus)`
- Farm (view): `availableLiquidity`, `claimToken`, `positions(lp)`
- Strategy (onlyFarm): `deployLiquidity`, `withdrawLiquidity`, `harvestRewards`, `pause`, `unpause`
- Strategy (view): adapter lists and weights as implemented per module

