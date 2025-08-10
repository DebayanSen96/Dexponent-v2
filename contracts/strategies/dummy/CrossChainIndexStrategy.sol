// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../interfaces/FarmStrategy.sol";
import "../../interfaces/adapters/IStakingAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract CrossChainIndexStrategy is FarmStrategy {
    using SafeERC20 for IERC20;

    struct AdapterSet { address adapter; uint256 weightBps; }

    AdapterSet[] private adapters;
    mapping(address => uint256) public principalAlloc;
    uint256 public totalPrincipal;

    constructor(address _farm, address _asset, address[] memory _adapters, uint256[] memory _weights) FarmStrategy(_farm, _asset) Ownable(msg.sender) {
        require(_farm != address(0) && _asset != address(0), "ADDR");
        require(_adapters.length == _weights.length && _adapters.length > 0, "LEN");
        uint256 sum;
        for (uint256 i = 0; i < _adapters.length; i++) {
            adapters.push(AdapterSet({ adapter: _adapters[i], weightBps: _weights[i] }));
            sum += _weights[i];
        }
        require(sum == 10000, "BPS");
    }

    function adaptersCount() external view returns (uint256) { return adapters.length; }

    function getAdapter(uint256 i) external view returns (address adapter, uint256 weightBps) {
        AdapterSet memory s = adapters[i];
        return (s.adapter, s.weightBps);
    }

    function deployLiquidity(uint256 amount) external payable override onlyFarm nonReentrant {
        require(amount > 0 && amount <= IERC20(asset).balanceOf(farm), "AMT");
        IERC20(asset).safeTransferFrom(farm, address(this), amount);
        for (uint256 i = 0; i < adapters.length; i++) {
            uint256 part = (amount * adapters[i].weightBps) / 10000;
            if (part == 0) continue;
            SafeERC20.forceApprove(IERC20(asset), adapters[i].adapter, 0);
            SafeERC20.forceApprove(IERC20(asset), adapters[i].adapter, part);
            uint256 staked = IStakingAdapter(adapters[i].adapter).deposit(asset, part);
            principalAlloc[adapters[i].adapter] += staked;
            totalPrincipal += staked;
        }
        emit LiquidityDeployed(amount);
    }

    function withdrawLiquidity(uint256 amount) external override onlyFarm nonReentrant {
        require(amount > 0 && amount <= totalPrincipal, "AMT");
        uint256 total;
        for (uint256 i = 0; i < adapters.length; i++) {
            address a = adapters[i].adapter;
            uint256 pa = principalAlloc[a];
            if (pa == 0) continue;
            uint256 part = (amount * pa) / totalPrincipal;
            if (part == 0) continue;
            uint256 got = IStakingAdapter(a).withdraw(asset, part);
            principalAlloc[a] = pa - part;
            total += got;
        }
        totalPrincipal -= amount;
        IERC20(asset).safeTransfer(farm, total);
        emit LiquidityWithdrawn(total);
    }

    function harvestRewards() external override onlyFarm nonReentrant returns (uint256 harvested) {
        uint256 total;
        for (uint256 i = 0; i < adapters.length; i++) {
            address a = adapters[i].adapter;
            uint256 got = IStakingAdapter(a).harvest(asset);
            total += got;
        }
        if (total > 0) IERC20(asset).safeTransfer(farm, total);
        emit RewardsHarvested(total);
        return total;
    }

    function rebalanceWithData(bytes calldata data) external override onlyFarm nonReentrant {
        (address[] memory _adapters, uint256[] memory _weights) = abi.decode(data, (address[], uint256[]));
        require(_adapters.length == _weights.length && _adapters.length > 0, "LEN");
        require(totalPrincipal == 0, "ACTIVE");
        delete adapters;
        uint256 sum;
        for (uint256 i = 0; i < _adapters.length; i++) {
            adapters.push(AdapterSet({ adapter: _adapters[i], weightBps: _weights[i] }));
            sum += _weights[i];
        }
        require(sum == 10000, "BPS");
        emit StrategyRebalanced();
    }

    function emergencyWithdraw() external override onlyFarm nonReentrant {
        uint256 total;
        for (uint256 i = 0; i < adapters.length; i++) {
            address a = adapters[i].adapter;
            uint256 pa = principalAlloc[a];
            if (pa == 0) continue;
            uint256 got = IStakingAdapter(a).withdraw(asset, pa);
            principalAlloc[a] = 0;
            total += got;
        }
        totalPrincipal = 0;
        IERC20(asset).safeTransfer(farm, total);
        emit EmergencyWithdrawn(total);
    }

    function getStrategyTVL() external view override returns (uint256) {
        uint256 tvl;
        for (uint256 i = 0; i < adapters.length; i++) {
            tvl += IStakingAdapter(adapters[i].adapter).totalAssets(asset);
        }
        return tvl;
    }

    function getPendingRewards() external view override returns (uint256) {
        uint256 pending;
        for (uint256 i = 0; i < adapters.length; i++) {
            pending += IStakingAdapter(adapters[i].adapter).pendingRewards(asset);
        }
        return pending;
    }
}
