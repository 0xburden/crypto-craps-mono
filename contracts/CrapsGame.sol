// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICrapsGame} from "./interfaces/ICrapsGame.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";

contract CrapsGame is ICrapsGame, VRFConsumerBaseV2Plus, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant DEPOSIT_FEE_BPS = 50;
    uint256 public constant MIN_BANKROLL = 10_000e6;
    uint256 public constant INITIAL_BANKROLL = 50_000e6;

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

    uint256 public totalAvailable;
    uint256 public totalInPlay;
    uint256 public totalReserved;
    uint256 public bankroll;
    uint256 public accruedFees;
    uint256 public pendingVRFRequests;
    uint256 public activeSessions;

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

    function deposit(uint256 amount) external override whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();

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

    /* solcoverage ignore next */
    function openSession() external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function closeSession() external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function expireSession(address) external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function selfExclude() external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function requestSelfReinstatement() external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function completeSelfReinstatement() external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function operatorExclude(address) external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function operatorReinstate(address) external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function placeBet(BetType, uint256) external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function placeIndexedBet(BetType, uint8, uint256) external pure override {
        revert("Phase 4 not implemented");
    }

    /* solcoverage ignore next */
    function removeBet(BetType) external pure override {
        revert("Phase 3 not implemented");
    }

    /* solcoverage ignore next */
    function removeIndexedBet(BetType, uint8) external pure override {
        revert("Phase 4 not implemented");
    }

    /* solcoverage ignore next */
    function setPlaceWorking(uint8, bool) external pure override {
        revert("Phase 4 not implemented");
    }

    /* solcoverage ignore next */
    function rollDice() external pure override returns (uint256) {
        revert("Phase 3 not implemented");
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

        _assertInvariantIfNeeded();
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

        _assertInvariantIfNeeded();
    }

    function _reserveFromBankroll(address player, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (amount > bankroll) revert InsufficientBankroll(bankroll, amount);

        unchecked {
            bankroll -= amount;
            _reserved[player] += amount;
            totalReserved += amount;
        }

        _assertInvariantIfNeeded();
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

        _assertInvariantIfNeeded();
    }

    function _assertInvariant() internal view {
        uint256 trackedBalance = totalAvailable + totalInPlay + totalReserved + bankroll + accruedFees;
        assert(i_token.balanceOf(address(this)) == trackedBalance);
    }

    function _assertInvariantIfNeeded() internal view {
        if (DEBUG) {
            _assertInvariant();
        }
    }

    /* solcoverage ignore next */
    function fulfillRandomWords(uint256, uint256[] calldata) internal override {}
}
