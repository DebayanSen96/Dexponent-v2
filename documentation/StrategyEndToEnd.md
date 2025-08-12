## Dexponent Strategy System: End‑to‑End Architecture and Flow (Current Model)

### 0. Executive Summary
This document describes the full lifecycle of creating, deploying, and operating customizable strategies on Dexponent, from frontend form input to on‑chain asset flow and revenue distribution. It reflects the current code after enabling NAV‑based shares in Farm.sol and maintaining streamed DXP yield.

- Farms issue variable PPS (NAV‑based) claim tokens; shares are minted against pre‑deposit NAV
- Strategies deploy principal into external protocols via adapters; adapters are registered in an AdapterRegistry and resolved by StrategyFactory
- Strategy principal yield is harvested in the farm’s asset; farm converts to DXP for yield distribution (streamed), leaving NAV unaffected
- ProtocolCore handles farm creation, bonus issuance/reversal, revenue routing and splits; RootFarm receives protocol fees

---

## 1. Main Contracts and Responsibilities

### 1.1 ProtocolCore.sol
- Authority/entry for farm creation and approvals
- Issues deposit bonus in DXP (direct to user in current model)
- Pulls farm revenue (calls Farm.pullFarmRevenue) and distributes DXP remainder by splits (verifiers, yield yodas, farm owner) and protocol fee to RootFarm

Key touchpoints (names may vary):
- createApprovedFarm(salt, asset, maturityPeriod, splits, strategy=0, claimName, claimSymbol, isRestake=false, rootFarm=0)
- distributeDepositBonus(farmId, user, amount, maturity)
- pullFarmRevenue(farmId)

### 1.2 Farm.sol (NAV‑based Shares)
- Custody for principal asset; issues claim token (FarmClaimToken)
- NAV model: pricePerShare = totalNAV / totalShares
- Shares minted using pre‑deposit NAV so PPS is not impacted by the deposit
- Tracks user positions (principal, weighted maturity), deposit/withdrawals, yield debt
- Pulls strategy rewards, converts to DXP (via LiquidityManager), streams DXP to LPs via accumulator; sends remainder to ProtocolCore
- Handles transfer‑fee hook from claim token to grow principalReserve (used as part of next revenue pull)

Important functions:
- provideLiquidity(amount, maturity) → mint shares via convertToShares using NAV(before)
- withdrawLiquidity(amount, returnBonus) → burn shares via convertToShares at current NAV
- pricePerShare(): NAV / totalShares (1e18 scaled)
- convertToShares(assets), convertToAssets(shares): NAV math
- totalNAV(): idle principal + strategy TVL in asset units (excludes DXP rewards)
- pullFarmRevenue(): harvest principal, swap to DXP, update accYieldPerShare, send remainder to ProtocolCore
- onClaimTransfer(): collects transfer fee to principalReserve

### 1.3 RootFarm.sol
- DXP‑only treasury farm that mints vDXP and manages protocol DXP revenue
- Current integration: ProtocolCore sends protocol DXP fees here; (optional future) RestakeFarm bonus restake hooks

### 1.4 StrategyFactory.sol + AdapterRegistry
- StrategyFactory deploys strategies by template with parameters provided from frontend
- AdapterRegistry maps human‑readable protocol names (e.g., "lido-staking", "aave-v3") to adapter contract addresses; StrategyFactory resolves at deploy time

### 1.5 Strategy Contracts (FarmStrategy and modules)
- FarmStrategy is the abstract base interface enforced by Farms
- Concrete strategy examples (e.g., StakingStrategy) hold adapter sets and weights, deploy principal, harvest rewards, optionally auto‑compound
- getStrategyTVL(): strategy TVL in farm asset units; adapters’ totalAssets(asset) must already be valued in the farm’s asset

### 1.6 Adapter Contracts
- Protocol‑specific connectors (e.g., Lido, Aave, Uniswap) implementing:
  - deposit(asset, amount), withdraw(asset, amount), harvest(asset)
  - totalAssets(asset) (value in farm asset units)
  - pendingRewards(asset) (view)
