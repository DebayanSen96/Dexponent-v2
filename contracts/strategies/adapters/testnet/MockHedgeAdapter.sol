// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../../interfaces/adapters/IHedgeAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockHedgeAdapter is IHedgeAdapter {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public exposure;

    function openShort(address asset, uint256 amount) external returns (uint256) {
        require(asset != address(0) && amount > 0, "BAD");
        exposure[asset] += amount;
        return amount;
    }

    function closeShort(address asset, uint256 amount) external returns (uint256) {
        require(asset != address(0) && amount > 0, "BAD");
        uint256 e = exposure[asset];
        require(amount <= e, "EXPO");
        exposure[asset] = e - amount;
        return amount;
    }

    function harvestPnl(address asset) external returns (uint256) {
        asset;
        return 0;
    }

    function totalExposure(address asset) external view returns (uint256) {
        return exposure[asset];
    }
}
