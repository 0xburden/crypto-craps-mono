// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICrapsGame {
    enum BetType {
        PASS_LINE,
        PASS_LINE_ODDS,
        DONT_PASS,
        DONT_PASS_ODDS,
        COME,
        COME_ODDS,
        DONT_COME,
        DONT_COME_ODDS,
        PLACE_4,
        PLACE_5,
        PLACE_6,
        PLACE_8,
        PLACE_9,
        PLACE_10,
        FIELD,
        HARD_4,
        HARD_6,
        HARD_8,
        HARD_10,
        ANY_7,
        ANY_CRAPS,
        CRAPS_2,
        CRAPS_3,
        YO,
        TWELVE,
        HORN
    }

    enum PuckState {
        OFF,
        ON
    }

    enum SessionPhase {
        INACTIVE,
        COME_OUT,
        POINT,
        ROLL_PENDING
    }

    struct Bet {
        uint256 amount;
        uint256 oddsAmount;
        uint8 point;
    }

    struct PlaceBet {
        uint256 amount;
        bool working;
    }

    struct HardwayBet {
        uint256 amount;
    }

    struct OneRollBets {
        uint256 field;
        uint256 any7;
        uint256 anyCraps;
        uint256 craps2;
        uint256 craps3;
        uint256 yo;
        uint256 twelve;
        uint256 horn;
    }

    struct BetSlots {
        Bet passLine;
        Bet dontPass;
        Bet[4] come;
        Bet[4] dontCome;
        PlaceBet place4;
        PlaceBet place5;
        PlaceBet place6;
        PlaceBet place8;
        PlaceBet place9;
        PlaceBet place10;
        HardwayBet hard4;
        HardwayBet hard6;
        HardwayBet hard8;
        HardwayBet hard10;
        OneRollBets oneRolls;
    }

    struct PlayerState {
        SessionPhase phase;
        PuckState puckState;
        uint8 point;
        uint48 lastActivityTime;
        uint256 pendingRequestId;
        uint256 available;
        uint256 inPlay;
        uint256 reserved;
        uint256 bankroll;
        uint256 totalBankroll;
        uint256 initialBankroll;
        uint256 accruedFees;
        bool paused;
        bool selfExcluded;
        bool operatorExcluded;
        uint256 reinstatementEligibleAt;
        BetSlots bets;
    }

    error ZeroAmount();
    error InvalidAmount(uint256 amount);
    error InvalidMultiple(uint256 amount, uint256 requiredMultiple);
    error InvalidBetType(BetType betType);
    error InvalidPoint(uint8 point);
    error InvalidIndex(uint8 index);
    error SessionNotActive();
    error SessionAlreadyActive();
    error SessionRollPending();
    error NoActiveBet(BetType betType);
    error BetUnavailable(BetType betType, PuckState puckState);
    error InsufficientBalance(uint256 available, uint256 requiredAmount);
    error InsufficientBankroll(uint256 bankroll, uint256 requiredReserve);
    error PlayerExcluded(address player);
    error NotEligibleForReinstatement(uint256 eligibleAt);

    event Deposit(address indexed player, uint256 amount, uint256 fee);
    event Withdrawal(address indexed player, uint256 amount);
    event SessionOpened(address indexed player);
    event SessionClosed(address indexed player, uint256 returnedAmount);
    event SessionExpired(address indexed player, uint256 returnedAmount);
    event BetPlaced(address indexed player, BetType indexed betType, uint256 amount);
    event BetRemoved(address indexed player, BetType indexed betType, uint256 amount);
    event RollRequested(address indexed player, uint256 indexed requestId, uint256 reservedAmount);
    event RollResolved(address indexed player, uint256 indexed requestId, uint8 die1, uint8 die2, uint256 payout);
    event SelfExcluded(address indexed player);
    event SelfReinstatementRequested(address indexed player, uint256 eligibleAt);
    event SelfReinstated(address indexed player);
    event OperatorExcluded(address indexed player);
    event OperatorReinstated(address indexed player);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event BankrollFunded(address indexed by, uint256 amount);
    event BankrollWithdrawn(address indexed to, uint256 amount);

    function token() external view returns (address);
    function vrfCoordinator() external view returns (address);

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function withdrawFees(address to) external;
    function fundBankroll(uint256 amount) external;
    function withdrawBankroll(uint256 amount) external;

    function openSession() external;
    function closeSession() external;
    function expireSession(address player) external;

    function selfExclude() external;
    function requestSelfReinstatement() external;
    function completeSelfReinstatement() external;
    function operatorExclude(address player) external;
    function operatorReinstate(address player) external;

    function placeBet(BetType betType, uint256 amount) external;
    function placeIndexedBet(BetType betType, uint8 index, uint256 amount) external;
    function removeBet(BetType betType) external;
    function removeIndexedBet(BetType betType, uint8 index) external;
    function setPlaceWorking(uint8 placeNumber, bool working) external;

    function rollDice() external returns (uint256 requestId);
    function getPlayerState(address player) external view returns (PlayerState memory);
}
