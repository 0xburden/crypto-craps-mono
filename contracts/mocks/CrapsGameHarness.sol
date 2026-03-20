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

    function exposedSeedPointFourWorstCase(address player) external {
        _trackPlayer(player);

        SessionData storage session = _sessions[player];
        delete session.bets;

        uint256 totalBetAmount = 11_100e6;
        uint256 availableBalance = _available[player];
        if (availableBalance < totalBetAmount) {
            revert InsufficientBalance(availableBalance, totalBetAmount);
        }

        unchecked {
            _available[player] = availableBalance - totalBetAmount;
            _inPlay[player] += totalBetAmount;
            totalAvailable -= totalBetAmount;
            totalInPlay += totalBetAmount;
        }

        session.phase = SessionPhase.POINT;
        session.point = 4;
        session.lastActivityTime = uint48(block.timestamp);
        session.pendingRequestId = 0;
        session.bets.passLine = Bet({amount: 500e6, oddsAmount: 1_500e6, point: 4});

        for (uint8 i = 0; i < 4; ++i) {
            session.bets.come[i] = Bet({amount: 500e6, oddsAmount: 1_500e6, point: 4});
        }

        session.bets.place4 = PlaceBet({amount: 500e6, working: true});
        session.bets.hard4 = HardwayBet({amount: 100e6});
        session.bets.oneRolls.field = 500e6;
    }

    function exposedAssertInvariant() external view {
        _assertInvariant();
    }
}
