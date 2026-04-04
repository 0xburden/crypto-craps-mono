// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICrapsGameV2} from "../interfaces/ICrapsGameV2.sol";

library PayoutMathV2 {
    struct DiceOutcome {
        uint8 sum;
        bool hardWay;
    }

    function payoutMultiplier(
        ICrapsGameV2.BetType betType,
        uint8 point
    ) internal pure returns (uint256 numerator, uint256 denominator) {
        denominator = 1;

        if (
            betType == ICrapsGameV2.BetType.PASS_LINE ||
            betType == ICrapsGameV2.BetType.DONT_PASS ||
            betType == ICrapsGameV2.BetType.COME ||
            betType == ICrapsGameV2.BetType.DONT_COME
        ) {
            return (1, 1);
        }

        if (
            betType == ICrapsGameV2.BetType.PASS_LINE_ODDS ||
            betType == ICrapsGameV2.BetType.COME_ODDS
        ) {
            if (point == 4 || point == 10) return (2, 1);
            if (point == 5 || point == 9) return (3, 2);
            if (point == 6 || point == 8) return (6, 5);
            return (0, 1);
        }

        if (
            betType == ICrapsGameV2.BetType.DONT_PASS_ODDS ||
            betType == ICrapsGameV2.BetType.DONT_COME_ODDS
        ) {
            if (point == 4 || point == 10) return (1, 2);
            if (point == 5 || point == 9) return (2, 3);
            if (point == 6 || point == 8) return (5, 6);
            return (0, 1);
        }

        if (betType == ICrapsGameV2.BetType.PLACE_4 || betType == ICrapsGameV2.BetType.PLACE_10) {
            return (9, 5);
        }
        if (betType == ICrapsGameV2.BetType.PLACE_5 || betType == ICrapsGameV2.BetType.PLACE_9) {
            return (7, 5);
        }
        if (betType == ICrapsGameV2.BetType.PLACE_6 || betType == ICrapsGameV2.BetType.PLACE_8) {
            return (7, 6);
        }

        if (betType == ICrapsGameV2.BetType.LAY_4 || betType == ICrapsGameV2.BetType.LAY_10) {
            return (1, 2);
        }
        if (betType == ICrapsGameV2.BetType.LAY_5 || betType == ICrapsGameV2.BetType.LAY_9) {
            return (2, 3);
        }
        if (betType == ICrapsGameV2.BetType.LAY_6 || betType == ICrapsGameV2.BetType.LAY_8) {
            return (5, 6);
        }

        if (betType == ICrapsGameV2.BetType.FIELD) {
            if (point == 2 || point == 12) return (2, 1);
            if (point == 3 || point == 4 || point == 9 || point == 10 || point == 11) {
                return (1, 1);
            }
            return (0, 1);
        }

        if (betType == ICrapsGameV2.BetType.HARD_4 || betType == ICrapsGameV2.BetType.HARD_10) {
            return (7, 1);
        }
        if (betType == ICrapsGameV2.BetType.HARD_6 || betType == ICrapsGameV2.BetType.HARD_8) {
            return (9, 1);
        }

        if (betType == ICrapsGameV2.BetType.ANY_7) return (4, 1);
        if (betType == ICrapsGameV2.BetType.ANY_CRAPS) return (7, 1);
        if (betType == ICrapsGameV2.BetType.CRAPS_2 || betType == ICrapsGameV2.BetType.TWELVE) {
            return (30, 1);
        }
        if (betType == ICrapsGameV2.BetType.CRAPS_3 || betType == ICrapsGameV2.BetType.YO) {
            return (15, 1);
        }
        if (betType == ICrapsGameV2.BetType.HORN) {
            if (point == 2 || point == 12) return (27, 4);
            if (point == 3 || point == 11) return (3, 1);
            return (0, 1);
        }

        return (0, 1);
    }

    function layNetWinAmount(
        uint256 stake,
        ICrapsGameV2.BetType betType,
        uint8 point,
        uint16 layWinVigBps
    ) internal pure returns (uint256 grossWin, uint256 vig, uint256 netWin) {
        if (stake == 0) {
            return (0, 0, 0);
        }

        (uint256 numerator, uint256 denominator) = payoutMultiplier(betType, point);
        if (numerator == 0 || denominator == 0) {
            return (0, 0, 0);
        }

        grossWin = (stake * numerator) / denominator;
        vig = (grossWin * layWinVigBps) / 10_000;
        netWin = grossWin - vig;
    }

    function maxPossiblePayout(
        ICrapsGameV2.BetSlots memory bets,
        uint8 point,
        uint16 layWinVigBps
    ) internal pure returns (uint256 maxPayout) {
        maxPayout = _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 2, hardWay: true}));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 3, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 4, hardWay: true})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 4, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 5, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 6, hardWay: true})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 6, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 7, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 8, hardWay: true})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 8, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 9, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 10, hardWay: true})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 10, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 11, hardWay: false})));
        maxPayout = _max(maxPayout, _payoutForOutcome(bets, point, layWinVigBps, DiceOutcome({sum: 12, hardWay: true})));
    }

    function _payoutForOutcome(
        ICrapsGameV2.BetSlots memory bets,
        uint8 point,
        uint16 layWinVigBps,
        DiceOutcome memory outcome
    ) private pure returns (uint256 totalPayout) {
        totalPayout += _linePayout(bets.passLine, ICrapsGameV2.BetType.PASS_LINE, point, outcome.sum);
        totalPayout += _lineOddsPayout(
            bets.passLine.oddsAmount,
            ICrapsGameV2.BetType.PASS_LINE_ODDS,
            point,
            outcome.sum
        );

        totalPayout += _linePayout(bets.dontPass, ICrapsGameV2.BetType.DONT_PASS, point, outcome.sum);
        totalPayout += _lineOddsPayout(
            bets.dontPass.oddsAmount,
            ICrapsGameV2.BetType.DONT_PASS_ODDS,
            point,
            outcome.sum
        );

        for (uint256 i = 0; i < bets.come.length; ++i) {
            totalPayout += _comePayout(bets.come[i], false, outcome.sum);
            totalPayout += _comePayout(bets.dontCome[i], true, outcome.sum);
        }

        for (uint8 i = 0; i < 6; ++i) {
            uint8 target = _boxNumberAt(i);
            ICrapsGameV2.BetType placeBetType = _placeBetTypeForNumber(target);
            totalPayout += _placePayout(_placeBetAt(bets, target), placeBetType, target, outcome.sum);

            ICrapsGameV2.BetType layBetType = _layBetTypeForNumber(target);
            totalPayout += _layPayout(_layBetAt(bets, target), layBetType, target, outcome.sum, layWinVigBps);
        }

        totalPayout += _hardwayPayout(bets.hard4.amount, ICrapsGameV2.BetType.HARD_4, 4, outcome);
        totalPayout += _hardwayPayout(bets.hard6.amount, ICrapsGameV2.BetType.HARD_6, 6, outcome);
        totalPayout += _hardwayPayout(bets.hard8.amount, ICrapsGameV2.BetType.HARD_8, 8, outcome);
        totalPayout += _hardwayPayout(bets.hard10.amount, ICrapsGameV2.BetType.HARD_10, 10, outcome);

        totalPayout += _oneRollPayout(bets.oneRolls.field, ICrapsGameV2.BetType.FIELD, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.any7, ICrapsGameV2.BetType.ANY_7, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.anyCraps, ICrapsGameV2.BetType.ANY_CRAPS, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.craps2, ICrapsGameV2.BetType.CRAPS_2, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.craps3, ICrapsGameV2.BetType.CRAPS_3, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.yo, ICrapsGameV2.BetType.YO, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.twelve, ICrapsGameV2.BetType.TWELVE, outcome.sum);
        totalPayout += _oneRollPayout(bets.oneRolls.horn, ICrapsGameV2.BetType.HORN, outcome.sum);
    }

    function _layPayout(
        ICrapsGameV2.PlaceBet memory bet,
        ICrapsGameV2.BetType betType,
        uint8 target,
        uint8 sum,
        uint16 layWinVigBps
    ) private pure returns (uint256) {
        if (bet.amount == 0) return 0;
        if (sum != 7 || !bet.working) return 0;
        (,, uint256 netWin) = layNetWinAmount(bet.amount, betType, target, layWinVigBps);
        return netWin;
    }

    function _boxNumberAt(uint8 index) private pure returns (uint8) {
        if (index == 0) return 4;
        if (index == 1) return 5;
        if (index == 2) return 6;
        if (index == 3) return 8;
        if (index == 4) return 9;
        if (index == 5) return 10;
        return 0;
    }

    function _placeBetTypeForNumber(uint8 target) private pure returns (ICrapsGameV2.BetType) {
        if (target == 4) return ICrapsGameV2.BetType.PLACE_4;
        if (target == 5) return ICrapsGameV2.BetType.PLACE_5;
        if (target == 6) return ICrapsGameV2.BetType.PLACE_6;
        if (target == 8) return ICrapsGameV2.BetType.PLACE_8;
        if (target == 9) return ICrapsGameV2.BetType.PLACE_9;
        return ICrapsGameV2.BetType.PLACE_10;
    }

    function _layBetTypeForNumber(uint8 target) private pure returns (ICrapsGameV2.BetType) {
        if (target == 4) return ICrapsGameV2.BetType.LAY_4;
        if (target == 5) return ICrapsGameV2.BetType.LAY_5;
        if (target == 6) return ICrapsGameV2.BetType.LAY_6;
        if (target == 8) return ICrapsGameV2.BetType.LAY_8;
        if (target == 9) return ICrapsGameV2.BetType.LAY_9;
        return ICrapsGameV2.BetType.LAY_10;
    }

    function _placeBetAt(ICrapsGameV2.BetSlots memory bets, uint8 target)
        private
        pure
        returns (ICrapsGameV2.PlaceBet memory)
    {
        if (target == 4) return bets.place4;
        if (target == 5) return bets.place5;
        if (target == 6) return bets.place6;
        if (target == 8) return bets.place8;
        if (target == 9) return bets.place9;
        return bets.place10;
    }

    function _layBetAt(ICrapsGameV2.BetSlots memory bets, uint8 target)
        private
        pure
        returns (ICrapsGameV2.PlaceBet memory)
    {
        if (target == 4) return bets.lay4;
        if (target == 5) return bets.lay5;
        if (target == 6) return bets.lay6;
        if (target == 8) return bets.lay8;
        if (target == 9) return bets.lay9;
        return bets.lay10;
    }

    function _linePayout(
        ICrapsGameV2.Bet memory bet,
        ICrapsGameV2.BetType betType,
        uint8 point,
        uint8 sum
    ) private pure returns (uint256) {
        if (bet.amount == 0) return 0;

        if (betType == ICrapsGameV2.BetType.PASS_LINE) {
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
        ICrapsGameV2.BetType betType,
        uint8 point,
        uint8 sum
    ) private pure returns (uint256) {
        if (amount == 0 || point == 0) return 0;

        if (
            (betType == ICrapsGameV2.BetType.PASS_LINE_ODDS && sum == point) ||
            (betType == ICrapsGameV2.BetType.DONT_PASS_ODDS && sum == 7)
        ) {
            return _applyMultiplier(amount, betType, point);
        }

        return 0;
    }

    function _comePayout(
        ICrapsGameV2.Bet memory bet,
        bool isDontCome,
        uint8 sum
    ) private pure returns (uint256) {
        if (bet.amount == 0) return 0;

        if (bet.point == 0) {
            if (!isDontCome) {
                if (sum == 7 || sum == 11) {
                    return _applyMultiplier(bet.amount, ICrapsGameV2.BetType.COME, 0);
                }
                return 0;
            }

            if (sum == 2 || sum == 3) {
                return _applyMultiplier(bet.amount, ICrapsGameV2.BetType.DONT_COME, 0);
            }
            return 0;
        }

        if (!isDontCome) {
            if (sum == bet.point) {
                return _applyMultiplier(bet.amount, ICrapsGameV2.BetType.COME, 0) +
                    _applyMultiplier(bet.oddsAmount, ICrapsGameV2.BetType.COME_ODDS, bet.point);
            }
            return 0;
        }

        if (sum == 7) {
            return _applyMultiplier(bet.amount, ICrapsGameV2.BetType.DONT_COME, 0) +
                _applyMultiplier(bet.oddsAmount, ICrapsGameV2.BetType.DONT_COME_ODDS, bet.point);
        }

        return 0;
    }

    function _placePayout(
        ICrapsGameV2.PlaceBet memory bet,
        ICrapsGameV2.BetType betType,
        uint8 target,
        uint8 sum
    ) private pure returns (uint256) {
        if (bet.amount == 0 || !bet.working || sum != target) return 0;
        return _applyMultiplier(bet.amount, betType, target);
    }

    function _hardwayPayout(
        uint256 amount,
        ICrapsGameV2.BetType betType,
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
        ICrapsGameV2.BetType betType,
        uint8 sum
    ) private pure returns (uint256) {
        if (amount == 0) return 0;
        return _applyMultiplier(amount, betType, sum);
    }

    function _applyMultiplier(
        uint256 amount,
        ICrapsGameV2.BetType betType,
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
