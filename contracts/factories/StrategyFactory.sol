// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/FarmStrategy.sol";
import "../strategies/templates/StakingStrategy.sol";
import "../strategies/templates/LendingStrategy.sol";
import "../registries/AdapterRegistry.sol";

/**
 * @title StrategyFactory
 * @notice Deploys strategy implementations with customizable parameters and adapter sets chosen by farm owners.
 *         Governance owns the factory and can set the AdapterRegistry. Farm owners call this to deploy strategies
 *         and then plug them into their Farm via Farm.updateStrategy().
 */
contract StrategyFactory is Ownable {
    AdapterRegistry public registry;

    event RegistryUpdated(address indexed registry);
    event StrategyDeployed(address indexed strategy, string template, address farm, address asset);

    constructor(address _registry) Ownable(msg.sender) {
        registry = AdapterRegistry(_registry);
    }

    function setRegistry(address _registry) external onlyOwner {
        registry = AdapterRegistry(_registry);
        emit RegistryUpdated(_registry);
    }

    // ------------- Common input structs -------------

    struct AdapterSelection { string name; uint256 weightBps; }

    struct StakingStrategyArgs {
        address farm;
        address asset;
        address rewardToken;
        uint256 maturityPeriod;
        uint256 minStakeAmount;
        uint256 maxStakeAmount;
        uint256 earlyWithdrawalPenaltyBps;
        bool autoCompounding;
        uint256 lpSplit; uint256 verifiersSplit; uint256 yieldYodasSplit; uint256 farmOwnerSplit;
        AdapterSelection[] adapters; // registry keys and their weights
    }

    struct LendingStrategyArgs {
        address farm;
        address asset;
        string lendingAdapter; // registry key
    }

    // ------------- Helpers -------------

    function _resolveAdapters(AdapterSelection[] memory sel)
        internal
        view
        returns (address[] memory addrs, uint256[] memory weights)
    {
        addrs = new address[](sel.length);
        weights = new uint256[](sel.length);
        uint256 sum;
        for (uint256 i = 0; i < sel.length; i++) {
            address a = registry.adapterOf(keccak256(bytes(sel[i].name)));
            require(a != address(0), "StrategyFactory: adapter not found");
            addrs[i] = a; weights[i] = sel[i].weightBps; sum += weights[i];
        }
        require(sum == 10000, "StrategyFactory: weights != 100%");
    }

    // ------------- Deploy functions -------------

    function deployStakingStrategy(StakingStrategyArgs calldata args) external returns (address strat) {
        (address[] memory adapters, uint256[] memory weights) = _resolveAdapters(args.adapters);
        StakingStrategy s = new StakingStrategy(
            args.farm,
            args.asset,
            args.rewardToken,
            args.maturityPeriod,
            args.minStakeAmount,
            args.maxStakeAmount,
            args.earlyWithdrawalPenaltyBps,
            args.autoCompounding,
            args.lpSplit,
            args.verifiersSplit,
            args.yieldYodasSplit,
            args.farmOwnerSplit,
            adapters,
            weights
        );
        strat = address(s);
        emit StrategyDeployed(strat, "StakingStrategy", args.farm, args.asset);
    }

    function deployLendingStrategy(LendingStrategyArgs calldata args) external returns (address strat) {
        address lendingA = registry.adapterOf(keccak256(bytes(args.lendingAdapter)));
        require(lendingA != address(0), "StrategyFactory: adapter not found");
        LendingStrategy s = new LendingStrategy(args.farm, args.asset, lendingA);
        strat = address(s);
        emit StrategyDeployed(strat, "LendingStrategy", args.farm, args.asset);
    }
}

