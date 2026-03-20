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

    uint16 public constant DEPOSIT_FEE_BPS = 50;
    uint256 public constant MIN_BANKROLL = 10_000e6;
    uint256 public constant INITIAL_BANKROLL = 50_000e6;

    uint32 public constant CALLBACK_GAS_LIMIT = 500_000;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant NUM_WORDS = 1;
    uint256 public constant SESSION_TIMEOUT = 24 hours;
    uint256 public constant VRF_TIMEOUT_BLOCKS = 100;
    uint256 public constant SELF_EXCLUSION_DELAY = 7 days;

    uint256 public constant MIN_LINE_BET = 1e6;
    uint256 public constant MAX_LINE_BET = 500e6;
    uint256 public constant MIN_FIELD_BET = 1e6;
    uint256 public constant MAX_FIELD_BET = 500e6;

    IERC20 private immutable i_token;
    uint256 public immutable vrfSubscriptionId;
    bytes32 public immutable vrfKeyHash;
    bool public immutable DEBUG;

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

    mapping(uint256 requestId => address player) public requestToPlayer;
    mapping(address player => bool excluded) public selfExcluded;
    mapping(address player => bool excluded) public operatorExcluded;
    mapping(address player => uint256 eligibleAt) public reinstatementEligibleAt;
    mapping(address player => bool tracked) private _isTrackedPlayer;

    address[] private _trackedPlayers;

    uint256 public totalAvailable;
    uint256 public totalInPlay;
    uint256 public totalReserved;
    uint256 public bankroll;
    uint256 public accruedFees;
    uint256 public pendingVRFRequests;
    uint256 public activeSessions;

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

    function vrfCoordinator() external view override returns (address) {
        return address(s_vrfCoordinator);
    }

    function availableBalanceOf(address player) external view returns (uint256) {
        return _available[player];
    }

    function inPlayBalanceOf(address player) external view returns (uint256) {
        return _inPlay[player];
    }

    function reservedBalanceOf(address player) external view returns (uint256) {
        return _reserved[player];
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
            if (puckState != PuckState.OFF) revert BetUnavailable(betType, puckState);
            _validateSingleBetAmount(amount, MIN_LINE_BET, MAX_LINE_BET, 1);
            if (session.bets.passLine.amount != 0) revert InvalidAmount(amount);

            _debitAvailable(msg.sender, amount);
            session.bets.passLine.amount = amount;
            session.bets.passLine.oddsAmount = 0;
            session.bets.passLine.point = 0;

            emit BetPlaced(msg.sender, betType, amount);
            return;
        }

        if (betType == BetType.DONT_PASS) {
            if (puckState != PuckState.OFF) revert BetUnavailable(betType, puckState);
            _validateSingleBetAmount(amount, MIN_LINE_BET, MAX_LINE_BET, 1);
            if (session.bets.dontPass.amount != 0) revert InvalidAmount(amount);

            _debitAvailable(msg.sender, amount);
            session.bets.dontPass.amount = amount;
            session.bets.dontPass.oddsAmount = 0;
            session.bets.dontPass.point = 0;

            emit BetPlaced(msg.sender, betType, amount);
            return;
        }

        if (betType == BetType.FIELD) {
            _validateSingleBetAmount(amount, MIN_FIELD_BET, MAX_FIELD_BET, 1);
            uint256 newTotal = session.bets.oneRolls.field + amount;
            if (newTotal > MAX_FIELD_BET) revert InvalidAmount(newTotal);

            _debitAvailable(msg.sender, amount);
            session.bets.oneRolls.field = newTotal;

            emit BetPlaced(msg.sender, betType, amount);
            return;
        }

        revert InvalidBetType(betType);
    }

    function placeIndexedBet(BetType, uint8, uint256) external pure override {
        revert("Phase 4 not implemented");
    }

    function removeBet(BetType betType) external override nonReentrant {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        _requireSessionReady(session);

        if (betType == BetType.DONT_PASS) {
            if (session.point == 0) revert BetUnavailable(betType, PuckState.OFF);

            uint256 returnedAmount = session.bets.dontPass.amount + session.bets.dontPass.oddsAmount;
            if (returnedAmount == 0) revert NoActiveBet(betType);

            delete session.bets.dontPass;
            _creditAvailable(msg.sender, returnedAmount);

            emit BetRemoved(msg.sender, betType, returnedAmount);
            return;
        }

        if (betType == BetType.FIELD) {
            uint256 returnedAmount = session.bets.oneRolls.field;
            if (returnedAmount == 0) revert NoActiveBet(betType);

            session.bets.oneRolls.field = 0;
            _creditAvailable(msg.sender, returnedAmount);

            emit BetRemoved(msg.sender, betType, returnedAmount);
            return;
        }

        revert InvalidBetType(betType);
    }

    function removeIndexedBet(BetType, uint8) external pure override {
        revert("Phase 4 not implemented");
    }

    function setPlaceWorking(uint8, bool) external pure override {
        revert("Phase 4 not implemented");
    }

    function rollDice() external override whenNotPaused notExcluded nonReentrant returns (uint256 requestId) {
        _trackPlayer(msg.sender);

        SessionData storage session = _sessions[msg.sender];
        _requireSessionReady(session);

        if (!_hasPhase3Bet(session.bets)) revert InvalidAmount(0);

        BetSlots memory activeBets = session.bets;
        uint256 worstCase = PayoutMath.maxPossiblePayout(activeBets, session.point);
        if (worstCase > bankroll) revert InsufficientBankroll(bankroll, worstCase);

        _reserveFromBankroll(msg.sender, worstCase);

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

    function _hasPhase3Bet(BetSlots storage bets) internal view returns (bool) {
        return bets.passLine.amount != 0 || bets.dontPass.amount != 0 || bets.oneRolls.field != 0;
    }

    function _isPointNumber(uint8 sum) internal pure returns (bool) {
        return sum == 4 || sum == 5 || sum == 6 || sum == 8 || sum == 9 || sum == 10;
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

        if (session.bets.passLine.amount != 0) {
            uint256 amount = session.bets.passLine.amount;

            if (priorPoint == 0) {
                if (sum == 7 || sum == 11) {
                    returnedToAvailable += amount;
                    payout += amount;
                    delete session.bets.passLine;
                } else if (sum == 2 || sum == 3 || sum == 12) {
                    lostToBankroll += amount;
                    delete session.bets.passLine;
                }
            } else if (sum == priorPoint) {
                returnedToAvailable += amount;
                payout += amount;
                delete session.bets.passLine;
            } else if (sum == 7) {
                lostToBankroll += amount;
                delete session.bets.passLine;
            }
        }

        if (session.bets.dontPass.amount != 0) {
            uint256 amount = session.bets.dontPass.amount;

            if (priorPoint == 0) {
                if (sum == 2 || sum == 3) {
                    returnedToAvailable += amount;
                    payout += amount;
                    delete session.bets.dontPass;
                } else if (sum == 7 || sum == 11) {
                    lostToBankroll += amount;
                    delete session.bets.dontPass;
                }
            } else if (sum == 7) {
                returnedToAvailable += amount;
                payout += amount;
                delete session.bets.dontPass;
            } else if (sum == priorPoint) {
                lostToBankroll += amount;
                delete session.bets.dontPass;
            }
        }

        if (session.bets.oneRolls.field != 0) {
            uint256 amount = session.bets.oneRolls.field;
            returnedToAvailable += amount;

            if (sum == 2 || sum == 12) {
                payout += amount * 2;
            } else if (sum == 3 || sum == 4 || sum == 9 || sum == 10 || sum == 11) {
                payout += amount;
            } else {
                returnedToAvailable -= amount;
                lostToBankroll += amount;
            }

            session.bets.oneRolls.field = 0;
        }

        _softMoveInPlayToAvailable(player, returnedToAvailable);
        _softMoveInPlayToBankroll(player, lostToBankroll);
        uint256 actualPayout = _softReleaseReserve(player, payout);

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
            } else {
                session.point = 0;
                session.phase = SessionPhase.COME_OUT;
            }
        } else if (sum == 7 || sum == priorPoint) {
            session.point = 0;
            session.phase = SessionPhase.COME_OUT;
        } else {
            session.point = priorPoint;
            session.phase = SessionPhase.POINT;
            if (session.bets.passLine.amount != 0) {
                session.bets.passLine.point = priorPoint;
            }
            if (session.bets.dontPass.amount != 0) {
                session.bets.dontPass.point = priorPoint;
            }
        }

        session.pendingRequestId = 0;
        session.lastActivityTime = uint48(block.timestamp);

        emit RollResolved(player, requestId, die1, die2, actualPayout);
    }
}
