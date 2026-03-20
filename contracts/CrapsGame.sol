// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICrapsGame} from "./interfaces/ICrapsGame.sol";
import {PayoutMath} from "./libraries/PayoutMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract CrapsGame is ICrapsGame, VRFConsumerBaseV2Plus, Pausable, ReentrancyGuard {
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

    IERC20 private immutable i_token;
    uint256 internal immutable vrfSubscriptionId;
    bytes32 internal immutable vrfKeyHash;
    bool internal immutable DEBUG;

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
    mapping(address player => bool tracked) private _isTrackedPlayer;

    address[] private _trackedPlayers;

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
        bytes32 vrfKeyHash_,
        bool debug_
    ) VRFConsumerBaseV2Plus(vrfCoordinator_) {
        if (token_ == address(0)) revert InvalidAmount(0);

        i_token = IERC20(token_);
        vrfSubscriptionId = vrfSubscriptionId_;
        vrfKeyHash = vrfKeyHash_;
        DEBUG = debug_;
    }

    function token() external view override returns (address) {
        return address(i_token);
    }

    function deposit(uint256 amount) external override whenNotPaused notExcluded nonReentrant {
        if (amount == 0) revert ZeroAmount();

        _trackPlayer(msg.sender);
        i_token.safeTransferFrom(msg.sender, address(this), amount);

        uint256 fee = (amount * DEPOSIT_FEE_BPS) / 10_000;
        uint256 creditedAmount = amount - fee;

        _available[msg.sender] += creditedAmount;
        totalAvailable += creditedAmount;
        accruedFees += fee;

        emit Deposit(msg.sender, amount, fee);
        _assertInvariantIfNeeded();
    }

    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        _trackPlayer(msg.sender);
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
        _assertInvariantIfNeeded();
    }

    function withdrawFees(address to) external override onlyOwner nonReentrant {
        uint256 amount = accruedFees;
        if (amount == 0) revert ZeroAmount();

        accruedFees = 0;
        i_token.safeTransfer(to, amount);

        emit FeesWithdrawn(to, amount);
        _assertInvariantIfNeeded();
    }

    function fundBankroll(uint256 amount) external override onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        i_token.safeTransferFrom(msg.sender, address(this), amount);
        bankroll += amount;

        emit BankrollFunded(msg.sender, amount);
        _assertInvariantIfNeeded();
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
        _assertInvariantIfNeeded();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function openSession() external override whenNotPaused notExcluded nonReentrant {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        if (session.phase != SessionPhase.INACTIVE) revert SessionAlreadyActive();

        delete session.bets;
        session.phase = SessionPhase.COME_OUT;
        session.point = 0;
        session.lastActivityTime = uint48(block.timestamp);
        session.pendingRequestId = 0;
        activeSessions += 1;

        emit SessionOpened(msg.sender);
        _assertInvariantIfNeeded();
    }

    function closeSession() external override nonReentrant {
        _trackPlayer(msg.sender);

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
        _assertInvariantIfNeeded();
    }

    function expireSession(address player) external override nonReentrant {
        SessionData storage session = _sessions[player];
        if (session.phase == SessionPhase.INACTIVE) revert SessionNotActive();
        if (!_isSessionExpired(session)) revert SessionNotActive();

        _expireSession(player);
        _assertInvariantIfNeeded();
    }

    function selfExclude() external override nonReentrant {
        _trackPlayer(msg.sender);

        selfExcluded[msg.sender] = true;
        reinstatementEligibleAt[msg.sender] = 0;
        _expireSession(msg.sender);

        emit SelfExcluded(msg.sender);
        _assertInvariantIfNeeded();
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
        if (eligibleAt == 0 || block.timestamp < eligibleAt) revert NotEligibleForReinstatement(eligibleAt);

        selfExcluded[msg.sender] = false;
        reinstatementEligibleAt[msg.sender] = 0;

        emit SelfReinstated(msg.sender);
    }

    function operatorExclude(address player) external override onlyOwner nonReentrant {
        _trackPlayer(player);

        operatorExcluded[player] = true;
        _expireSession(player);

        emit OperatorExcluded(player);
        _assertInvariantIfNeeded();
    }

    function operatorReinstate(address player) external override onlyOwner {
        operatorExcluded[player] = false;

        emit OperatorReinstated(player);
    }

    function placeBet(BetType betType, uint256 amount) external override whenNotPaused notExcluded nonReentrant {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        _requireSessionReady(session);

        PuckState puckState = _puckState(session.point);

        if (betType == BetType.PASS_LINE) {
            _placeLineBet(session.bets.passLine, betType, puckState, amount);
            return;
        }

        if (betType == BetType.DONT_PASS) {
            _placeLineBet(session.bets.dontPass, betType, puckState, amount);
            return;
        }

        if (betType == BetType.PASS_LINE_ODDS) {
            _placeOddsBet(session.bets.passLine, BetType.PASS_LINE, betType, puckState, session.point, amount);
            return;
        }

        if (betType == BetType.DONT_PASS_ODDS) {
            _placeOddsBet(session.bets.dontPass, BetType.DONT_PASS, betType, puckState, session.point, amount);
            return;
        }

        if (betType == BetType.COME) {
            _placeComeTravelBet(session.bets.come, betType, puckState, amount);
            return;
        }

        if (betType == BetType.DONT_COME) {
            _placeComeTravelBet(session.bets.dontCome, betType, puckState, amount);
            return;
        }

        if (
            betType == BetType.PLACE_4 ||
            betType == BetType.PLACE_5 ||
            betType == BetType.PLACE_6 ||
            betType == BetType.PLACE_8 ||
            betType == BetType.PLACE_9 ||
            betType == BetType.PLACE_10
        ) {
            if (puckState != PuckState.ON) revert BetUnavailable(betType, puckState);

            uint256 minAmount = (betType == BetType.PLACE_6 || betType == BetType.PLACE_8)
                ? MIN_PLACE_6_8_BET
                : MIN_PLACE_BET;
            uint256 multiple = (betType == BetType.PLACE_6 || betType == BetType.PLACE_8) ? 6 : 5;
            PlaceBet storage placeSlot = _placeBetStorage(session.bets, betType);
            uint256 newTotal = placeSlot.amount + amount;

            _validateSingleBetAmount(newTotal, minAmount, MAX_PLACE_BET, multiple);
            _debitAvailable(msg.sender, amount);

            placeSlot.amount = newTotal;
            if (placeSlot.amount == amount) {
                placeSlot.working = true;
            }

            emit BetPlaced(msg.sender, betType, amount);
            return;
        }

        if (betType == BetType.FIELD) {
            uint256 newTotal = session.bets.oneRolls.field + amount;
            _validateSingleBetAmount(newTotal, MIN_FIELD_BET, MAX_FIELD_BET, 1);

            _debitAvailable(msg.sender, amount);
            session.bets.oneRolls.field = newTotal;

            emit BetPlaced(msg.sender, betType, amount);
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
            _debitAvailable(msg.sender, amount);
            hardwayBet.amount = newTotal;

            emit BetPlaced(msg.sender, betType, amount);
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
            _debitAvailable(msg.sender, amount);
            _setOneRollBetAmount(session.bets.oneRolls, betType, newTotal);

            emit BetPlaced(msg.sender, betType, amount);
            return;
        }

        revert InvalidBetType(betType);
    }

    function placeIndexedBet(BetType betType, uint8 index, uint256 amount)
        external
        override
        whenNotPaused
        notExcluded
        nonReentrant
    {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        _requireSessionReady(session);

        if (session.point == 0) revert BetUnavailable(betType, PuckState.OFF);
        if (index >= 4) revert InvalidIndex(index);

        if (betType == BetType.COME_ODDS) {
            Bet storage comeBet = session.bets.come[index];
            if (comeBet.amount == 0 || comeBet.point == 0) revert NoActiveBet(BetType.COME);
            _placeOddsBet(comeBet, BetType.COME, betType, PuckState.ON, comeBet.point, amount);
            return;
        }

        if (betType == BetType.DONT_COME_ODDS) {
            Bet storage dontComeBet = session.bets.dontCome[index];
            if (dontComeBet.amount == 0 || dontComeBet.point == 0) revert NoActiveBet(BetType.DONT_COME);
            _placeOddsBet(dontComeBet, BetType.DONT_COME, betType, PuckState.ON, dontComeBet.point, amount);
            return;
        }

        revert InvalidBetType(betType);
    }

    function removeBet(BetType betType) external override nonReentrant {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        _requireSessionReady(session);

        if (betType == BetType.DONT_PASS) {
            _removeLineBetWithOdds(session.bets.dontPass, BetType.DONT_PASS);
            return;
        }

        if (betType == BetType.PASS_LINE_ODDS) {
            _removeOddsBet(session.bets.passLine, BetType.PASS_LINE_ODDS);
            return;
        }

        if (betType == BetType.DONT_PASS_ODDS) {
            _removeOddsBet(session.bets.dontPass, BetType.DONT_PASS_ODDS);
            return;
        }

        if (betType == BetType.FIELD) {
            _removeOneRollBet(session.bets.oneRolls, betType);
            return;
        }

        if (
            betType == BetType.PLACE_4 ||
            betType == BetType.PLACE_5 ||
            betType == BetType.PLACE_6 ||
            betType == BetType.PLACE_8 ||
            betType == BetType.PLACE_9 ||
            betType == BetType.PLACE_10
        ) {
            _removePlaceBet(_placeBetStorage(session.bets, betType), betType);
            return;
        }

        if (
            betType == BetType.HARD_4 ||
            betType == BetType.HARD_6 ||
            betType == BetType.HARD_8 ||
            betType == BetType.HARD_10
        ) {
            _removeHardwayBet(_hardwayBetStorage(session.bets, betType), betType);
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
            _removeOneRollBet(session.bets.oneRolls, betType);
            return;
        }

        revert InvalidBetType(betType);
    }

    function removeIndexedBet(BetType betType, uint8 index) external override nonReentrant {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        _requireSessionReady(session);

        if (index >= 4) revert InvalidIndex(index);

        if (betType == BetType.DONT_COME) {
            _removeLineBetWithOdds(session.bets.dontCome[index], BetType.DONT_COME);
            return;
        }

        if (betType == BetType.COME_ODDS) {
            _removeOddsBet(session.bets.come[index], BetType.COME_ODDS);
            return;
        }

        if (betType == BetType.DONT_COME_ODDS) {
            _removeOddsBet(session.bets.dontCome[index], BetType.DONT_COME_ODDS);
            return;
        }

        revert InvalidBetType(betType);
    }

    function setPlaceWorking(uint8 placeNumber, bool working) external override nonReentrant {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        _requireSessionReady(session);

        BetType betType = _placeBetTypeForNumber(placeNumber);
        PlaceBet storage placeSlot = _placeBetStorage(session.bets, betType);
        if (placeSlot.amount == 0) revert NoActiveBet(betType);

        placeSlot.working = working;
        _assertInvariantIfNeeded();
    }

    function rollDice() external override whenNotPaused notExcluded nonReentrant returns (uint256 requestId) {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        _requireSessionReady(session);

        if (_inPlay[msg.sender] == 0) revert InvalidAmount(0);

        BetSlots memory activeBets = session.bets;
        uint256 worstCase = PayoutMath.maxPossiblePayout(activeBets, session.point);
        if (worstCase > bankroll) revert InsufficientBankroll(bankroll, worstCase);

        if (worstCase != 0) {
            _reserveFromBankroll(msg.sender, worstCase);
        }

        VRFV2PlusClient.RandomWordsRequest memory request = VRFV2PlusClient.RandomWordsRequest({
            keyHash: vrfKeyHash,
            subId: vrfSubscriptionId,
            requestConfirmations: REQUEST_CONFIRMATIONS,
            callbackGasLimit: CALLBACK_GAS_LIMIT,
            numWords: NUM_WORDS,
            extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: false}))
        });

        requestId = s_vrfCoordinator.requestRandomWords(request);
        requestToPlayer[requestId] = msg.sender;
        session.pendingRequestId = requestId;
        session.phase = SessionPhase.ROLL_PENDING;
        pendingVRFRequests += 1;

        emit RollRequested(msg.sender, requestId, worstCase);
        _assertInvariantIfNeeded();
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

        _trackPlayer(player);
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

        _assertInvariantIfNeeded();
    }

    function _creditAvailable(address player, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();

        _trackPlayer(player);
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

        _assertInvariantIfNeeded();
    }

    function _reserveFromBankroll(address player, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        _trackPlayer(player);
        if (amount > bankroll) revert InsufficientBankroll(bankroll, amount);

        unchecked {
            bankroll -= amount;
            _reserved[player] += amount;
            totalReserved += amount;
        }

        _assertInvariantIfNeeded();
    }

    function _releaseReserve(address player, uint256 paidOut) internal {
        _trackPlayer(player);
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

        _assertInvariantIfNeeded();
    }

    function _expireSession(address player) internal returns (uint256 returnedAmount) {
        _trackPlayer(player);

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

    function _trackPlayer(address player) internal {
        if (_isTrackedPlayer[player]) {
            return;
        }

        _isTrackedPlayer[player] = true;
        _trackedPlayers.push(player);
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

        (, uint256 denominator) = PayoutMath.payoutMultiplier(betType, point);
        if (denominator == 0) revert InvalidPoint(point);
        if (denominator > 1 && newTotal % denominator != 0) revert InvalidMultiple(newTotal, denominator);
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

    function _placeBetStorage(BetSlots storage bets, BetType betType) internal view returns (PlaceBet storage placeSlot) {
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
        returns (HardwayBet storage hardwayBet)
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

    function _placeLineBet(Bet storage lineBet, BetType betType, PuckState puckState, uint256 amount) internal {
        if (puckState != PuckState.OFF) revert BetUnavailable(betType, puckState);
        _validateSingleBetAmount(amount, MIN_LINE_BET, MAX_LINE_BET, 1);
        if (lineBet.amount != 0) revert InvalidAmount(amount);

        _debitAvailable(msg.sender, amount);
        lineBet.amount = amount;
        lineBet.oddsAmount = 0;
        lineBet.point = 0;

        emit BetPlaced(msg.sender, betType, amount);
    }

    function _placeOddsBet(
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
        _debitAvailable(msg.sender, amount);
        lineBet.oddsAmount += amount;

        emit BetPlaced(msg.sender, oddsBetType, amount);
    }

    function _placeComeTravelBet(Bet[4] storage bets, BetType betType, PuckState puckState, uint256 amount) internal {
        if (puckState != PuckState.ON) revert BetUnavailable(betType, puckState);
        _validateSingleBetAmount(amount, MIN_LINE_BET, MAX_LINE_BET, 1);

        uint8 slotIndex = _findOpenLineBetSlot(bets);
        if (slotIndex >= 4) revert InvalidIndex(slotIndex);

        _debitAvailable(msg.sender, amount);
        bets[slotIndex] = Bet({amount: amount, oddsAmount: 0, point: 0});

        emit BetPlaced(msg.sender, betType, amount);
    }

    function _removeLineBetWithOdds(Bet storage lineBet, BetType betType) internal {
        uint256 returnedAmount = lineBet.amount + lineBet.oddsAmount;
        if (returnedAmount == 0) revert NoActiveBet(betType);

        lineBet.amount = 0;
        lineBet.oddsAmount = 0;
        lineBet.point = 0;
        _creditAvailable(msg.sender, returnedAmount);

        emit BetRemoved(msg.sender, betType, returnedAmount);
    }

    function _removeOddsBet(Bet storage lineBet, BetType betType) internal {
        uint256 returnedAmount = lineBet.oddsAmount;
        if (returnedAmount == 0) revert NoActiveBet(betType);

        lineBet.oddsAmount = 0;
        _creditAvailable(msg.sender, returnedAmount);

        emit BetRemoved(msg.sender, betType, returnedAmount);
    }

    function _removePlaceBet(PlaceBet storage placeSlot, BetType betType) internal {
        uint256 returnedAmount = placeSlot.amount;
        if (returnedAmount == 0) revert NoActiveBet(betType);

        placeSlot.amount = 0;
        placeSlot.working = false;
        _creditAvailable(msg.sender, returnedAmount);

        emit BetRemoved(msg.sender, betType, returnedAmount);
    }

    function _removeHardwayBet(HardwayBet storage hardwayBet, BetType betType) internal {
        uint256 returnedAmount = hardwayBet.amount;
        if (returnedAmount == 0) revert NoActiveBet(betType);

        hardwayBet.amount = 0;
        _creditAvailable(msg.sender, returnedAmount);

        emit BetRemoved(msg.sender, betType, returnedAmount);
    }

    function _removeOneRollBet(OneRollBets storage oneRolls, BetType betType) internal {
        uint256 returnedAmount = _oneRollBetAmount(oneRolls, betType);
        if (returnedAmount == 0) revert NoActiveBet(betType);

        _setOneRollBetAmount(oneRolls, betType, 0);
        _creditAvailable(msg.sender, returnedAmount);

        emit BetRemoved(msg.sender, betType, returnedAmount);
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

    function _isPointNumber(uint8 sum) internal pure returns (bool) {
        return sum == 4 || sum == 5 || sum == 6 || sum == 8 || sum == 9 || sum == 10;
    }

    function _payoutAmount(uint256 amount, BetType betType, uint8 point) internal pure returns (uint256) {
        if (amount == 0) {
            return 0;
        }

        (uint256 numerator, uint256 denominator) = PayoutMath.payoutMultiplier(betType, point);
        if (numerator == 0 || denominator == 0) {
            return 0;
        }

        return (amount * numerator) / denominator;
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

    function _resolvePlaceBet(PlaceBet storage placeSlot, BetType betType, uint8 target, uint8 sum)
        internal
        returns (uint256 wonPayout, uint256 lostAmount)
    {
        uint256 amount = placeSlot.amount;
        if (amount == 0) {
            return (0, 0);
        }

        if (sum == 7) {
            placeSlot.amount = 0;
            placeSlot.working = false;
            return (0, amount);
        }

        if (sum == target && placeSlot.working) {
            return (_payoutAmount(amount, betType, target), 0);
        }

        return (0, 0);
    }

    function _resolveHardwayBet(HardwayBet storage hardwayBet, BetType betType, uint8 target, uint8 sum, uint8 die1, uint8 die2)
        internal
        returns (uint256 returnedAmount, uint256 wonPayout, uint256 lostAmount)
    {
        uint256 amount = hardwayBet.amount;
        if (amount == 0) {
            return (0, 0, 0);
        }

        if (sum == 7 || (sum == target && die1 != die2)) {
            hardwayBet.amount = 0;
            return (0, 0, amount);
        }

        if (sum == target && die1 == die2) {
            hardwayBet.amount = 0;
            return (amount, _payoutAmount(amount, betType, target), 0);
        }

        return (0, 0, 0);
    }

    function _resolveFieldBet(uint256 amount, uint8 sum)
        internal
        pure
        returns (uint256 returnedAmount, uint256 wonPayout, uint256 lostAmount)
    {
        if (amount == 0) {
            return (0, 0, 0);
        }

        if (sum == 2 || sum == 12 || sum == 3 || sum == 4 || sum == 9 || sum == 10 || sum == 11) {
            return (amount, _payoutAmount(amount, BetType.FIELD, sum), 0);
        }

        return (0, 0, amount);
    }

    function _resolveOneRollBet(uint256 amount, BetType betType, uint8 sum)
        internal
        pure
        returns (uint256 returnedAmount, uint256 wonPayout, uint256 lostAmount)
    {
        if (amount == 0) {
            return (0, 0, 0);
        }

        bool wins;
        if (betType == BetType.ANY_7) {
            wins = sum == 7;
        } else if (betType == BetType.ANY_CRAPS) {
            wins = sum == 2 || sum == 3 || sum == 12;
        } else if (betType == BetType.CRAPS_2) {
            wins = sum == 2;
        } else if (betType == BetType.CRAPS_3) {
            wins = sum == 3;
        } else if (betType == BetType.YO) {
            wins = sum == 11;
        } else if (betType == BetType.TWELVE) {
            wins = sum == 12;
        } else if (betType == BetType.HORN) {
            wins = sum == 2 || sum == 3 || sum == 11 || sum == 12;
        }

        if (wins) {
            return (amount, _payoutAmount(amount, betType, sum), 0);
        }

        return (0, 0, amount);
    }

    function _assertInvariant() internal view {
        uint256 sumAvailable;
        uint256 sumInPlay;
        uint256 sumReserved;
        uint256 trackedPlayerCount = _trackedPlayers.length;

        for (uint256 i = 0; i < trackedPlayerCount; ++i) {
            address player = _trackedPlayers[i];
            sumAvailable += _available[player];
            sumInPlay += _inPlay[player];
            sumReserved += _reserved[player];
        }

        assert(sumAvailable == totalAvailable);
        assert(sumInPlay == totalInPlay);
        assert(sumReserved == totalReserved);
        assert(i_token.balanceOf(address(this)) == sumAvailable + sumInPlay + sumReserved + bankroll + accruedFees);
    }

    function _assertInvariantIfNeeded() internal view {
        if (DEBUG) {
            _assertInvariant();
        }
    }

    function _advanceSessionAfterRoll(SessionData storage session, uint8 priorPoint, uint8 sum) internal {
        if (priorPoint == 0) {
            if (_isPointNumber(sum)) {
                session.point = sum;
                session.phase = SessionPhase.POINT;
                if (session.bets.passLine.amount != 0) {
                    session.bets.passLine.point = sum;
                }
                if (session.bets.dontPass.amount != 0) {
                    session.bets.dontPass.point = sum;
                }
                return;
            }

            session.point = 0;
            session.phase = SessionPhase.COME_OUT;
            return;
        }

        if (sum == 7 || sum == priorPoint) {
            session.point = 0;
            session.phase = SessionPhase.COME_OUT;
            return;
        }

        session.point = priorPoint;
        session.phase = SessionPhase.POINT;
        if (session.bets.passLine.amount != 0) {
            session.bets.passLine.point = priorPoint;
        }
        if (session.bets.dontPass.amount != 0) {
            session.bets.dontPass.point = priorPoint;
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
            _assertInvariantIfNeeded();
            return;
        }

        if (randomWords.length == 0) {
            session.pendingRequestId = 0;
            session.phase = priorPoint == 0 ? SessionPhase.COME_OUT : SessionPhase.POINT;
            session.lastActivityTime = uint48(block.timestamp);
            _softReleaseReserve(player, 0);
            emit RollResolved(player, requestId, 0, 0, 0);
            _assertInvariantIfNeeded();
            return;
        }

        uint256 randomWord = randomWords[0];
        uint8 die1 = uint8((randomWord % 6) + 1);
        uint8 die2 = uint8(((randomWord >> 8) % 6) + 1);
        uint8 sum = die1 + die2;

        uint256 returnedToAvailable;
        uint256 lostToBankroll;
        uint256 payout;

        Bet storage passLine = session.bets.passLine;
        if (passLine.amount != 0) {
            if (priorPoint == 0) {
                if (sum == 7 || sum == 11) {
                    returnedToAvailable += passLine.amount;
                    payout += passLine.amount;
                    delete session.bets.passLine;
                } else if (sum == 2 || sum == 3 || sum == 12) {
                    lostToBankroll += passLine.amount;
                    delete session.bets.passLine;
                }
            } else if (sum == priorPoint) {
                returnedToAvailable += passLine.amount + passLine.oddsAmount;
                payout += passLine.amount;
                payout += _payoutAmount(passLine.oddsAmount, BetType.PASS_LINE_ODDS, priorPoint);
                delete session.bets.passLine;
            } else if (sum == 7) {
                lostToBankroll += passLine.amount + passLine.oddsAmount;
                delete session.bets.passLine;
            }
        }

        Bet storage dontPass = session.bets.dontPass;
        if (dontPass.amount != 0) {
            if (priorPoint == 0) {
                if (sum == 2 || sum == 3) {
                    returnedToAvailable += dontPass.amount;
                    payout += dontPass.amount;
                    delete session.bets.dontPass;
                } else if (sum == 7 || sum == 11) {
                    lostToBankroll += dontPass.amount;
                    delete session.bets.dontPass;
                }
            } else if (sum == 7) {
                returnedToAvailable += dontPass.amount + dontPass.oddsAmount;
                payout += dontPass.amount;
                payout += _payoutAmount(dontPass.oddsAmount, BetType.DONT_PASS_ODDS, priorPoint);
                delete session.bets.dontPass;
            } else if (sum == priorPoint) {
                lostToBankroll += dontPass.amount + dontPass.oddsAmount;
                delete session.bets.dontPass;
            }
        }

        for (uint8 i = 0; i < session.bets.come.length; ++i) {
            Bet storage comeBet = session.bets.come[i];
            if (comeBet.amount != 0) {
                if (comeBet.point == 0) {
                    if (sum == 7 || sum == 11) {
                        returnedToAvailable += comeBet.amount;
                        payout += comeBet.amount;
                        delete session.bets.come[i];
                    } else if (sum == 2 || sum == 3 || sum == 12) {
                        lostToBankroll += comeBet.amount;
                        delete session.bets.come[i];
                    } else {
                        comeBet.point = sum;
                    }
                } else if (sum == comeBet.point) {
                    returnedToAvailable += comeBet.amount + comeBet.oddsAmount;
                    payout += comeBet.amount;
                    payout += _payoutAmount(comeBet.oddsAmount, BetType.COME_ODDS, comeBet.point);
                    delete session.bets.come[i];
                } else if (sum == 7) {
                    lostToBankroll += comeBet.amount + comeBet.oddsAmount;
                    delete session.bets.come[i];
                }
            }

            Bet storage dontComeBet = session.bets.dontCome[i];
            if (dontComeBet.amount != 0) {
                if (dontComeBet.point == 0) {
                    if (sum == 2 || sum == 3) {
                        returnedToAvailable += dontComeBet.amount;
                        payout += dontComeBet.amount;
                        delete session.bets.dontCome[i];
                    } else if (sum == 7 || sum == 11) {
                        lostToBankroll += dontComeBet.amount;
                        delete session.bets.dontCome[i];
                    } else if (sum != 12) {
                        dontComeBet.point = sum;
                    }
                } else if (sum == 7) {
                    returnedToAvailable += dontComeBet.amount + dontComeBet.oddsAmount;
                    payout += dontComeBet.amount;
                    payout += _payoutAmount(dontComeBet.oddsAmount, BetType.DONT_COME_ODDS, dontComeBet.point);
                    delete session.bets.dontCome[i];
                } else if (sum == dontComeBet.point) {
                    lostToBankroll += dontComeBet.amount + dontComeBet.oddsAmount;
                    delete session.bets.dontCome[i];
                }
            }
        }

        uint256 wonPayout;
        uint256 lostAmount;
        uint256 returnedAmount;

        (wonPayout, lostAmount) = _resolvePlaceBet(session.bets.place4, BetType.PLACE_4, 4, sum);
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (wonPayout, lostAmount) = _resolvePlaceBet(session.bets.place5, BetType.PLACE_5, 5, sum);
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (wonPayout, lostAmount) = _resolvePlaceBet(session.bets.place6, BetType.PLACE_6, 6, sum);
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (wonPayout, lostAmount) = _resolvePlaceBet(session.bets.place8, BetType.PLACE_8, 8, sum);
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (wonPayout, lostAmount) = _resolvePlaceBet(session.bets.place9, BetType.PLACE_9, 9, sum);
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (wonPayout, lostAmount) = _resolvePlaceBet(session.bets.place10, BetType.PLACE_10, 10, sum);
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (returnedAmount, wonPayout, lostAmount) = _resolveHardwayBet(session.bets.hard4, BetType.HARD_4, 4, sum, die1, die2);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (returnedAmount, wonPayout, lostAmount) = _resolveHardwayBet(session.bets.hard6, BetType.HARD_6, 6, sum, die1, die2);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (returnedAmount, wonPayout, lostAmount) = _resolveHardwayBet(session.bets.hard8, BetType.HARD_8, 8, sum, die1, die2);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (returnedAmount, wonPayout, lostAmount) = _resolveHardwayBet(session.bets.hard10, BetType.HARD_10, 10, sum, die1, die2);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;

        (returnedAmount, wonPayout, lostAmount) = _resolveFieldBet(session.bets.oneRolls.field, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        session.bets.oneRolls.field = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(session.bets.oneRolls.any7, BetType.ANY_7, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        session.bets.oneRolls.any7 = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(session.bets.oneRolls.anyCraps, BetType.ANY_CRAPS, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        session.bets.oneRolls.anyCraps = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(session.bets.oneRolls.craps2, BetType.CRAPS_2, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        session.bets.oneRolls.craps2 = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(session.bets.oneRolls.craps3, BetType.CRAPS_3, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        session.bets.oneRolls.craps3 = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(session.bets.oneRolls.yo, BetType.YO, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        session.bets.oneRolls.yo = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(session.bets.oneRolls.twelve, BetType.TWELVE, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        session.bets.oneRolls.twelve = 0;

        (returnedAmount, wonPayout, lostAmount) = _resolveOneRollBet(session.bets.oneRolls.horn, BetType.HORN, sum);
        returnedToAvailable += returnedAmount;
        payout += wonPayout;
        lostToBankroll += lostAmount;
        session.bets.oneRolls.horn = 0;

        _softMoveInPlayToAvailable(player, returnedToAvailable);
        _softMoveInPlayToBankroll(player, lostToBankroll);
        uint256 actualPayout = _softReleaseReserve(player, payout);
        _advanceSessionAfterRoll(session, priorPoint, sum);

        session.pendingRequestId = 0;
        session.lastActivityTime = uint48(block.timestamp);

        emit RollResolved(player, requestId, die1, die2, actualPayout);
        _assertInvariantIfNeeded();
    }
}
