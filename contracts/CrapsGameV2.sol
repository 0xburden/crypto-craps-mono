// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICrapsGameV2} from "./interfaces/ICrapsGameV2.sol";
import {PayoutMathV2} from "./libraries/PayoutMathV2.sol";
import {RollResolutionV2} from "./libraries/RollResolutionV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract CrapsGameV2 is ICrapsGameV2, VRFConsumerBaseV2Plus, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 internal constant DEPOSIT_FEE_BPS = 50;
    uint256 internal constant MIN_BANKROLL = 10_000e6;
    uint256 internal constant INITIAL_BANKROLL = 50_000e6;

    uint32 internal constant CALLBACK_GAS_LIMIT = 500_000;
    uint16 internal constant REQUEST_CONFIRMATIONS = 3;
    uint32 internal constant NUM_WORDS = 1;
    uint256 internal constant SESSION_TIMEOUT = 24 hours;
    uint256 internal constant VRF_TIMEOUT_BLOCKS = 100;
    uint256 internal constant SELF_EXCLUSION_DELAY = 7 days;

    uint256 internal constant MIN_LINE_BET = 1e6;
    uint256 internal constant MAX_LINE_BET = 500e6;
    uint256 internal constant MAX_ODDS_MULTIPLIER = 3;
    uint256 internal constant MIN_FIELD_BET = 1e6;
    uint256 internal constant MAX_FIELD_BET = 500e6;
    uint256 internal constant MIN_PLACE_BET = 5e6;
    uint256 internal constant MIN_PLACE_6_8_BET = 6e6;
    uint256 internal constant MAX_PLACE_BET = 500e6;
    uint256 internal constant MIN_PROP_BET = 1e6;
    uint256 internal constant MAX_PROP_BET = 100e6;
    uint256 internal constant MIN_HARDWAY_BET = 1e6;
    uint256 internal constant MAX_HARDWAY_BET = 100e6;
    uint256 internal constant MIN_HORN_BET = 4e6;
    uint16 internal constant LAY_WIN_VIG_BPS = 500;
    uint256 internal constant MIN_LAY_4_10_BET = 2e6;
    uint256 internal constant MIN_LAY_5_9_BET = 3e6;
    uint256 internal constant MIN_LAY_6_8_BET = 6e6;
    uint256 internal constant MAX_LAY_BET = 500e6;
    uint256 internal constant MAX_TURN_ACTIONS = 32;

    IERC20 private immutable i_token;
    uint256 internal immutable vrfSubscriptionId;
    bytes32 internal immutable vrfKeyHash;

    struct SessionData {
        SessionPhase phase;
        uint8 point;
        uint48 lastActivityTime;
        uint256 pendingRequestId;
        BetSlots bets;
    }

    mapping(address player => uint256 amount) internal _available;
    mapping(address player => uint256 amount) internal _inPlay;
    mapping(address player => uint256 amount) internal _reserved;
    mapping(address player => SessionData session) internal _sessions;

    mapping(uint256 requestId => address player) internal requestToPlayer;
    mapping(address player => bool excluded) internal selfExcluded;
    mapping(address player => bool excluded) internal operatorExcluded;
    mapping(address player => uint256 eligibleAt) internal reinstatementEligibleAt;

    uint256 internal totalAvailable;
    uint256 internal totalInPlay;
    uint256 internal totalReserved;
    uint256 internal bankroll;
    uint256 internal accruedFees;
    uint256 internal pendingVRFRequests;
    uint256 internal activeSessions;

    modifier notExcluded() {
        if (_isExcluded(msg.sender)) revert PlayerExcluded(msg.sender);
        _;
    }

    constructor(
        address token_,
        address vrfCoordinator_,
        uint256 vrfSubscriptionId_,
        bytes32 vrfKeyHash_
    ) VRFConsumerBaseV2Plus(vrfCoordinator_) {
        if (token_ == address(0)) revert InvalidAmount(0);

        i_token = IERC20(token_);
        vrfSubscriptionId = vrfSubscriptionId_;
        vrfKeyHash = vrfKeyHash_;
    }

    function token() external view override returns (address) {
        return address(i_token);
    }

    function deposit(uint256 amount) external override whenNotPaused notExcluded nonReentrant {
        if (amount == 0) revert ZeroAmount();
        i_token.safeTransferFrom(msg.sender, address(this), amount);

        uint256 fee = (amount * DEPOSIT_FEE_BPS) / 10_000;
        uint256 creditedAmount = amount - fee;

        _available[msg.sender] += creditedAmount;
        totalAvailable += creditedAmount;
        accruedFees += fee;

        emit Deposit(msg.sender, amount, fee);
    }

    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 availableBalance = _available[msg.sender];
        if (amount > availableBalance) {
            revert InsufficientBalance(availableBalance, amount);
        }

        unchecked {
            _available[msg.sender] = availableBalance - amount;
            totalAvailable -= amount;
        }

        i_token.safeTransfer(msg.sender, amount);

        emit Withdrawal(msg.sender, amount);
    }

    function withdrawFees(address to) external override onlyOwner nonReentrant {
        uint256 amount = accruedFees;
        if (amount == 0) revert ZeroAmount();

        accruedFees = 0;
        i_token.safeTransfer(to, amount);

        emit FeesWithdrawn(to, amount);
    }

    function fundBankroll(uint256 amount) external override onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        i_token.safeTransferFrom(msg.sender, address(this), amount);
        bankroll += amount;

        emit BankrollFunded(msg.sender, amount);
    }

    function withdrawBankroll(uint256 amount) external override onlyOwner whenPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (pendingVRFRequests != 0) revert PendingVRFRequestsOutstanding(pendingVRFRequests);
        if (amount > bankroll) revert InsufficientBankroll(bankroll, amount);

        unchecked {
            bankroll -= amount;
        }

        i_token.safeTransfer(msg.sender, amount);

        emit BankrollWithdrawn(msg.sender, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function closeSession() external override nonReentrant {

        SessionData storage session = _sessions[msg.sender];
        if (session.phase == SessionPhase.INACTIVE) revert SessionNotActive();
        if (session.phase == SessionPhase.ROLL_PENDING) revert SessionRollPending();

        uint256 returnedAmount = _inPlay[msg.sender];
        if (returnedAmount != 0) {
            _creditAvailable(msg.sender, returnedAmount);
        }

        delete session.bets;
        session.phase = SessionPhase.INACTIVE;
        session.point = 0;
        session.lastActivityTime = 0;
        session.pendingRequestId = 0;

        if (activeSessions != 0) {
            activeSessions -= 1;
        }

        emit SessionClosed(msg.sender, returnedAmount);
    }

    function expireSession(address player) external override nonReentrant {
        SessionData storage session = _sessions[player];
        if (session.phase == SessionPhase.INACTIVE) revert SessionNotActive();
        if (!_isSessionExpired(session)) revert SessionNotActive();

        _expireSession(player);
    }

    function selfExclude() external override nonReentrant {

        selfExcluded[msg.sender] = true;
        reinstatementEligibleAt[msg.sender] = 0;
        _expireSession(msg.sender);

        emit SelfExcluded(msg.sender);
    }

    function requestSelfReinstatement() external override {
        if (!selfExcluded[msg.sender]) revert NotEligibleForReinstatement(0);

        uint256 eligibleAt = block.timestamp + SELF_EXCLUSION_DELAY;
        reinstatementEligibleAt[msg.sender] = eligibleAt;

        emit SelfReinstatementRequested(msg.sender, eligibleAt);
    }

    function completeSelfReinstatement() external override {
        if (!selfExcluded[msg.sender]) revert NotEligibleForReinstatement(0);

        uint256 eligibleAt = reinstatementEligibleAt[msg.sender];
        if (eligibleAt < 1) revert NotEligibleForReinstatement(0);
        if (block.timestamp < eligibleAt) revert NotEligibleForReinstatement(eligibleAt);

        selfExcluded[msg.sender] = false;
        reinstatementEligibleAt[msg.sender] = 0;

        emit SelfReinstated(msg.sender);
    }

    function operatorExclude(address player) external override onlyOwner nonReentrant {

        operatorExcluded[player] = true;
        _expireSession(player);

        emit OperatorExcluded(player);
    }

    function operatorReinstate(address player) external override onlyOwner {
        operatorExcluded[player] = false;

        emit OperatorReinstated(player);
    }

    function executeTurn(TurnAction[] calldata actions, bool rollAfter)
        external
        override
        whenNotPaused
        notExcluded
        nonReentrant
        returns (uint256 requestId)
    {
        if (actions.length == 0 && !rollAfter) revert EmptyTurn();
        if (actions.length > MAX_TURN_ACTIONS) revert TooManyTurnActions(actions.length, MAX_TURN_ACTIONS);

        address player = msg.sender;

        for (uint256 i = 0; i < actions.length; ++i) {
            TurnAction calldata action = actions[i];
            if (action.kind == ActionKind.PLACE_BET) {
                _applyPlaceBet(player, action.betType, action.amount);
            } else if (action.kind == ActionKind.PLACE_INDEXED_BET) {
                _applyPlaceIndexedBet(player, action.betType, action.index, action.amount);
            } else if (action.kind == ActionKind.REMOVE_BET) {
                _applyRemoveBet(player, action.betType);
            } else if (action.kind == ActionKind.REMOVE_INDEXED_BET) {
                _applyRemoveIndexedBet(player, action.betType, action.index);
            } else if (action.kind == ActionKind.SET_BOX_WORKING) {
                _applySetBoxWorking(player, action.betType, action.working);
            } else {
                revert();
            }
        }

        if (rollAfter) {
            requestId = _startRoll(player);
        }

        emit TurnExecuted(player, actions.length, rollAfter, requestId);
    }

    function _startRoll(address player) internal returns (uint256 requestId) {
        SessionData storage session = _sessions[player];
        _requireSessionReady(session);

        if (_inPlay[player] == 0) revert InvalidAmount(0);

        BetSlots memory activeBets = session.bets;
        uint256 worstCase = PayoutMathV2.maxPossiblePayout(activeBets, session.point, LAY_WIN_VIG_BPS);
        if (worstCase > bankroll) revert InsufficientBankroll(bankroll, worstCase);

        if (worstCase != 0) {
            _reserveFromBankroll(player, worstCase);
        }

        session.phase = SessionPhase.ROLL_PENDING;
        pendingVRFRequests += 1;

        VRFV2PlusClient.RandomWordsRequest memory request = VRFV2PlusClient.RandomWordsRequest({
            keyHash: vrfKeyHash,
            subId: vrfSubscriptionId,
            requestConfirmations: REQUEST_CONFIRMATIONS,
            callbackGasLimit: CALLBACK_GAS_LIMIT,
            numWords: NUM_WORDS,
            extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: false}))
        });

        // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
        requestId = s_vrfCoordinator.requestRandomWords(request);
        requestToPlayer[requestId] = player;
        session.pendingRequestId = requestId;

        emit RollRequested(player, requestId, worstCase);
    }

    function _applyPlaceBet(address player, BetType betType, uint256 amount) internal {
        SessionData storage session = _sessions[player];
        if (session.phase == SessionPhase.INACTIVE) {
            delete session.bets;
            session.phase = SessionPhase.COME_OUT;
            session.point = 0;
            session.lastActivityTime = uint48(block.timestamp);
            session.pendingRequestId = 0;
            activeSessions += 1;
            emit SessionOpened(player);
        }
        _requireSessionReady(session);

        PuckState puckState = _puckState(session.point);

        if (betType == BetType.PASS_LINE) {
            _placeLineBetForPlayer(player, session.bets.passLine, betType, puckState, amount);
            return;
        }

        if (betType == BetType.DONT_PASS) {
            _placeLineBetForPlayer(player, session.bets.dontPass, betType, puckState, amount);
            return;
        }

        if (betType == BetType.PASS_LINE_ODDS) {
            _placeOddsBetForPlayer(player, session.bets.passLine, BetType.PASS_LINE, betType, puckState, session.point, amount);
            return;
        }

        if (betType == BetType.DONT_PASS_ODDS) {
            _placeOddsBetForPlayer(player, session.bets.dontPass, BetType.DONT_PASS, betType, puckState, session.point, amount);
            return;
        }

        if (betType == BetType.COME) {
            _placeComeTravelBetForPlayer(player, session.bets.come, betType, puckState, amount);
            return;
        }

        if (betType == BetType.DONT_COME) {
            _placeComeTravelBetForPlayer(player, session.bets.dontCome, betType, puckState, amount);
            return;
        }

        if (_isPlaceBetType(betType)) {
            if (puckState != PuckState.ON) revert BetUnavailable(betType, puckState);
            PlaceBet storage placeSlot = _placeBetStorage(session.bets, betType);
            uint256 newTotal = placeSlot.amount + amount;
            _validatePlaceAmount(newTotal, betType);
            _debitAvailable(player, amount);
            placeSlot.amount = newTotal;
            if (placeSlot.amount == amount) {
                placeSlot.working = true;
            }
            emit BetPlaced(player, betType, amount);
            return;
        }

        if (_isLayBetType(betType)) {
            if (puckState != PuckState.ON) revert BetUnavailable(betType, puckState);
            PlaceBet storage laySlot = _layBetStorage(session.bets, betType);
            uint256 newTotal = laySlot.amount + amount;
            _validateLayAmount(newTotal, betType);
            _debitAvailable(player, amount);
            laySlot.amount = newTotal;
            if (laySlot.amount == amount) {
                laySlot.working = true;
            }
            emit BetPlaced(player, betType, amount);
            return;
        }

        if (betType == BetType.FIELD) {
            uint256 newTotal = session.bets.oneRolls.field + amount;
            _validateSingleBetAmount(newTotal, MIN_FIELD_BET, MAX_FIELD_BET, 1);
            _debitAvailable(player, amount);
            session.bets.oneRolls.field = newTotal;
            emit BetPlaced(player, betType, amount);
            return;
        }

        if (
            betType == BetType.HARD_4 ||
            betType == BetType.HARD_6 ||
            betType == BetType.HARD_8 ||
            betType == BetType.HARD_10
        ) {
            HardwayBet storage hardwayBet = _hardwayBetStorage(session.bets, betType);
            uint256 newTotal = hardwayBet.amount + amount;
            _validateSingleBetAmount(newTotal, MIN_HARDWAY_BET, MAX_HARDWAY_BET, 1);
            _debitAvailable(player, amount);
            hardwayBet.amount = newTotal;
            emit BetPlaced(player, betType, amount);
            return;
        }

        if (
            betType == BetType.ANY_7 ||
            betType == BetType.ANY_CRAPS ||
            betType == BetType.CRAPS_2 ||
            betType == BetType.CRAPS_3 ||
            betType == BetType.YO ||
            betType == BetType.TWELVE ||
            betType == BetType.HORN
        ) {
            uint256 minAmount = betType == BetType.HORN ? MIN_HORN_BET : MIN_PROP_BET;
            uint256 multiple = betType == BetType.HORN ? 4 : 1;
            uint256 newTotal = _oneRollBetAmount(session.bets.oneRolls, betType) + amount;
            _validateSingleBetAmount(newTotal, minAmount, MAX_PROP_BET, multiple);
            _debitAvailable(player, amount);
            _setOneRollBetAmount(session.bets.oneRolls, betType, newTotal);
            emit BetPlaced(player, betType, amount);
            return;
        }

        revert InvalidBetType(betType);
    }

    function _applyPlaceIndexedBet(address player, BetType betType, uint8 index, uint256 amount) internal {
        SessionData storage session = _sessions[player];
        _requireSessionReady(session);
        if (session.point == 0) revert BetUnavailable(betType, PuckState.OFF);
        if (index >= 4) revert InvalidIndex(index);

        if (betType == BetType.COME_ODDS) {
            Bet storage comeBet = session.bets.come[index];
            if (comeBet.amount == 0 || comeBet.point == 0) revert NoActiveBet(BetType.COME);
            _placeOddsBetForPlayer(player, comeBet, BetType.COME, betType, PuckState.ON, comeBet.point, amount);
            return;
        }

        if (betType == BetType.DONT_COME_ODDS) {
            Bet storage dontComeBet = session.bets.dontCome[index];
            if (dontComeBet.amount == 0 || dontComeBet.point == 0) revert NoActiveBet(BetType.DONT_COME);
            _placeOddsBetForPlayer(player, dontComeBet, BetType.DONT_COME, betType, PuckState.ON, dontComeBet.point, amount);
            return;
        }

        revert InvalidBetType(betType);
    }

    function _applyRemoveBet(address player, BetType betType) internal {
        SessionData storage session = _sessions[player];
        _requireSessionReady(session);

        if (betType == BetType.DONT_PASS) {
            _removeLineBetWithOddsForPlayer(player, session.bets.dontPass, BetType.DONT_PASS);
            return;
        }
        if (betType == BetType.PASS_LINE_ODDS) {
            _removeOddsBetForPlayer(player, session.bets.passLine, BetType.PASS_LINE_ODDS);
            return;
        }
        if (betType == BetType.DONT_PASS_ODDS) {
            _removeOddsBetForPlayer(player, session.bets.dontPass, BetType.DONT_PASS_ODDS);
            return;
        }
        if (betType == BetType.FIELD) {
            _removeOneRollBetForPlayer(player, session.bets.oneRolls, betType);
            return;
        }
        if (_isPlaceBetType(betType)) {
            _removePlaceBetForPlayer(player, _placeBetStorage(session.bets, betType), betType);
            return;
        }
        if (_isLayBetType(betType)) {
            _removePlaceBetForPlayer(player, _layBetStorage(session.bets, betType), betType);
            return;
        }
        if (
            betType == BetType.HARD_4 ||
            betType == BetType.HARD_6 ||
            betType == BetType.HARD_8 ||
            betType == BetType.HARD_10
        ) {
            _removeHardwayBetForPlayer(player, _hardwayBetStorage(session.bets, betType), betType);
            return;
        }
        if (
            betType == BetType.ANY_7 ||
            betType == BetType.ANY_CRAPS ||
            betType == BetType.CRAPS_2 ||
            betType == BetType.CRAPS_3 ||
            betType == BetType.YO ||
            betType == BetType.TWELVE ||
            betType == BetType.HORN
        ) {
            _removeOneRollBetForPlayer(player, session.bets.oneRolls, betType);
            return;
        }
        revert InvalidBetType(betType);
    }

    function _applyRemoveIndexedBet(address player, BetType betType, uint8 index) internal {
        SessionData storage session = _sessions[player];
        _requireSessionReady(session);
        if (index >= 4) revert InvalidIndex(index);

        if (betType == BetType.DONT_COME) {
            _removeLineBetWithOddsForPlayer(player, session.bets.dontCome[index], BetType.DONT_COME);
            return;
        }
        if (betType == BetType.COME_ODDS) {
            _removeOddsBetForPlayer(player, session.bets.come[index], BetType.COME_ODDS);
            return;
        }
        if (betType == BetType.DONT_COME_ODDS) {
            _removeOddsBetForPlayer(player, session.bets.dontCome[index], BetType.DONT_COME_ODDS);
            return;
        }
        revert InvalidBetType(betType);
    }

    function _applySetBoxWorking(address player, BetType betType, bool working) internal {
        SessionData storage session = _sessions[player];
        _requireSessionReady(session);
        PlaceBet storage boxSlot = _boxBetStorage(session.bets, betType);
        if (boxSlot.amount == 0) revert NoActiveBet(betType);
        boxSlot.working = working;
        emit BoxWorkingSet(player, betType, working);
    }

    function _placeLineBetForPlayer(address player, Bet storage lineBet, BetType betType, PuckState puckState, uint256 amount) internal {
        if (puckState != PuckState.OFF) revert BetUnavailable(betType, puckState);
        _validateSingleBetAmount(amount, MIN_LINE_BET, MAX_LINE_BET, 1);
        if (lineBet.amount != 0) revert InvalidAmount(amount);
        _debitAvailable(player, amount);
        lineBet.amount = amount;
        lineBet.oddsAmount = 0;
        lineBet.point = 0;
        emit BetPlaced(player, betType, amount);
    }

    function _placeOddsBetForPlayer(
        address player,
        Bet storage lineBet,
        BetType baseBetType,
        BetType oddsBetType,
        PuckState puckState,
        uint8 point,
        uint256 amount
    ) internal {
        if (puckState != PuckState.ON) revert BetUnavailable(oddsBetType, puckState);
        if (lineBet.amount == 0) revert NoActiveBet(baseBetType);
        _validateOddsAmount(amount, lineBet.amount, point, lineBet.oddsAmount + amount, oddsBetType);
        _debitAvailable(player, amount);
        lineBet.oddsAmount += amount;
        emit BetPlaced(player, oddsBetType, amount);
    }

    function _placeComeTravelBetForPlayer(address player, Bet[4] storage bets, BetType betType, PuckState puckState, uint256 amount) internal {
        if (puckState != PuckState.ON) revert BetUnavailable(betType, puckState);
        _validateSingleBetAmount(amount, MIN_LINE_BET, MAX_LINE_BET, 1);
        uint8 slotIndex = _findOpenLineBetSlot(bets);
        if (slotIndex >= 4) revert InvalidIndex(slotIndex);
        _debitAvailable(player, amount);
        bets[slotIndex] = Bet({amount: amount, oddsAmount: 0, point: 0});
        emit BetPlaced(player, betType, amount);
    }

    function _removeLineBetWithOddsForPlayer(address player, Bet storage lineBet, BetType betType) internal {
        uint256 returnedAmount = lineBet.amount + lineBet.oddsAmount;
        if (returnedAmount == 0) revert NoActiveBet(betType);
        lineBet.amount = 0;
        lineBet.oddsAmount = 0;
        lineBet.point = 0;
        _creditAvailable(player, returnedAmount);
        emit BetRemoved(player, betType, returnedAmount);
    }

    function _removeOddsBetForPlayer(address player, Bet storage lineBet, BetType betType) internal {
        uint256 returnedAmount = lineBet.oddsAmount;
        if (returnedAmount == 0) revert NoActiveBet(betType);
        lineBet.oddsAmount = 0;
        _creditAvailable(player, returnedAmount);
        emit BetRemoved(player, betType, returnedAmount);
    }

    function _removePlaceBetForPlayer(address player, PlaceBet storage placeSlot, BetType betType) internal {
        uint256 returnedAmount = placeSlot.amount;
        if (returnedAmount == 0) revert NoActiveBet(betType);
        placeSlot.amount = 0;
        placeSlot.working = false;
        _creditAvailable(player, returnedAmount);
        emit BetRemoved(player, betType, returnedAmount);
    }

    function _removeHardwayBetForPlayer(address player, HardwayBet storage hardwayBet, BetType betType) internal {
        uint256 returnedAmount = hardwayBet.amount;
        if (returnedAmount == 0) revert NoActiveBet(betType);
        hardwayBet.amount = 0;
        _creditAvailable(player, returnedAmount);
        emit BetRemoved(player, betType, returnedAmount);
    }

    function _removeOneRollBetForPlayer(address player, OneRollBets storage oneRolls, BetType betType) internal {
        uint256 returnedAmount = _oneRollBetAmount(oneRolls, betType);
        if (returnedAmount == 0) revert NoActiveBet(betType);
        _setOneRollBetAmount(oneRolls, betType, 0);
        _creditAvailable(player, returnedAmount);
        emit BetRemoved(player, betType, returnedAmount);
    }

    function _isPlaceBetType(BetType betType) internal pure returns (bool) {
        return (
            betType == BetType.PLACE_4 ||
            betType == BetType.PLACE_5 ||
            betType == BetType.PLACE_6 ||
            betType == BetType.PLACE_8 ||
            betType == BetType.PLACE_9 ||
            betType == BetType.PLACE_10
        );
    }

    function _isLayBetType(BetType betType) internal pure returns (bool) {
        return (
            betType == BetType.LAY_4 ||
            betType == BetType.LAY_5 ||
            betType == BetType.LAY_6 ||
            betType == BetType.LAY_8 ||
            betType == BetType.LAY_9 ||
            betType == BetType.LAY_10
        );
    }

    function _validatePlaceAmount(uint256 newTotal, BetType betType) internal pure {
        if (betType == BetType.PLACE_6 || betType == BetType.PLACE_8) {
            _validateSingleBetAmount(newTotal, MIN_PLACE_6_8_BET, MAX_PLACE_BET, 6);
            return;
        }
        if (_isPlaceBetType(betType)) {
            _validateSingleBetAmount(newTotal, MIN_PLACE_BET, MAX_PLACE_BET, 5);
            return;
        }
        revert InvalidBetType(betType);
    }

    function _validateLayAmount(uint256 newTotal, BetType betType) internal pure {
        if (betType == BetType.LAY_4 || betType == BetType.LAY_10) {
            _validateSingleBetAmount(newTotal, MIN_LAY_4_10_BET, MAX_LAY_BET, 2);
            return;
        }
        if (betType == BetType.LAY_5 || betType == BetType.LAY_9) {
            _validateSingleBetAmount(newTotal, MIN_LAY_5_9_BET, MAX_LAY_BET, 3);
            return;
        }
        if (betType == BetType.LAY_6 || betType == BetType.LAY_8) {
            _validateSingleBetAmount(newTotal, MIN_LAY_6_8_BET, MAX_LAY_BET, 6);
            return;
        }
        revert InvalidBetType(betType);
    }

    function _layBetTypeForNumber(uint8 number) internal pure returns (BetType) {
        if (number == 4) return BetType.LAY_4;
        if (number == 5) return BetType.LAY_5;
        if (number == 6) return BetType.LAY_6;
        if (number == 8) return BetType.LAY_8;
        if (number == 9) return BetType.LAY_9;
        if (number == 10) return BetType.LAY_10;
        revert InvalidPoint(number);
    }

    function _boxBetStorage(BetSlots storage bets, BetType betType) internal view returns (PlaceBet storage) {
        if (betType == BetType.PLACE_4) return bets.place4;
        if (betType == BetType.PLACE_5) return bets.place5;
        if (betType == BetType.PLACE_6) return bets.place6;
        if (betType == BetType.PLACE_8) return bets.place8;
        if (betType == BetType.PLACE_9) return bets.place9;
        if (betType == BetType.PLACE_10) return bets.place10;
        if (betType == BetType.LAY_4) return bets.lay4;
        if (betType == BetType.LAY_5) return bets.lay5;
        if (betType == BetType.LAY_6) return bets.lay6;
        if (betType == BetType.LAY_8) return bets.lay8;
        if (betType == BetType.LAY_9) return bets.lay9;
        if (betType == BetType.LAY_10) return bets.lay10;
        revert InvalidBetType(betType);
    }

    function _layBetStorage(BetSlots storage bets, BetType betType) internal view returns (PlaceBet storage) {
        return _boxBetStorage(bets, betType);
    }

    function getPlayerState(address player) external view override returns (PlayerState memory state) {
        SessionData storage session = _sessions[player];

        state.phase = session.phase;
        state.puckState = session.point == 0 ? PuckState.OFF : PuckState.ON;
        state.point = session.point;
        state.lastActivityTime = session.lastActivityTime;
        state.pendingRequestId = session.pendingRequestId;
        state.available = _available[player];
        state.inPlay = _inPlay[player];
        state.reserved = _reserved[player];
        state.bankroll = bankroll;
        state.totalBankroll = bankroll + totalReserved;
        state.initialBankroll = INITIAL_BANKROLL;
        state.accruedFees = accruedFees;
        state.paused = paused();
        state.selfExcluded = selfExcluded[player];
        state.operatorExcluded = operatorExcluded[player];
        state.reinstatementEligibleAt = reinstatementEligibleAt[player];
        state.bets = session.bets;
    }

    function _debitAvailable(address player, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        uint256 availableBalance = _available[player];
        if (amount > availableBalance) {
            revert InsufficientBalance(availableBalance, amount);
        }

        unchecked {
            _available[player] = availableBalance - amount;
            _inPlay[player] += amount;
            totalAvailable -= amount;
            totalInPlay += amount;
        }
    }

    function _creditAvailable(address player, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        uint256 inPlayBalance = _inPlay[player];
        if (amount > inPlayBalance) {
            revert InsufficientBalance(inPlayBalance, amount);
        }

        unchecked {
            _inPlay[player] = inPlayBalance - amount;
            _available[player] += amount;
            totalInPlay -= amount;
            totalAvailable += amount;
        }
    }

    function _reserveFromBankroll(address player, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (amount > bankroll) revert InsufficientBankroll(bankroll, amount);

        unchecked {
            bankroll -= amount;
            _reserved[player] += amount;
            totalReserved += amount;
        }
    }

    function _releaseReserve(address player, uint256 paidOut) internal {
        uint256 reservedAmount = _reserved[player];
        if (paidOut > reservedAmount) {
            revert InsufficientBalance(reservedAmount, paidOut);
        }

        unchecked {
            _reserved[player] = 0;
            totalReserved -= reservedAmount;
            bankroll += reservedAmount - paidOut;
        }

        if (paidOut != 0) {
            _available[player] += paidOut;
            totalAvailable += paidOut;
        }
    }

    function _expireSession(address player) internal returns (uint256 returnedAmount) {

        SessionData storage session = _sessions[player];
        if (session.phase == SessionPhase.INACTIVE) {
            return 0;
        }

        if (session.phase == SessionPhase.ROLL_PENDING) {
            delete requestToPlayer[session.pendingRequestId];
            session.pendingRequestId = 0;
            if (pendingVRFRequests != 0) {
                pendingVRFRequests -= 1;
            }
            _releaseReserve(player, 0);
        }

        returnedAmount = _inPlay[player];
        if (returnedAmount != 0) {
            _creditAvailable(player, returnedAmount);
        }

        delete session.bets;
        session.phase = SessionPhase.INACTIVE;
        session.point = 0;
        session.lastActivityTime = 0;
        session.pendingRequestId = 0;

        if (activeSessions != 0) {
            activeSessions -= 1;
        }

        emit SessionExpired(player, returnedAmount);
    }

    function _requireSessionReady(SessionData storage session) internal view {
        if (session.phase == SessionPhase.INACTIVE) revert SessionNotActive();
        if (session.phase == SessionPhase.ROLL_PENDING) revert SessionRollPending();
        if (_isSessionExpired(session)) revert SessionNotActive();
    }

    function _validateSingleBetAmount(uint256 amount, uint256 minAmount, uint256 maxAmount, uint256 multiple) internal pure {
        if (amount == 0) revert ZeroAmount();
        if (amount < minAmount || amount > maxAmount) revert InvalidAmount(amount);
        if (multiple > 1 && amount % multiple != 0) revert InvalidMultiple(amount, multiple);
    }

    function _validateOddsAmount(
        uint256 addedAmount,
        uint256 flatAmount,
        uint8 point,
        uint256 newTotal,
        BetType betType
    ) internal pure {
        if (addedAmount == 0) revert ZeroAmount();
        if (flatAmount == 0) revert InvalidAmount(addedAmount);
        if (newTotal > flatAmount * MAX_ODDS_MULTIPLIER) revert InvalidAmount(newTotal);

        uint256 requiredMultiple = _oddsBetRequiredMultiple(betType, point);
        if (requiredMultiple > 1 && newTotal % requiredMultiple != 0) {
            revert InvalidMultiple(newTotal, requiredMultiple);
        }
    }

    function _oddsBetRequiredMultiple(BetType betType, uint8 point) internal pure returns (uint256 requiredMultiple) {
        if (point == 4 || point == 10) {
            if (betType == BetType.PASS_LINE_ODDS || betType == BetType.COME_ODDS) {
                return 1;
            }
            if (betType == BetType.DONT_PASS_ODDS || betType == BetType.DONT_COME_ODDS) {
                return 2;
            }
        }

        if (point == 5 || point == 9) {
            if (betType == BetType.PASS_LINE_ODDS || betType == BetType.COME_ODDS) {
                return 2;
            }
            if (betType == BetType.DONT_PASS_ODDS || betType == BetType.DONT_COME_ODDS) {
                return 3;
            }
        }

        if (point == 6 || point == 8) {
            if (betType == BetType.PASS_LINE_ODDS || betType == BetType.COME_ODDS) {
                return 5;
            }
            if (betType == BetType.DONT_PASS_ODDS || betType == BetType.DONT_COME_ODDS) {
                return 6;
            }
        }

        revert InvalidPoint(point);
    }

    function _findOpenLineBetSlot(Bet[4] storage bets) internal view returns (uint8 slotIndex) {
        for (uint8 i = 0; i < bets.length; ++i) {
            if (bets[i].amount == 0) {
                return i;
            }
        }

        return uint8(bets.length);
    }

    function _placeBetTypeForNumber(uint8 placeNumber) internal pure returns (BetType) {
        if (placeNumber == 4) return BetType.PLACE_4;
        if (placeNumber == 5) return BetType.PLACE_5;
        if (placeNumber == 6) return BetType.PLACE_6;
        if (placeNumber == 8) return BetType.PLACE_8;
        if (placeNumber == 9) return BetType.PLACE_9;
        if (placeNumber == 10) return BetType.PLACE_10;
        revert InvalidPoint(placeNumber);
    }

    function _placeBetStorage(BetSlots storage bets, BetType betType) internal view returns (PlaceBet storage) {
        if (betType == BetType.PLACE_4) return bets.place4;
        if (betType == BetType.PLACE_5) return bets.place5;
        if (betType == BetType.PLACE_6) return bets.place6;
        if (betType == BetType.PLACE_8) return bets.place8;
        if (betType == BetType.PLACE_9) return bets.place9;
        if (betType == BetType.PLACE_10) return bets.place10;
        revert InvalidBetType(betType);
    }

    function _hardwayBetStorage(BetSlots storage bets, BetType betType)
        internal
        view
        returns (HardwayBet storage)
    {
        if (betType == BetType.HARD_4) return bets.hard4;
        if (betType == BetType.HARD_6) return bets.hard6;
        if (betType == BetType.HARD_8) return bets.hard8;
        if (betType == BetType.HARD_10) return bets.hard10;
        revert InvalidBetType(betType);
    }

    function _oneRollBetAmount(OneRollBets storage oneRolls, BetType betType) internal view returns (uint256) {
        if (betType == BetType.FIELD) return oneRolls.field;
        if (betType == BetType.ANY_7) return oneRolls.any7;
        if (betType == BetType.ANY_CRAPS) return oneRolls.anyCraps;
        if (betType == BetType.CRAPS_2) return oneRolls.craps2;
        if (betType == BetType.CRAPS_3) return oneRolls.craps3;
        if (betType == BetType.YO) return oneRolls.yo;
        if (betType == BetType.TWELVE) return oneRolls.twelve;
        if (betType == BetType.HORN) return oneRolls.horn;
        revert InvalidBetType(betType);
    }

    function _setOneRollBetAmount(OneRollBets storage oneRolls, BetType betType, uint256 amount) internal {
        if (betType == BetType.FIELD) {
            oneRolls.field = amount;
            return;
        }
        if (betType == BetType.ANY_7) {
            oneRolls.any7 = amount;
            return;
        }
        if (betType == BetType.ANY_CRAPS) {
            oneRolls.anyCraps = amount;
            return;
        }
        if (betType == BetType.CRAPS_2) {
            oneRolls.craps2 = amount;
            return;
        }
        if (betType == BetType.CRAPS_3) {
            oneRolls.craps3 = amount;
            return;
        }
        if (betType == BetType.YO) {
            oneRolls.yo = amount;
            return;
        }
        if (betType == BetType.TWELVE) {
            oneRolls.twelve = amount;
            return;
        }
        if (betType == BetType.HORN) {
            oneRolls.horn = amount;
            return;
        }
        revert InvalidBetType(betType);
    }

    function _isExcluded(address player) internal view returns (bool) {
        return selfExcluded[player] || operatorExcluded[player];
    }

    function _isSessionExpired(SessionData storage session) internal view returns (bool) {
        if (session.phase == SessionPhase.INACTIVE || session.lastActivityTime == 0) {
            return false;
        }

        return block.timestamp - uint256(session.lastActivityTime) > SESSION_TIMEOUT;
    }

    function _puckState(uint8 point) internal pure returns (PuckState) {
        return point == 0 ? PuckState.OFF : PuckState.ON;
    }

    function _softMoveInPlayToAvailable(address player, uint256 amount) internal returns (uint256 actualAmount) {
        if (amount == 0) {
            return 0;
        }

        uint256 inPlayBalance = _inPlay[player];
        actualAmount = amount;
        if (actualAmount > inPlayBalance) {
            actualAmount = inPlayBalance;
        }
        if (actualAmount > totalInPlay) {
            actualAmount = totalInPlay;
        }
        if (actualAmount == 0) {
            return 0;
        }

        _inPlay[player] = inPlayBalance - actualAmount;
        totalInPlay -= actualAmount;
        _available[player] += actualAmount;
        totalAvailable += actualAmount;
    }

    function _softMoveInPlayToBankroll(address player, uint256 amount) internal returns (uint256 actualAmount) {
        if (amount == 0) {
            return 0;
        }

        uint256 inPlayBalance = _inPlay[player];
        actualAmount = amount;
        if (actualAmount > inPlayBalance) {
            actualAmount = inPlayBalance;
        }
        if (actualAmount > totalInPlay) {
            actualAmount = totalInPlay;
        }
        if (actualAmount == 0) {
            return 0;
        }

        _inPlay[player] = inPlayBalance - actualAmount;
        totalInPlay -= actualAmount;
        bankroll += actualAmount;
    }

    function _softReleaseReserve(address player, uint256 paidOut) internal returns (uint256 actualPaidOut) {
        uint256 reservedAmount = _reserved[player];
        uint256 trackedReserved = reservedAmount;
        if (trackedReserved > totalReserved) {
            trackedReserved = totalReserved;
        }

        _reserved[player] = 0;
        if (trackedReserved != 0) {
            totalReserved -= trackedReserved;
        }

        actualPaidOut = paidOut;
        if (actualPaidOut > trackedReserved) {
            actualPaidOut = trackedReserved;
        }

        bankroll += trackedReserved - actualPaidOut;

        if (actualPaidOut != 0) {
            _available[player] += actualPaidOut;
            totalAvailable += actualPaidOut;
        }
    }

    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        address player = requestToPlayer[requestId];
        if (player == address(0)) {
            return;
        }

        delete requestToPlayer[requestId];
        if (pendingVRFRequests != 0) {
            pendingVRFRequests -= 1;
        }

        SessionData storage session = _sessions[player];
        uint8 priorPoint = session.point;

        if (session.phase != SessionPhase.ROLL_PENDING || session.pendingRequestId != requestId) {
            session.pendingRequestId = 0;
            if (session.phase == SessionPhase.ROLL_PENDING) {
                session.phase = priorPoint == 0 ? SessionPhase.COME_OUT : SessionPhase.POINT;
            }
            _softReleaseReserve(player, 0);
            return;
        }

        if (randomWords.length == 0) {
            session.pendingRequestId = 0;
            session.phase = priorPoint == 0 ? SessionPhase.COME_OUT : SessionPhase.POINT;
            session.lastActivityTime = uint48(block.timestamp);
            _softReleaseReserve(player, 0);
            emit RollResolved(player, requestId, 0, 0, 0);
            return;
        }

        uint256 randomWord = randomWords[0];
        uint8 die1 = uint8((randomWord % 6) + 1);
        uint8 die2 = uint8(((randomWord >> 8) % 6) + 1);
        uint8 sum = die1 + die2;

        uint256 returnedToAvailable;
        uint256 lostToBankroll;
        uint256 payout;
        uint8 nextPoint;
        uint8 nextPhase;
        (session.bets, returnedToAvailable, lostToBankroll, payout, nextPoint, nextPhase) = RollResolutionV2.resolveRoll(
            session.bets,
            priorPoint,
            sum,
            die1,
            die2,
            LAY_WIN_VIG_BPS
        );

        _softMoveInPlayToAvailable(player, returnedToAvailable);
        _softMoveInPlayToBankroll(player, lostToBankroll);
        uint256 actualPayout = _softReleaseReserve(player, payout);
        session.point = nextPoint;
        session.phase = SessionPhase(nextPhase);

        session.pendingRequestId = 0;
        session.lastActivityTime = uint48(block.timestamp);

        emit RollResolved(player, requestId, die1, die2, actualPayout);
    }
}
