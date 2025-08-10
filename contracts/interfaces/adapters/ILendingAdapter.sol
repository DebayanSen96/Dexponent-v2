// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILendingAdapter {
    function depositCollateral(address asset, uint256 amount) external returns (uint256);
    function withdrawCollateral(address asset, uint256 amount) external returns (uint256);
    function borrow(address asset, uint256 amount) external returns (uint256);
    function repay(address asset, uint256 amount) external returns (uint256);
    function totalCollateral(address asset) external view returns (uint256);
    function totalDebt(address asset) external view returns (uint256);
}
