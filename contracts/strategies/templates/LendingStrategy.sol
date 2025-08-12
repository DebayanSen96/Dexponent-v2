// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../interfaces/FarmStrategy.sol";
import "../../interfaces/adapters/ILendingAdapter.sol";

/**
 * @title LendingStrategy
 * @notice A simple lending strategy that deposits collateral into a single lending adapter.
 *         It treats the adapter's reported collateral minus debt as TVL. Harvest withdraws only
 *         the accrued yield (TVL - principal) back to the Farm, keeping principal invested.
 */
contract LendingStrategy is FarmStrategy {
    using SafeERC20 for IERC20;

    /// @notice The lending adapter used by this strategy (e.g., Aave adapter).
    address public lendingAdapter;

    /// @notice Total principal deployed (tracked in asset units).
    uint256 public totalPrincipal;

    constructor(address _farm, address _asset, address _lendingAdapter)
        FarmStrategy(_farm, _asset)
        Ownable(msg.sender)
    {
        require(_farm != address(0) && _asset != address(0) && _lendingAdapter != address(0), "ADDR");
        lendingAdapter = _lendingAdapter;
    }

    // -----------------------------
    // Internal helpers
    // -----------------------------

    function _pullFromFarm(uint256 amount) internal {
        if (asset == address(0)) revert();
        IERC20(asset).safeTransferFrom(farm, address(this), amount);
    }

    function _pushToFarm(uint256 amount) internal {
        if (asset == address(0)) revert();
        IERC20(asset).safeTransfer(farm, amount);
    }

    // -----------------------------
    // Core (onlyFarm) functions
    // -----------------------------

    function deployLiquidity(uint256 amount) external payable override onlyFarm nonReentrant {
        if (asset == address(0)) revert();
        require(amount > 0, "AMT");

        _pullFromFarm(amount);
        // Approve and deposit collateral to the lending adapter
        SafeERC20.forceApprove(IERC20(asset), lendingAdapter, 0);
        SafeERC20.forceApprove(IERC20(asset), lendingAdapter, amount);
        uint256 deposited = ILendingAdapter(lendingAdapter).depositCollateral(asset, amount);
        require(deposited >= amount, "SLIPP");
        totalPrincipal += deposited;
        emit LiquidityDeployed(deposited);
    }

    function withdrawLiquidity(uint256 amount) external override onlyFarm nonReentrant {
        if (asset == address(0)) revert();
        require(amount > 0 && amount <= totalPrincipal, "AMT");

        uint256 withdrawn = ILendingAdapter(lendingAdapter).withdrawCollateral(asset, amount);
        require(withdrawn == amount, "WITHD");
        totalPrincipal -= withdrawn;
        IERC20(asset).safeTransfer(farm, withdrawn);
        emit LiquidityWithdrawn(withdrawn);
    }

    function harvestRewards() external override onlyFarm nonReentrant returns (uint256 harvested) {
        if (asset == address(0)) revert();
        // Compute profit = TVL - principal
        uint256 tvl = _currentTVL();
        if (tvl <= totalPrincipal) {
            emit RewardsHarvested(0);
            return 0;
        }
        uint256 profit = tvl - totalPrincipal;
        // Withdraw only the profit and forward to Farm
        uint256 got = ILendingAdapter(lendingAdapter).withdrawCollateral(asset, profit);
        if (got > 0) {
            IERC20(asset).safeTransfer(farm, got);
            emit RewardsHarvested(got);
        }
        return got;
    }

    // -----------------------------
    // Optional lifecycle hooks
    // -----------------------------

    function rebalance() external override onlyFarm nonReentrant {
        emit StrategyRebalanced();
    }

    function rebalanceWithData(bytes calldata) external override onlyFarm nonReentrant {
        emit StrategyRebalanced();
    }

    function emergencyWithdraw() external override onlyFarm nonReentrant {
        // Pull all collateral back to the Farm
        uint256 coll = ILendingAdapter(lendingAdapter).totalCollateral(asset);
        if (coll > 0) {
            uint256 got = ILendingAdapter(lendingAdapter).withdrawCollateral(asset, coll);
            totalPrincipal = 0;
            IERC20(asset).safeTransfer(farm, got);
            emit EmergencyWithdrawn(got);
        } else {
            emit EmergencyWithdrawn(0);
        }
    }

    // -----------------------------
    // Views
    // -----------------------------

    function _currentTVL() internal view returns (uint256) {
        uint256 coll = ILendingAdapter(lendingAdapter).totalCollateral(asset);
        uint256 debt = ILendingAdapter(lendingAdapter).totalDebt(asset);
        return coll > debt ? (coll - debt) : 0;
    }

    function getStrategyTVL() external view override returns (uint256) {
        return _currentTVL();
    }

    function getPendingRewards() external view override returns (uint256) {
        uint256 tvl = _currentTVL();
        return tvl > totalPrincipal ? (tvl - totalPrincipal) : 0;
    }

    function getIncentiveSplits()
        external
        pure
        override
        returns (
            uint256 lp,
            uint256 verifiers,
            uint256 yieldYodas,
            uint256 farmOwner
        )
    {
        // Strategy-level splits are not enforced here; Farm handles distribution.
        return (0, 0, 0, 0);
    }
}
