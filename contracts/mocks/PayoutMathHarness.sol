// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICrapsGame} from "../interfaces/ICrapsGame.sol";
import {PayoutMath} from "../libraries/PayoutMath.sol";

contract PayoutMathHarness {
    function payoutMultiplier(
        ICrapsGame.BetType betType,
        uint8 point
    ) external pure returns (uint256 numerator, uint256 denominator) {
        return PayoutMath.payoutMultiplier(betType, point);
    }

    function maxPossiblePayout(
        ICrapsGame.BetSlots calldata bets,
        uint8 point
    ) external pure returns (uint256) {
        ICrapsGame.BetSlots memory copiedBets = bets;
        return PayoutMath.maxPossiblePayout(copiedBets, point);
    }
}
