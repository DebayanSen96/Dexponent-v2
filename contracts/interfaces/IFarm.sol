// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal external interface to interact with a Farm contract.
interface IFarm {
    // ─────────────────────────────────────────────────
    // LP ACTIONS
    // ─────────────────────────────────────────────────

    /// @notice Deposit `amount` of principal, locking until `maturity`.
    /// @param amount The deposit amount.
    /// @param maturity Absolute UNIX timestamp when funds unlock.
    function provideLiquidity(uint256 amount, uint256 maturity) external payable;

    /// @notice Withdraw `amount` of principal; optionally return bonus.
    /// @param amount Amount of principal to withdraw.
    /// @param returnBonus If true, triggers bonus reversal.
    function withdrawLiquidity(uint256 amount, bool returnBonus) external;

    /// @notice Exit fully: withdraw all principal + bonus + yield.
    function fullExit() external;

    /// @notice Claim any pending DXP yield.
    function claimYield() external;

    /// @notice View how much DXP yield is pending for `lp`.
    function pendingYield(address lp) external view returns (uint256);

    // ─────────────────────────────────────────────────
    // FARM OWNER ACTIONS
    // ─────────────────────────────────────────────────

    /// @notice Deploy `amount` of available liquidity into the strategy.
    function deployLiquidity(uint256 amount) external;

    /// @notice Withdraw `amount` of deployed liquidity from the strategy.
    function withdrawFromStrategy(uint256 amount) external;

    /// @notice Harvest + convert yield, update internal accumulators, and return net DXP.
    /// @return revenue The DXP pulled (sent back to caller).
    function pullFarmRevenue() external returns (uint256);

    /// @notice Set reserve ratio in bps (0-10000).
    function setReserveRatioBps(uint256 bps) external;

    /// @notice Set absolute minimum reserve in principal units.
    function setMinReserve(uint256 minReserve) external;

    /// @notice Start a new epoch, setting target reserve parameters.
    function startEpoch(uint256 targetReserveBps, uint256 minReserve) external;

    /// @notice Rebalance deployed vs reserve to match target settings.
    function rebalanceToTarget() external;

    /// @notice Trigger a generic strategy rebalance (no data).
    function rebalanceStrategy() external;

    /// @notice Trigger a strategy rebalance with ABI-encoded params.
    function rebalanceStrategy(bytes calldata data) external;

    /// @notice Safe migration flow: requires paused, pulls funds, and updates strategy.
    function migrateStrategy(address newStrategy) external;

    /// @notice Pause or unpause LP actions.
    function pause() external;
    function unpause() external;

    /// @notice Update the on-chain strategy address.
    function updateStrategy(address newStrategy) external;

    /// @notice Set the associated pool for price quotes.
    function setPool(address pool) external;

    // ─────────────────────────────────────────────────
    // INFORMATIONAL
    // ─────────────────────────────────────────────────

    /// @notice How much principal is immediately available (not deployed).
    function availableLiquidity() external view returns (uint256);

    /// @notice Get this farm’s unique ID.
    function farmId() external view returns (uint256);

    /// @notice Current reserve ratio in bps and minimum reserve.
    function reserveRatioBps() external view returns (uint256);
    function minReserve() external view returns (uint256);

    /// @notice Current epoch id.
    function currentEpochId() external view returns (uint256);

    /// @notice Epoch data accessor; matches public mapping getter in Farm.
    function epochs(uint256 id)
        external
        view
        returns (
            uint256 eid,
            uint256 startTime,
            uint256 targetReserveBps,
            uint256 minReserve_,
            uint256 deployedAtStart,
            uint256 harvestedInEpoch
        );

    /// @notice Splits (immutable per farm, must sum to 100).
    function lpIncentiveSplit() external view returns (uint256);
    function verifierIncentiveSplit() external view returns (uint256);
    function yieldYodaIncentiveSplit() external view returns (uint256);
    function farmOwnerIncentiveSplit() external view returns (uint256);

    /// @notice Core addresses and state for UI.
    function asset() external view returns (address);
    function pool() external view returns (address);
    function strategy() external view returns (address);
    function totalLiquidity() external view returns (uint256);
    function deployedLiquidity() external view returns (uint256);

    // ─────────────────────────────────────────────────
    // CLAIM-TOKEN CALLBACK
    // ─────────────────────────────────────────────────

    /**
     * @notice Called by the claim-token on every transfer (after fee deduction).
     *         `amount` is the gross transfer amount; the implementation
     *         should compute fee, add it to `principalReserve`, and
     *         adjust sender/recipient `positions[].principal`.
     */
    function onClaimTransfer(
        address sender,
        address recipient,
        uint256 amount
    ) external;
}