- For non‑asset holdings (stETH, LP tokens), adapters must internally value positions in the farm asset (using LiquidityManager price quotes or protocol math)

### 1.7 LiquidityManager
- Provides price quotes and swaps asset→DXP during revenue pulls and for adapter valuation support

---

## 2. Frontend Entry Points and Configurables

### 2.1 Create Farm (must be approved owner)
- Call: ProtocolCore.createApprovedFarm(...)
- Parameters (key ones):
  - asset (base asset for NAV and custody; e.g., USDC or DXP)
  - maturityPeriod (min lock period baseline)
  - splits (lp, verifiers, yieldYodas, farmOwner) sum to 100
  - claim token naming (name/symbol)
  - strategy address initially zero (plug‑and‑play) → set later via Farm.updateStrategy

### 2.2 Deploy Strategy via StrategyFactory
- Call template function with args (example: deployStakingStrategy(args))
- Args include:
  - farm, asset, rewardToken, maturityPeriod
  - minStakeAmount, maxStakeAmount
  - earlyWithdrawalPenaltyBps
  - autoCompounding (strategy‑level, controls reinvestment in adapters)
  - splits (lp/verifiers/yodas/farmOwner) for strategy accounting
  - adapters: [{ name, weightBps }, ...] (names resolved in registry)

### 2.3 Wire Farm ↔ Strategy
- Call: Farm.updateStrategy(strategy)
- Owner/keeper may use:
  - deployLiquidity(amount), withdrawFromStrategy(amount)
  - rebalanceStrategy(), rebalanceToTarget()

### 2.4 Farm configuration (owner)
- setDepositLimits(minDeposit, maxPerUser, maxTotal)
- setPrivate(bool), setAllowlist(user, bool)
- setFeeRecipient(address)
- reserve controls: setReserveRatioBps, setMinReserve, epoch start / rebalance

---

## 3. NAV‑Based Shares (Farm)

- PPS = totalNAV / totalShares (1e18 scaled)
- totalNAV = idle principal (farm asset) + strategy TVL (farm asset units)
- DXP rewards do not change NAV; they’re streamed as separate yield
- Deposit minting uses pre‑deposit NAV:
  - if totalShares == 0: shares = amount
  - else: shares = amount * totalShares / NAV(before)
- Withdrawal burning uses current NAV: sharesToBurn = amount * totalShares / NAV(now)

NAV requires strategies (and adapters) to report TVL in the farm’s asset units via getStrategyTVL and totalAssets(asset).

---

## 4. Asset Flow: From User to Protocols and Back

### 4.1 Staking Strategy (e.g., Lido)
- User deposits asset → Farm mints NAV shares
- Farm owner deploys liquidity → Strategy.deployLiquidity(amount)
- Strategy allocates across staking adapters by weight (e.g., Lido 70%, RocketPool 30%)
- Harvest: adapter.harvest(asset) returns asset principal
  - If autoCompounding: strategy re‑deposits to adapters, increasing strategy TVL (NAV↑)
  - Else: strategy transfers harvested principal back to Farm
- Revenue Pull: Farm converts harvested principal to DXP and updates accYieldPerShare; remainder DXP sent to ProtocolCore for splits
- User yield: claim DX P via Farm.claimYield; principal withdrawals use NAV burn

### 4.2 Lending Strategy (e.g., Aave)
- Same flow as staking; adapters deposit/withdraw collateral/interest in the farm asset
- TVL valuation must reflect collateral minus debt, priced in farm asset
- Harvested principal interest follows the same DXP streaming mechanics

### 4.3 Trading/LP Strategy (generalized)
- Strategy deploys to DEX/LP positions across adapters
- Adapters value positions in farm asset units (underlyings * prices, minus fees)
- Harvest may realize fees in the farm asset; optionally auto‑compound (re‑add liquidity)
- Revenue pull continues with conversion to DXP for streamed yield accounting

Result: Strategy type is abstracted; NAV shares are strategy‑agnostic provided TVL valuation is in the farm asset units.

