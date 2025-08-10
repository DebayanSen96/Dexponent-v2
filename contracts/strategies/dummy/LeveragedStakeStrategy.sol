// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../interfaces/FarmStrategy.sol";
import "../../interfaces/adapters/IStakingAdapter.sol";
import "../../interfaces/adapters/ILendingAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract LeveragedStakeStrategy is FarmStrategy {
    using SafeERC20 for IERC20;

    address public stakingAdapter;
    address public lendingAdapter;
    uint256 public totalPrincipal;
    uint256 public leverageBps;

    constructor(address _farm, address _asset, address _stakingAdapter, address _lendingAdapter, uint256 _leverageBps) FarmStrategy(_farm, _asset) Ownable(msg.sender) {
        require(_farm != address(0) && _asset != address(0) && _stakingAdapter != address(0) && _lendingAdapter != address(0), "ADDR");
        require(_leverageBps <= 9000, "BPS");
        stakingAdapter = _stakingAdapter;
        lendingAdapter = _lendingAdapter;
        leverageBps = _leverageBps;
    }

    function deployLiquidity(uint256 amount) external payable override onlyFarm nonReentrant {
        require(amount > 0, "AMT");
        IERC20(asset).safeTransferFrom(farm, address(this), amount);
        SafeERC20.forceApprove(IERC20(asset), stakingAdapter, 0);
        SafeERC20.forceApprove(IERC20(asset), stakingAdapter, amount);
        uint256 staked = IStakingAdapter(stakingAdapter).deposit(asset, amount);
        totalPrincipal += staked;
        SafeERC20.forceApprove(IERC20(asset), lendingAdapter, 0);
        SafeERC20.forceApprove(IERC20(asset), lendingAdapter, amount);
        ILendingAdapter(lendingAdapter).depositCollateral(asset, amount);
        uint256 borrowAmt = (amount * leverageBps) / 10000;
        if (borrowAmt > 0) {
            ILendingAdapter(lendingAdapter).borrow(asset, borrowAmt);
            SafeERC20.forceApprove(IERC20(asset), stakingAdapter, 0);
            SafeERC20.forceApprove(IERC20(asset), stakingAdapter, borrowAmt);
            uint256 stakedBorrow = IStakingAdapter(stakingAdapter).deposit(asset, borrowAmt);
            totalPrincipal += stakedBorrow;
        }
        emit LiquidityDeployed(amount);
    }

    function withdrawLiquidity(uint256 amount) external override onlyFarm nonReentrant {
        require(amount > 0 && amount <= totalPrincipal, "AMT");
        uint256 got = IStakingAdapter(stakingAdapter).withdraw(asset, amount);
        uint256 repayAmt = ILendingAdapter(lendingAdapter).totalDebt(asset);
        if (repayAmt > 0) {
            if (got < repayAmt) {
                uint256 diff = repayAmt - got;
                IERC20(asset).safeTransferFrom(farm, address(this), diff);
                got += diff;
            }
            SafeERC20.forceApprove(IERC20(asset), lendingAdapter, 0);
            SafeERC20.forceApprove(IERC20(asset), lendingAdapter, repayAmt);
            ILendingAdapter(lendingAdapter).repay(asset, repayAmt);
        }
        uint256 coll = ILendingAdapter(lendingAdapter).totalCollateral(asset);
        if (coll > 0) {
            uint256 freed = ILendingAdapter(lendingAdapter).withdrawCollateral(asset, coll);
            got += freed;
        }
        totalPrincipal -= amount;
        IERC20(asset).safeTransfer(farm, got);
        emit LiquidityWithdrawn(got);
    }

    function harvestRewards() external override onlyFarm nonReentrant returns (uint256 harvested) {
        uint256 total;
        uint256 got = IStakingAdapter(stakingAdapter).harvest(asset);
        total += got;
        if (total > 0) IERC20(asset).safeTransfer(farm, total);
        emit RewardsHarvested(total);
        return total;
    }

    function emergencyWithdraw() external override onlyFarm nonReentrant {
        uint256 got = IStakingAdapter(stakingAdapter).withdraw(asset, totalPrincipal);
        uint256 repayAmt = ILendingAdapter(lendingAdapter).totalDebt(asset);
        if (repayAmt > 0) {
            if (got < repayAmt) {
                uint256 diff = repayAmt - got;
                IERC20(asset).safeTransferFrom(farm, address(this), diff);
                got += diff;
            }
            SafeERC20.forceApprove(IERC20(asset), lendingAdapter, 0);
            SafeERC20.forceApprove(IERC20(asset), lendingAdapter, repayAmt);
            ILendingAdapter(lendingAdapter).repay(asset, repayAmt);
        }
        uint256 coll = ILendingAdapter(lendingAdapter).totalCollateral(asset);
        if (coll > 0) {
            uint256 freed = ILendingAdapter(lendingAdapter).withdrawCollateral(asset, coll);
            got += freed;
        }
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
