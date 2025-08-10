// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../../interfaces/adapters/IStakingAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockStakingAdapter is IStakingAdapter {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public totalPrincipal; // asset => principal

    function deposit(address asset, uint256 amount) external returns (uint256) {
        require(asset != address(0) && amount > 0, "BAD");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        totalPrincipal[asset] += amount;
        return amount;
    }

    function withdraw(address asset, uint256 amount) external returns (uint256) {
        require(asset != address(0) && amount > 0, "BAD");
        uint256 bal = totalPrincipal[asset];
        require(amount <= bal, "INSUFFICIENT");
        totalPrincipal[asset] = bal - amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
        return amount;
    }

    function harvest(address /*asset*/) external returns (uint256) {
        return 0;
    }

    function totalAssets(address asset) external view returns (uint256) {
        return totalPrincipal[asset];
    }

    function pendingRewards(address /*asset*/) external pure returns (uint256) {
        return 0;
    }
}
