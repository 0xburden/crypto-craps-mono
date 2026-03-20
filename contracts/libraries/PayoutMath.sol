// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICrapsGame} from "../interfaces/ICrapsGame.sol";

library PayoutMath {
    struct DiceOutcome {
        uint8 sum;
        bool hardWay;
    }

    function payoutMultiplier(
        ICrapsGame.BetType betType,
        uint8 point
    ) internal pure returns (uint256 numerator, uint256 denominator) {
        denominator = 1;

        if (
            betType == ICrapsGame.BetType.PASS_LINE ||
            betType == ICrapsGame.BetType.DONT_PASS ||
            betType == ICrapsGame.BetType.COME ||
            betType == ICrapsGame.BetType.DONT_COME
        ) {
            return (1, 1);
        }

        if (
            betType == ICrapsGame.BetType.PASS_LINE_ODDS ||
            betType == ICrapsGame.BetType.COME_ODDS
        ) {
            if (point == 4 || point == 10) return (2, 1);
            if (point == 5 || point == 9) return (3, 2);
            if (point == 6 || point == 8) return (6, 5);
            return (0, 1);
        }

        if (
            betType == ICrapsGame.BetType.DONT_PASS_ODDS ||
            betType == ICrapsGame.BetType.DONT_COME_ODDS
        ) {
            if (point == 4 || point == 10) return (1, 2);
            if (point == 5 || point == 9) return (2, 3);
            if (point == 6 || point == 8) return (5, 6);
            return (0, 1);
        }

        if (betType == ICrapsGame.BetType.PLACE_4 || betType == ICrapsGame.BetType.PLACE_10) {
            return (9, 5);
        }
        if (betType == ICrapsGame.BetType.PLACE_5 || betType == ICrapsGame.BetType.PLACE_9) {
            return (7, 5);
        }
        if (betType == ICrapsGame.BetType.PLACE_6 || betType == ICrapsGame.BetType.PLACE_8) {
            return (7, 6);
        }

        if (betType == ICrapsGame.BetType.FIELD) {
            if (point == 2 || point == 12) return (2, 1);
            if (point == 3 || point == 4 || point == 9 || point == 10 || point == 11) {
                return (1, 1);
            }
            return (0, 1);
        }

        if (betType == ICrapsGame.BetType.HARD_4 || betType == ICrapsGame.BetType.HARD_10) {
            return (7, 1);
        }
        if (betType == ICrapsGame.BetType.HARD_6 || betType == ICrapsGame.BetType.HARD_8) {
            return (9, 1);
        }

        if (betType == ICrapsGame.BetType.ANY_7) return (4, 1);
        if (betType == ICrapsGame.BetType.ANY_CRAPS) return (7, 1);
        if (betType == ICrapsGame.BetType.CRAPS_2 || betType == ICrapsGame.BetType.TWELVE) {
            return (30, 1);
        }
        if (betType == ICrapsGame.BetType.CRAPS_3 || betType == ICrapsGame.BetType.YO) {
            return (15, 1);
        }
        if (betType == ICrapsGame.BetType.HORN) {
            if (point == 2 || point == 12) return (27, 4);
            if (point == 3 || point == 11) return (3, 1);
            return (0, 1);
        }

        return (0, 1);
    }

    function maxPossiblePayout(
        ICrapsGame.BetSlots memory bets,
        uint8 point
    ) internal pure returns (uint256 maxPayout) {
        maxPayout = _payoutForOutcome(bets, point, DiceOutcome({sum: 2, hardWay: true}));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 3, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 4, hardWay: true})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 4, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 5, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 6, hardWay: true})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 6, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 7, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 8, hardWay: true})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 8, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 9, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 10, hardWay: true})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 10, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 11, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, DiceOutcome({sum: 12, hardWay: true})));
    }

    function _payoutForOutcome(
        ICrapsGame.BetSlots memory bets,
        uint8 point,
        DiceOutcome memory outcome
    ) private pure returns (uint256 totalPayout) {
        totalPayout += _linePayout(bets.passLine, ICrapsGame.BetType.PASS_LINE, point, outcome.sum);
        totalPayout += _lineOddsPayout(
            bets.passLine.oddsAmount,
            ICrapsGame.BetType.PASS_LINE_ODDS,
            point,
            outcome.sum
        );

        totalPayout += _linePayout(bets.dontPass, ICrapsGame.BetType.DONT_PASS, point, outcome.sum);
        totalPayout += _lineOddsPayout(
            bets.dontPass.oddsAmount,
            ICrapsGame.BetType.DONT_PASS_ODDS,
            point,
            outcome.sum
        );

        for (uint256 i = 0; i < bets.come.length; ++i) {
            totalPayout += _comePayout(bets.come[i], false, outcome.sum);
            totalPayout += _comePayout(bets.dontCome[i], true, outcome.sum);
        }

        totalPayout += _placePayout(bets.place4, ICrapsGame.BetType.PLACE_4, 4, outcome.sum);
        totalPayout += _placePayout(bets.place5, ICrapsGame.BetType.PLACE_5, 5, outcome.sum);
        totalPayout += _placePayout(bets.place6, ICrapsGame.BetType.PLACE_6, 6, outcome.sum);
        totalPayout += _placePayout(bets.place8, ICrapsGame.BetType.PLACE_8, 8, outcome.sum);
        totalPayout += _placePayout(bets.place9, ICrapsGame.BetType.PLACE_9, 9, outcome.sum);
        totalPayout += _placePayout(bets.place10, ICrapsGame.BetType.PLACE_10, 10, outcome.sum);

        totalPayout += _hardwayPayout(bets.hard4.amount, ICrapsGame.BetType.HARD_4, 4, outcome);
        totalPayout += _hardwayPayout(bets.hard6.amount, ICrapsGame.BetType.HARD_6, 6, outcome);
        totalPayout += _hardwayPayout(bets.hard8.amount, ICrapsGame.BetType.HARD_8, 8, outcome);
        totalPayout += _hardwayPayout(bets.hard10.amount, ICrapsGame.BetType.HARD_10, 10, outcome);

        totalPayout += _oneRollPayout(bets.oneRolls.field, ICrapsGame.BetType.FIELD, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.any7, ICrapsGame.BetType.ANY_7, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.anyCraps, ICrapsGame.BetType.ANY_CRAPS, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.craps2, ICrapsGame.BetType.CRAPS_2, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.craps3, ICrapsGame.BetType.CRAPS_3, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.yo, ICrapsGame.BetType.YO, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.twelve, ICrapsGame.BetType.TWELVE, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.horn, ICrapsGame.BetType.HORN, outcome.sum);
    }

    function _linePayout(
        ICrapsGame.Bet memory bet,
        ICrapsGame.BetType betType,
        uint8 point,
        uint8 sum
    ) private pure returns (uint256) {
        if (bet.amount == 0) return 0;

        if (betType == ICrapsGame.BetType.PASS_LINE) {
            if ((point == 0 && (sum == 7 || sum == 11)) || (point != 0 && sum == point)) {
                return _applyMultiplier(bet.amount, betType, 0);
            }
            return 0;
        }

        if (point == 0) {
            if (sum == 2 || sum == 3) return _applyMultiplier(bet.amount, betType, 0);
            return 0;
        }

        if (sum == 7) return _applyMultiplier(bet.amount, betType, 0);
        return 0;
    }

    function _lineOddsPayout(
        uint256 amount,
        ICrapsGame.BetType betType,
        uint8 point,
        uint8 sum
    ) private pure returns (uint256) {
        if (amount == 0 || point == 0) return 0;

        if (
            (betType == ICrapsGame.BetType.PASS_LINE_ODDS && sum == point) ||
            (betType == ICrapsGame.BetType.DONT_PASS_ODDS && sum == 7)
        ) {
            return _applyMultiplier(amount, betType, point);
        }

        return 0;
    }

    function _comePayout(
        ICrapsGame.Bet memory bet,
        bool isDontCome,
        uint8 sum
    ) private pure returns (uint256) {
        if (bet.amount == 0) return 0;

        if (bet.point == 0) {
            if (!isDontCome) {
                if (sum == 7 || sum == 11) {
                    return _applyMultiplier(bet.amount, ICrapsGame.BetType.COME, 0);
                }
                return 0;
            }

            if (sum == 2 || sum == 3) {
                return _applyMultiplier(bet.amount, ICrapsGame.BetType.DONT_COME, 0);
            }
            return 0;
        }

        if (!isDontCome) {
            if (sum == bet.point) {
                return _applyMultiplier(bet.amount, ICrapsGame.BetType.COME, 0) +
                    _applyMultiplier(bet.oddsAmount, ICrapsGame.BetType.COME_ODDS, bet.point);
            }
            return 0;
        }

        if (sum == 7) {
            return _applyMultiplier(bet.amount, ICrapsGame.BetType.DONT_COME, 0) +
                _applyMultiplier(bet.oddsAmount, ICrapsGame.BetType.DONT_COME_ODDS, bet.point);
        }

        return 0;
    }

    function _placePayout(
        ICrapsGame.PlaceBet memory bet,
        ICrapsGame.BetType betType,
        uint8 target,
        uint8 sum
    ) private pure returns (uint256) {
        if (bet.amount == 0 || !bet.working || sum != target) return 0;
        return _applyMultiplier(bet.amount, betType, target);
    }

    function _hardwayPayout(
        uint256 amount,
        ICrapsGame.BetType betType,
        uint8 target,
        DiceOutcome memory outcome
    ) private pure returns (uint256) {
        if (amount == 0) return 0;
        if (outcome.sum == target && outcome.hardWay) {
            return _applyMultiplier(amount, betType, target);
        }
        return 0;
    }

    function _oneRollPayout(
        uint256 amount,
        ICrapsGame.BetType betType,
        uint8 sum
    ) private pure returns (uint256) {
        if (amount == 0) return 0;
        return _applyMultiplier(amount, betType, sum);
    }

    function _applyMultiplier(
        uint256 amount,
        ICrapsGame.BetType betType,
        uint8 point
    ) private pure returns (uint256) {
        if (amount == 0) return 0;
        (uint256 numerator, uint256 denominator) = payoutMultiplier(betType, point);
        return (amount * numerator) / denominator;
    }

    function _max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }
}
