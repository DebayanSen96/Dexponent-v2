// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../interfaces/FarmStrategy.sol";
import "../../interfaces/adapters/IStakingAdapter.sol";

contract StakingStrategy is FarmStrategy {
    using SafeERC20 for IERC20;

    struct AdapterSet { address adapter; uint256 weightBps; }
    struct IncentiveSplits { uint256 lp; uint256 verifiers; uint256 yieldYodas; uint256 farmOwner; }

    address public rewardToken;
    uint256 public maturityPeriod;
    uint256 public minStakeAmount;
    uint256 public maxStakeAmount;
    uint256 public earlyWithdrawalPenaltyBps;
    bool public autoCompounding;

    IncentiveSplits public splits;

    AdapterSet[] private adapters;
    mapping(address => uint256) public principalAlloc;
    uint256 public totalPrincipal;

    constructor(
        address _farm,
        address _asset,
        address _rewardToken,
        uint256 _maturityPeriod,
        uint256 _minStakeAmount,
        uint256 _maxStakeAmount,
        uint256 _earlyWithdrawalPenaltyBps,
        bool _autoCompounding,
        uint256 _lpSplit,
        uint256 _verifiersSplit,
        uint256 _yieldYodasSplit,
        uint256 _farmOwnerSplit,
        address[] memory _adapters,
        uint256[] memory _weights
    ) FarmStrategy(_farm, _asset) Ownable(msg.sender) {
        require(_farm != address(0) && _asset != address(0) && _rewardToken != address(0), "ADDR");
        require(_adapters.length == _weights.length && _adapters.length > 0, "LEN");
        require(_earlyWithdrawalPenaltyBps <= 10000, "PEN");
        require(_minStakeAmount <= _maxStakeAmount, "LIM");
        require(_lpSplit + _verifiersSplit + _yieldYodasSplit + _farmOwnerSplit == 100, "SPLIT");

        rewardToken = _rewardToken;
        maturityPeriod = _maturityPeriod;
        minStakeAmount = _minStakeAmount;
        maxStakeAmount = _maxStakeAmount;
        earlyWithdrawalPenaltyBps = _earlyWithdrawalPenaltyBps;
        autoCompounding = _autoCompounding;
        splits = IncentiveSplits({ lp: _lpSplit, verifiers: _verifiersSplit, yieldYodas: _yieldYodasSplit, farmOwner: _farmOwnerSplit });

        uint256 sum;
        for (uint256 i = 0; i < _adapters.length; i++) {
            adapters.push(AdapterSet({ adapter: _adapters[i], weightBps: _weights[i] }));
            sum += _weights[i];
        }
        require(sum == 10000, "BPS");
    }

    function _pullFromFarm(uint256 amount) internal {
        if (asset == address(0)) revert();
        IERC20(asset).safeTransferFrom(farm, address(this), amount);
    }

    function _pushToFarm(uint256 amount) internal {
        if (asset == address(0)) revert();
        IERC20(asset).safeTransfer(farm, amount);
    }

    function adaptersCount() external view returns (uint256) { return adapters.length; }

    function getAdapter(uint256 i) external view returns (address adapter, uint256 weightBps) {
        AdapterSet memory s = adapters[i];
        return (s.adapter, s.weightBps);
    }

    function deployLiquidity(uint256 amount) external payable override onlyFarm nonReentrant {
        if (asset == address(0)) revert();
        require(amount > 0, "AMT");
        require(amount >= minStakeAmount, "MIN");
        _pullFromFarm(amount);
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
        if (asset == address(0)) revert();
        require(amount > 0 && amount <= totalPrincipal, "AMT");
        uint256 total;
        if (totalPrincipal == 0) {
            _pushToFarm(0);
            emit LiquidityWithdrawn(0);
            return;
        }
        for (uint256 i = 0; i < adapters.length; i++) {
            address a = adapters[i].adapter;
            uint256 pa = principalAlloc[a];
            if (pa == 0) continue;
            uint256 part = (pa * amount) / totalPrincipal;
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
        if (asset == address(0)) revert();
        uint256 total;
        for (uint256 i = 0; i < adapters.length; i++) {
            address a = adapters[i].adapter;
            uint256 got = IStakingAdapter(a).harvest(asset);
            if (autoCompounding && got > 0) {
                SafeERC20.forceApprove(IERC20(asset), a, 0);
                SafeERC20.forceApprove(IERC20(asset), a, got);
                uint256 staked = IStakingAdapter(a).deposit(asset, got);
                principalAlloc[a] += staked;
                totalPrincipal += staked;
            } else {
                total += got;
            }
        }
        if (total > 0) {
            IERC20(asset).safeTransfer(farm, total);
        }
        emit RewardsHarvested(total);
        return total;
    }

    function rebalance() external override onlyFarm nonReentrant {
        emit StrategyRebalanced();
    }

    function rebalanceWithData(bytes calldata) external override onlyFarm nonReentrant {
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

    function getIncentiveSplits()
        external
        view
        override
        returns (
            uint256 lp,
            uint256 verifiers,
            uint256 yieldYodas,
            uint256 farmOwner
        )
    {
        IncentiveSplits memory s = splits;
        return (s.lp, s.verifiers, s.yieldYodas, s.farmOwner);
    }

    function setIncentiveSplits(uint256 _lp, uint256 _verifiers, uint256 _yieldYodas, uint256 _farmOwner) external onlyOwner {
        require(_lp + _verifiers + _yieldYodas + _farmOwner == 100, "SPLIT");
        splits = IncentiveSplits({ lp: _lp, verifiers: _verifiers, yieldYodas: _yieldYodas, farmOwner: _farmOwner });
    }

    function setLimits(uint256 _min, uint256 _max) external onlyOwner {
        require(_min <= _max, "LIM");
        minStakeAmount = _min;
        maxStakeAmount = _max;
    }

    function setMaturity(uint256 _maturityPeriod) external onlyOwner {
        maturityPeriod = _maturityPeriod;
    }

    function setEarlyWithdrawalPenaltyBps(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "PEN");
        earlyWithdrawalPenaltyBps = _bps;
    }

    function setAutoCompounding(bool _auto) external onlyOwner {
        autoCompounding = _auto;
    }

    function setRewardToken(address _reward) external onlyOwner {
        require(_reward != address(0), "ADDR");
        rewardToken = _reward;
    }

    function setAdapters(address[] calldata _adapters, uint256[] calldata _weights) external onlyOwner {
        require(totalPrincipal == 0, "ACTIVE");
        require(_adapters.length == _weights.length && _adapters.length > 0, "LEN");
        delete adapters;
        uint256 sum;
        for (uint256 i = 0; i < _adapters.length; i++) {
            adapters.push(AdapterSet({ adapter: _adapters[i], weightBps: _weights[i] }));
            sum += _weights[i];
        }
        require(sum == 10000, "BPS");
    }
}
