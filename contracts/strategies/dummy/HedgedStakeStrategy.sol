// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../interfaces/FarmStrategy.sol";
import "../../interfaces/adapters/IStakingAdapter.sol";
import "../../interfaces/adapters/IHedgeAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract HedgedStakeStrategy is FarmStrategy {
    using SafeERC20 for IERC20;

    address public stakingAdapter;
    address public hedgeAdapter;
    uint256 public totalPrincipal;

    constructor(address _farm, address _asset, address _stakingAdapter, address _hedgeAdapter) FarmStrategy(_farm, _asset) Ownable(msg.sender) {
        require(_farm != address(0) && _asset != address(0) && _stakingAdapter != address(0) && _hedgeAdapter != address(0), "ADDR");
        stakingAdapter = _stakingAdapter;
        hedgeAdapter = _hedgeAdapter;
    }

    function deployLiquidity(uint256 amount) external payable override onlyFarm nonReentrant {
        require(amount > 0, "AMT");
        IERC20(asset).safeTransferFrom(farm, address(this), amount);
        SafeERC20.forceApprove(IERC20(asset), stakingAdapter, 0);
        SafeERC20.forceApprove(IERC20(asset), stakingAdapter, amount);
        uint256 staked = IStakingAdapter(stakingAdapter).deposit(asset, amount);
        totalPrincipal += staked;
        SafeERC20.forceApprove(IERC20(asset), hedgeAdapter, 0);
        SafeERC20.forceApprove(IERC20(asset), hedgeAdapter, amount);
        IHedgeAdapter(hedgeAdapter).openShort(asset, amount);
        emit LiquidityDeployed(amount);
    }

    function withdrawLiquidity(uint256 amount) external override onlyFarm nonReentrant {
        require(amount > 0 && amount <= totalPrincipal, "AMT");
        uint256 got = IStakingAdapter(stakingAdapter).withdraw(asset, amount);
        IHedgeAdapter(hedgeAdapter).closeShort(asset, amount);
        totalPrincipal -= amount;
        IERC20(asset).safeTransfer(farm, got);
        emit LiquidityWithdrawn(got);
    }

    function harvestRewards() external override onlyFarm nonReentrant returns (uint256 harvested) {
        uint256 fromStake = IStakingAdapter(stakingAdapter).harvest(asset);
        uint256 fromHedge = IHedgeAdapter(hedgeAdapter).harvestPnl(asset);
        uint256 total = fromStake + fromHedge;
        if (total > 0) IERC20(asset).safeTransfer(farm, total);
        emit RewardsHarvested(total);
        return total;
    }

    function emergencyWithdraw() external override onlyFarm nonReentrant {
        uint256 got = IStakingAdapter(stakingAdapter).withdraw(asset, totalPrincipal);
        IHedgeAdapter(hedgeAdapter).closeShort(asset, totalPrincipal);
        totalPrincipal = 0;
        IERC20(asset).safeTransfer(farm, got);
        emit EmergencyWithdrawn(got);
    }

    function getStrategyTVL() external view override returns (uint256) {
        return IStakingAdapter(stakingAdapter).totalAssets(asset);
    }

    function getPendingRewards() external view override returns (uint256) {
        return IStakingAdapter(stakingAdapter).pendingRewards(asset);
    }
}