---

## 5. Revenue, Splits, and Fees

### 5.1 Deposit Bonus (DXP)
- Event: provideLiquidity → Farm calls ProtocolCore.distributeDepositBonus
- Current model: ProtocolCore pays bonus DXP directly to user from protocolReserves
- If ClaimToken transfers occur, onClaimTransfer applies a transfer fee to principalReserve

### 5.2 Revenue Pull (DXP streaming)
- Initiated by ProtocolCore.pullFarmRevenue(farmId)
- Farm harvests principal, combines with principalReserve, swaps asset→DXP (if needed)
- LP share of DXP added to accYieldPerShare (users claim later via claimYield)
- Remainder DXP returned to ProtocolCore

### 5.3 Splits and Protocol Fees
- ProtocolCore distributes DXP remainder by configured splits:
  - Verifiers (V)
  - Yield Yodas (Y)
  - Farm Owner share (to the farm owner address)
- Protocol fee portion goes to RootFarm (treasury)

---

## 6. Security, Access Control, and Safety

- Only approved farm owners can create farms via ProtocolCore
- Only farm owner/keeper can deploy/withdraw to strategy, rebalance, or pause
- NAV minting uses pre‑deposit NAV to prevent PPS manipulation during deposits
- ClaimToken transfer fees flow to principalReserve (used only during revenue pulls)
- Emergency withdraw via strategy hooks; migration flow requires pause

---

## 7. Frontend → On‑Chain End‑to‑End Checklist

1) Frontend builds form data: asset, splits, deposit caps, maturity, adapters+weights, autoCompounding, etc.
2) Backend validates adapters via AdapterRegistry
3) ProtocolCore.createApprovedFarm(...) → returns farmId + farmAddress
4) StrategyFactory.deploy...(args) → returns strategyAddress (via event)
5) Farm.updateStrategy(strategyAddress)
6) Optional farm settings: setDepositLimits, setPrivate, allowlist, reserve ratios
7) Users approve asset to Farm and call provideLiquidity(amount, maturity)
8) Owner/keeper deploys liquidity to strategy, optionally rebalances
9) ProtocolCore.pullFarmRevenue triggers streaming yield and revenue splits
10) Users withdraw principal via NAV; claim DXP yield anytime

---

## 8. Key Code Excerpts

Farm: NAV functions
<small>
</small>
<augment_code_snippet path="contracts/Farm.sol" mode="EXCERPT">
````solidity
function pricePerShare() public view returns (uint256) {
    uint256 ts = totalShares();
    if (ts == 0) return 1e18;
    uint256 nav = totalNAV();
    return (nav * 1e18) / ts;
}
````
</augment_code_snippet>

Farm: Pre‑deposit NAV minting
<augment_code_snippet path="contracts/Farm.sol" mode="EXCERPT">
````solidity
uint256 sharesPre = convertToShares(amount);
// ... transfer in principal ...
claimToken.mint(msg.sender, sharesPre);
````
</augment_code_snippet>

Strategy TVL aggregation (example)
<augment_code_snippet path="contracts/strategies/modules/StakingStrategy.sol" mode="EXCERPT">
````solidity
function getStrategyTVL() external view override returns (uint256) {
    uint256 tvl;
    for (uint256 i = 0; i < adapters.length; i++) {
        tvl += IStakingAdapter(adapters[i].adapter).totalAssets(asset);
    }
    return tvl;
}
````
</augment_code_snippet>

ClaimToken transfer fee callback
<augment_code_snippet path="contracts/Farm.sol" mode="EXCERPT">
````solidity
function onClaimTransfer(address s, address r, uint256 amount) external {
    uint256 fee = protocolMaster.getTransferFeeRate();
    uint256 feeAmount = (amount * fee) / 10000;
    principalReserve += feeAmount;
    // update yieldDebt for s and r to current accumulator
}
````
</augment_code_snippet>

---

## 9. Updated Sequence (Mermaid)
See documentation/uml/strategy-sequence.mmd or the rendered diagram attached in the PR/comment.

