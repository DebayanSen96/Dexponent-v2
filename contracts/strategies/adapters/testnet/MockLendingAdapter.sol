// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../../interfaces/adapters/ILendingAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockLendingAdapter is ILendingAdapter {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;

    function depositCollateral(address asset, uint256 amount) external returns (uint256) {
        require(asset != address(0) && amount > 0, "BAD");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        collateral[asset] += amount;
        return amount;
    }

    function withdrawCollateral(address asset, uint256 amount) external returns (uint256) {
        require(asset != address(0) && amount > 0, "BAD");
        uint256 c = collateral[asset];
        require(amount <= c, "INS");
        collateral[asset] = c - amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
        return amount;
    }

    function borrow(address asset, uint256 amount) external returns (uint256) {
        require(asset != address(0) && amount > 0, "BAD");
        debt[asset] += amount;
        return amount;
    }

    function repay(address asset, uint256 amount) external returns (uint256) {
        require(asset != address(0) && amount > 0, "BAD");
        uint256 d = debt[asset];
        require(amount <= d, "DEBT");
        debt[asset] = d - amount;
        return amount;
    }

    function totalCollateral(address asset) external view returns (uint256) {
        return collateral[asset];
    }

    function totalDebt(address asset) external view returns (uint256) {
        return debt[asset];
    }
}
