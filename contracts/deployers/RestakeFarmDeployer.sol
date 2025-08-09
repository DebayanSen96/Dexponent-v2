pragma solidity ^0.8.24;
import "../RestakeFarm.sol";
contract RestakeFarmDeployer {
    function deploy(
        bytes32 salt,
        uint256 _farmId,
        address _asset,
        uint256 _maturityPeriod,
        uint256 _verifierIncentiveSplit,
        uint256 _yieldYodaIncentiveSplit,
        uint256 _lpIncentiveSplit,
        uint256 _farmOwnerIncentiveSplit,
        address _strategy,
        address _protocolMaster,
        address _claimToken,
        address _farmOwner,
        address _rootFarmAddress
    ) external returns (address addr) {
        addr = address(new RestakeFarm{salt: salt}(
            _farmId,
            _asset,
            _maturityPeriod,
            _verifierIncentiveSplit,
            _yieldYodaIncentiveSplit,
            _lpIncentiveSplit,
            _farmOwnerIncentiveSplit,
            _strategy,
            _protocolMaster,
            _claimToken,
            _farmOwner,
            _rootFarmAddress
        ));
    }
}
