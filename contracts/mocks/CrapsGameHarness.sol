// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CrapsGame} from "../CrapsGame.sol";

contract CrapsGameHarness is CrapsGame {
    constructor(address token_, address vrfCoordinator_, bool debug_)
        CrapsGame(token_, vrfCoordinator_, 1, bytes32(0), debug_)
    {}

    function exposedDebitAvailable(address player, uint256 amount) external {
        _debitAvailable(player, amount);
    }

    function exposedCreditAvailable(address player, uint256 amount) external {
        _creditAvailable(player, amount);
    }

    function exposedReserveFromBankroll(address player, uint256 amount) external {
        _reserveFromBankroll(player, amount);
    }

    function exposedReleaseReserve(address player, uint256 paidOut) external {
        _releaseReserve(player, paidOut);
    }

    function exposedSetPendingVRFRequests(uint256 pendingVRFRequests_) external {
        pendingVRFRequests = pendingVRFRequests_;
    }

    function exposedSetSessionState(
        address player,
        SessionPhase phase,
        uint8 point,
        uint256 pendingRequestId,
        uint48 lastActivityTime
    ) external {
        SessionData storage session = _sessions[player];
        session.phase = phase;
        session.point = point;
        session.pendingRequestId = pendingRequestId;
        session.lastActivityTime = lastActivityTime;
    }

    function exposedAssertInvariant() external view {
        _assertInvariant();
    }
}
