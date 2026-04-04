// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICrapsGameV2} from "../interfaces/ICrapsGameV2.sol";
import {PayoutMathV2} from "./PayoutMathV2.sol";

library RollResolutionV2 {
    function resolveRoll(
        ICrapsGameV2.BetSlots memory bets,
        uint8 priorPoint,
        uint8 sum,
        uint8 die1,
        uint8 die2,
        uint16 layWinVigBps
    ) external pure returns (
        ICrapsGameV2.BetSlots memory updatedBets,
        uint256 returnedToAvailable,
        uint256 lostToBankroll,
        uint256 payout,
        uint8 nextPoint,
        uint8 nextPhase
    ) {
        updatedBets = bets;

        if (updatedBets.passLine.amount != 0) {
            if (priorPoint == 0) {
                if (sum == 7 || sum == 11) {
                    returnedToAvailable += updatedBets.passLine.amount;
                    payout += updatedBets.passLine.amount;
                    delete updatedBets.passLine;
                } else if (sum == 2 || sum == 3 || sum == 12) {
                    lostToBankroll += updatedBets.passLine.amount;
                    delete updatedBets.passLine;
                }
            } else if (sum == priorPoint) {
                returnedToAvailable += updatedBets.passLine.amount + updatedBets.passLine.oddsAmount;
                payout += updatedBets.passLine.amount;
                payout += _payoutAmount(updatedBets.passLine.oddsAmount, ICrapsGameV2.BetType.PASS_LINE_ODDS, priorPoint);
                delete updatedBets.passLine;
            } else if (sum == 7) {
                lostToBankroll += updatedBets.passLine.amount + updatedBets.passLine.oddsAmount;
                delete updatedBets.passLine;
            }
        }

        if (updatedBets.dontPass.amount != 0) {
            if (priorPoint == 0) {
                if (sum == 2 || sum == 3) {
                    returnedToAvailable += updatedBets.dontPass.amount;
                    payout += updatedBets.dontPass.amount;
                    delete updatedBets.dontPass;
                } else if (sum == 7 || sum == 11) {
                    lostToBankroll += updatedBets.dontPass.amount;
                    delete updatedBets.dontPass;
                }
            } else if (sum == 7) {
                returnedToAvailable += updatedBets.dontPass.amount + updatedBets.dontPass.oddsAmount;
                payout += updatedBets.dontPass.amount;
                payout += _payoutAmount(updatedBets.dontPass.oddsAmount, ICrapsGameV2.BetType.DONT_PASS_ODDS, priorPoint);
                delete updatedBets.dontPass;
            } else if (sum == priorPoint) {
                lostToBankroll += updatedBets.dontPass.amount + updatedBets.dontPass.oddsAmount;
                delete updatedBets.dontPass;
            }
        }

        for (uint8 i = 0; i < updatedBets.come.length; ++i) {
            ICrapsGameV2.Bet memory comeBet = updatedBets.come[i];
            if (comeBet.amount != 0) {
                if (comeBet.point == 0) {
                    if (sum == 7 || sum == 11) {
                        returnedToAvailable += comeBet.amount;
                        payout += comeBet.amount;
                        delete updatedBets.come[i];
                    } else if (sum == 2 || sum == 3 || sum == 12) {
                        lostToBankroll += comeBet.amount;
                        delete updatedBets.come[i];
                    } else {
                        comeBet.point = sum;
                        updatedBets.come[i] = comeBet;
                    }
                } else if (sum == comeBet.point) {
                    returnedToAvailable += comeBet.amount + comeBet.oddsAmount;
                    payout += comeBet.amount;
                    payout += _payoutAmount(comeBet.oddsAmount, ICrapsGameV2.BetType.COME_ODDS, comeBet.point);
                    delete updatedBets.come[i];
                } else if (sum == 7) {
                    lostToBankroll += comeBet.amount + comeBet.oddsAmount;
                    delete updatedBets.come[i];
                }
            }

            ICrapsGameV2.Bet memory dontComeBet = updatedBets.dontCome[i];
            if (dontComeBet.amount != 0) {
                if (dontComeBet.point == 0) {
                    if (sum == 2 || sum == 3) {
                        returnedToAvailable += dontComeBet.amount;
                        payout += dontComeBet.amount;
                        delete updatedBets.dontCome[i];
                    } else if (sum == 7 || sum == 11) {
                        lostToBankroll += dontComeBet.amount;
                        delete updatedBets.dontCome[i];
                    } else if (sum != 12) {
                        dontComeBet.point = sum;
                        updatedBets.dontCome[i] = dontComeBet;
                    }
                } else if (sum == 7) {
                    returnedToAvailable += dontComeBet.amount + dontComeBet.oddsAmount;
                    payout += dontComeBet.amount;
                    payout += _payoutAmount(dontComeBet.oddsAmount, ICrapsGameV2.BetType.DONT_COME_ODDS, dontComeBet.point);
                    delete updatedBets.dontCome[i];
                } else if (sum == dontComeBet.point) {
                    lostToBankroll += dontComeBet.amount + dontComeBet.oddsAmount;
                    delete updatedBets.dontCome[i];
                }
            }
        }

        for (uint8 i = 0; i < 6; ++i) {
            uint8 target = _boxNumberAt(i);
            ICrapsGameV2.BetType placeBetType = _placeBetTypeForNumber(target);
            uint256 wonPayout;
            uint256 lostAmount;
            (updatedBets, wonPayout, lostAmount) = _resolvePlaceForNumber(updatedBets, placeBetType, target, sum);
            payout += wonPayout;
            lostToBankroll += lostAmount;

            ICrapsGameV2.BetType layBetType = _layBetTypeForNumber(target);
            uint256 returnedAmount;
            (updatedBets, returnedAmount, wonPayout, lostAmount) = _resolveLayForNumber(
                updatedBets,
                layBetType,
                target,
                sum,
                layWinVigBps
            );
            returnedToAvailable += returnedAmount;
            payout += wonPayout;
            lostToBankroll += lostAmount;
        }

        uint256 returnedAmount;
        uint256 wonPayout;
        uint256 lostAmount;

        (updatedBets.hard4, returnedAmount, wonPayout, lostAmount) = _resolveHardwayBet(
            updatedBets.hard4,
            ICrapsGameV2.BetType.HARD_4,
            4,
            sum,
            die1,
            die2
        );
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (updatedBets.hard6, returnedAmount, wonPayout, lostAmount) = _resolveHardwayBet(
            updatedBets.hard6,
            ICrapsGameV2.BetType.HARD_6,
            6,
            sum,
            die1,
            die2
        );
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (updatedBets.hard8, returnedAmount, wonPayout, lostAmount) = _resolveHardwayBet(
            updatedBets.hard8,
            ICrapsGameV2.BetType.HARD_8,
            8,
            sum,
            die1,
            die2
        );
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (updatedBets.hard10, returnedAmount, wonPayout, lostAmount) = _resolveHardwayBet(
            updatedBets.hard10,
            ICrapsGameV2.BetType.HARD_10,
            10,
            sum,
            die1,
            die2
        );
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (returnedAmount, wonPayout, lostAmount) = _resolveFieldBet(updatedBets.oneRolls.field, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        updatedBets.oneRolls.field = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(updatedBets.oneRolls.any7, ICrapsGameV2.BetType.ANY_7, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        updatedBets.oneRolls.any7 = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(updatedBets.oneRolls.anyCraps, ICrapsGameV2.BetType.ANY_CRAPS, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        updatedBets.oneRolls.anyCraps = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(updatedBets.oneRolls.craps2, ICrapsGameV2.BetType.CRAPS_2, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        updatedBets.oneRolls.craps2 = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(updatedBets.oneRolls.craps3, ICrapsGameV2.BetType.CRAPS_3, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        updatedBets.oneRolls.craps3 = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(updatedBets.oneRolls.yo, ICrapsGameV2.BetType.YO, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        updatedBets.oneRolls.yo = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(updatedBets.oneRolls.twelve, ICrapsGameV2.BetType.TWELVE, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        updatedBets.oneRolls.twelve = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(updatedBets.oneRolls.horn, ICrapsGameV2.BetType.HORN, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        updatedBets.oneRolls.horn = 0;

        (updatedBets, nextPoint, nextPhase) = _advanceSessionAfterRoll(updatedBets, priorPoint, sum);
    }

    function _resolvePlaceForNumber(
        ICrapsGameV2.BetSlots memory bets,
        ICrapsGameV2.BetType betType,
        uint8 target,
        uint8 sum
    ) private pure returns (ICrapsGameV2.BetSlots memory updatedBets, uint256 wonPayout, uint256 lostAmount) {
        updatedBets = bets;
        ICrapsGameV2.PlaceBet memory bet = _placeBetAt(updatedBets, target);
        if (bet.amount == 0) {
            return (updatedBets, 0, 0);
        }
        if (sum == 7) {
            return (_setPlaceBet(updatedBets, target, ICrapsGameV2.PlaceBet({amount: 0, working: false})), 0, bet.amount);
        }
        if (sum == target && bet.working) {
            return (updatedBets, _payoutAmount(bet.amount, betType, target), 0);
        }
        return (updatedBets, 0, 0);
    }

    function _resolveLayForNumber(
        ICrapsGameV2.BetSlots memory bets,
        ICrapsGameV2.BetType betType,
        uint8 target,
        uint8 sum,
        uint16 layWinVigBps
    ) private pure returns (
        ICrapsGameV2.BetSlots memory updatedBets,
        uint256 returnedAmount,
        uint256 wonPayout,
        uint256 lostAmount
    ) {
        updatedBets = bets;
        ICrapsGameV2.PlaceBet memory bet = _layBetAt(updatedBets, target);
        if (bet.amount == 0) {
            return (updatedBets, 0, 0, 0);
        }
        if (sum == target) {
            return (_setLayBet(updatedBets, target, ICrapsGameV2.PlaceBet({amount: 0, working: false})), 0, 0, bet.amount);
        }
        if (sum == 7 && bet.working) {
            (, , uint256 netWin) = PayoutMathV2.layNetWinAmount(bet.amount, betType, target, layWinVigBps);
            return (_setLayBet(updatedBets, target, ICrapsGameV2.PlaceBet({amount: 0, working: false})), bet.amount, netWin, 0);
        }
        return (updatedBets, 0, 0, 0);
    }

    function _resolveHardwayBet(
        ICrapsGameV2.HardwayBet memory bet,
        ICrapsGameV2.BetType betType,
        uint8 target,
        uint8 sum,
        uint8 die1,
        uint8 die2
    ) private pure returns (
        ICrapsGameV2.HardwayBet memory updatedBet,
        uint256 returnedAmount,
        uint256 wonPayout,
        uint256 lostAmount
    ) {
        updatedBet = bet;
        uint256 amount = bet.amount;
        if (amount == 0) {
            return (updatedBet, 0, 0, 0);
        }
        if (sum == 7 || (sum == target && die1 != die2)) {
            updatedBet.amount = 0;
            return (updatedBet, 0, 0, amount);
        }
        if (sum == target && die1 == die2) {
            updatedBet.amount = 0;
            return (updatedBet, amount, _payoutAmount(amount, betType, target), 0);
        }
        return (updatedBet, 0, 0, 0);
    }

    function _resolveFieldBet(uint256 amount, uint8 sum)
        private
        pure
        returns (uint256 returnedAmount, uint256 wonPayout, uint256 lostAmount)
    {
        if (amount == 0) {
            return (0, 0, 0);
        }
        if (sum == 2 || sum == 12 || sum == 3 || sum == 4 || sum == 9 || sum == 10 || sum == 11) {
            return (amount, _payoutAmount(amount, ICrapsGameV2.BetType.FIELD, sum), 0);
        }
        return (0, 0, amount);
    }

    function _resolveOneRollBet(uint256 amount, ICrapsGameV2.BetType betType, uint8 sum)
        private
        pure
        returns (uint256 returnedAmount, uint256 wonPayout, uint256 lostAmount)
    {
        if (amount == 0) {
            return (0, 0, 0);
        }

        bool wins = false;
        if (betType == ICrapsGameV2.BetType.ANY_7) {
            wins = sum == 7;
        } else if (betType == ICrapsGameV2.BetType.ANY_CRAPS) {
            wins = sum == 2 || sum == 3 || sum == 12;
        } else if (betType == ICrapsGameV2.BetType.CRAPS_2) {
            wins = sum == 2;
        } else if (betType == ICrapsGameV2.BetType.CRAPS_3) {
            wins = sum == 3;
        } else if (betType == ICrapsGameV2.BetType.YO) {
            wins = sum == 11;
        } else if (betType == ICrapsGameV2.BetType.TWELVE) {
            wins = sum == 12;
        } else if (betType == ICrapsGameV2.BetType.HORN) {
            wins = sum == 2 || sum == 3 || sum == 11 || sum == 12;
        }

        if (wins) {
            return (amount, _payoutAmount(amount, betType, sum), 0);
        }
        return (0, 0, amount);
    }

    function _advanceSessionAfterRoll(
        ICrapsGameV2.BetSlots memory bets,
        uint8 priorPoint,
        uint8 sum
    ) private pure returns (
        ICrapsGameV2.BetSlots memory updatedBets,
        uint8 nextPoint,
        uint8 nextPhase
    ) {
        updatedBets = bets;

        if (priorPoint == 0) {
            if (_isPointNumber(sum)) {
                nextPoint = sum;
                nextPhase = uint8(ICrapsGameV2.SessionPhase.POINT);
                if (updatedBets.passLine.amount != 0) {
                    updatedBets.passLine.point = sum;
                }
                if (updatedBets.dontPass.amount != 0) {
                    updatedBets.dontPass.point = sum;
                }
                return (updatedBets, nextPoint, nextPhase);
            }

            return (updatedBets, 0, uint8(ICrapsGameV2.SessionPhase.COME_OUT));
        }

        if (sum == 7 || sum == priorPoint) {
            return (updatedBets, 0, uint8(ICrapsGameV2.SessionPhase.COME_OUT));
        }

        nextPoint = priorPoint;
        nextPhase = uint8(ICrapsGameV2.SessionPhase.POINT);
        if (updatedBets.passLine.amount != 0) {
            updatedBets.passLine.point = priorPoint;
        }
        if (updatedBets.dontPass.amount != 0) {
            updatedBets.dontPass.point = priorPoint;
        }
        return (updatedBets, nextPoint, nextPhase);
    }

    function _isPointNumber(uint8 sum) private pure returns (bool) {
        return sum == 4 || sum == 5 || sum == 6 || sum == 8 || sum == 9 || sum == 10;
    }

    function _payoutAmount(uint256 amount, ICrapsGameV2.BetType betType, uint8 point) private pure returns (uint256) {
        if (amount == 0) {
            return 0;
        }
        (uint256 numerator, uint256 denominator) = PayoutMathV2.payoutMultiplier(betType, point);
        if (numerator == 0 || denominator == 0) {
            return 0;
        }
        return (amount * numerator) / denominator;
    }

    function _boxNumberAt(uint8 index) private pure returns (uint8) {
        if (index == 0) return 4;
        if (index == 1) return 5;
        if (index == 2) return 6;
        if (index == 3) return 8;
        if (index == 4) return 9;
        return 10;
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

    function _setPlaceBet(
        ICrapsGameV2.BetSlots memory bets,
        uint8 target,
        ICrapsGameV2.PlaceBet memory bet
    ) private pure returns (ICrapsGameV2.BetSlots memory updatedBets) {
        updatedBets = bets;
        if (target == 4) updatedBets.place4 = bet;
        else if (target == 5) updatedBets.place5 = bet;
        else if (target == 6) updatedBets.place6 = bet;
        else if (target == 8) updatedBets.place8 = bet;
        else if (target == 9) updatedBets.place9 = bet;
        else updatedBets.place10 = bet;
    }

    function _setLayBet(
        ICrapsGameV2.BetSlots memory bets,
        uint8 target,
        ICrapsGameV2.PlaceBet memory bet
    ) private pure returns (ICrapsGameV2.BetSlots memory updatedBets) {
        updatedBets = bets;
        if (target == 4) updatedBets.lay4 = bet;
        else if (target == 5) updatedBets.lay5 = bet;
        else if (target == 6) updatedBets.lay6 = bet;
        else if (target == 8) updatedBets.lay8 = bet;
        else if (target == 9) updatedBets.lay9 = bet;
        else updatedBets.lay10 = bet;
    }
}
