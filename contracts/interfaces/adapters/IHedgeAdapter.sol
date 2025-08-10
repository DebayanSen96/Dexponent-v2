// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHedgeAdapter {
    function openShort(address asset, uint256 amount) external returns (uint256);
    function closeShort(address asset, uint256 amount) external returns (uint256);
    function harvestPnl(address asset) external returns (uint256);
    function totalExposure(address asset) external view returns (uint256);
}
