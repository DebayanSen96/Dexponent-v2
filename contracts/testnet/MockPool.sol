// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPool {
    address private immutable dxp;
    constructor(address _dxp) { dxp = _dxp; }
    function getDXPToken() external view returns (address) { return dxp; }
}
