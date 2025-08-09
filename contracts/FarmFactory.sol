// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IFarmFactory.sol";
import "./deployers/FarmDeployer.sol";
import "./deployers/RestakeFarmDeployer.sol";

/**
 * @title FarmFactory
 * @notice Factory for deploying Farm, RestakeFarm and RootFarm via CREATE2 salt
 *         using the new `new Contract{salt:...}` pattern.
 */
contract FarmFactory is Ownable, IFarmFactory {
    uint256 public currentFarmId;
    address public farmDeployer;
    address public restakeFarmDeployer;

    constructor(address _farmDeployer, address _restakeFarmDeployer) Ownable(msg.sender) {
        currentFarmId = 1;
        farmDeployer = _farmDeployer;
        restakeFarmDeployer = _restakeFarmDeployer;
    }

    function createFarm(
        bytes32 salt,
        address asset,
        uint256 maturityPeriod,
        uint256 verifierIncentiveSplit,
        uint256 yieldYodaIncentiveSplit,
        uint256 lpIncentiveSplit,
        uint256 farmOwnerIncentiveSplit,
        address strategy,
        address claimToken,
        address farmOwner
    ) external override onlyOwner returns (uint256 farmId, address farmAddress) {
        farmId = currentFarmId++;
        bytes32 finalSalt = keccak256(abi.encodePacked(msg.sender, salt));

        farmAddress = FarmDeployer(farmDeployer).deploy(
            finalSalt,
            farmId,
            asset,
            maturityPeriod,
            verifierIncentiveSplit,
            yieldYodaIncentiveSplit,
            lpIncentiveSplit,
            farmOwnerIncentiveSplit,
            strategy,
            owner(),
            claimToken,
            farmOwner
        );
    }

    function createRestakeFarm(
        bytes32 salt,
        address asset,
        uint256 maturityPeriod,
        uint256 verifierIncentiveSplit,
        uint256 yieldYodaIncentiveSplit,
        uint256 lpIncentiveSplit,
        uint256 farmOwnerIncentiveSplit,
        address strategy,
        address claimToken,
        address farmOwner,
        address rootFarmAddress
    ) external onlyOwner returns (uint256 farmId, address farmAddress) {
        farmId = currentFarmId++;
        bytes32 finalSalt = keccak256(abi.encodePacked(msg.sender, salt));

        farmAddress = RestakeFarmDeployer(restakeFarmDeployer).deploy(
            finalSalt,
            farmId,
            asset,
            maturityPeriod,
            verifierIncentiveSplit,
            yieldYodaIncentiveSplit,
            lpIncentiveSplit,
            farmOwnerIncentiveSplit,
            strategy,
            owner(),
            claimToken,
            farmOwner,
            rootFarmAddress
        );
    }

}
