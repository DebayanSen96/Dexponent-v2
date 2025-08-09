// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStakingAdapter {
    function deposit(address asset, uint256 amount) external returns (uint256);
    function withdraw(address asset, uint256 amount) external returns (uint256);
    function harvest(address asset) external returns (uint256);
    function totalAssets(address asset) external view returns (uint256);
    function pendingRewards(address asset) external view returns (uint256);
}
