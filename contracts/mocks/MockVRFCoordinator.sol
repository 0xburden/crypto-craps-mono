// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFV2PlusConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

contract MockVRFCoordinator is IVRFCoordinatorV2Plus {
    struct Subscription {
        uint96 balance;
        uint96 nativeBalance;
        uint64 reqCount;
        address owner;
        address pendingOwner;
        address[] consumers;
    }

    struct PendingRequest {
        address consumer;
        uint256 subId;
        bytes32 keyHash;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
        bool exists;
    }

    uint256 private _nextSubscriptionId = 1;
    uint256 private _nextRequestId = 1;
    uint256[] private _activeSubscriptionIds;

    mapping(uint256 => Subscription) private _subscriptions;
    mapping(uint256 => PendingRequest) public pendingRequests;
    mapping(uint256 => uint256) private _pendingRequestCountBySubId;

    event SubscriptionCreated(uint256 indexed subId, address indexed owner);
    event RandomWordsRequested(uint256 indexed requestId, uint256 indexed subId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId, address indexed consumer, uint256[] words);

    function createSubscription() external returns (uint256 subId) {
        subId = _nextSubscriptionId++;
        Subscription storage subscription = _subscriptions[subId];
        subscription.owner = msg.sender;
        _activeSubscriptionIds.push(subId);
        emit SubscriptionCreated(subId, msg.sender);
    }

    function addConsumer(uint256 subId, address consumer) external {
        Subscription storage subscription = _requireSubscription(subId);
        require(msg.sender == subscription.owner, "only owner");
        if (!_isConsumer(subscription, consumer)) {
            subscription.consumers.push(consumer);
        }
    }

    function removeConsumer(uint256 subId, address consumer) external {
        Subscription storage subscription = _requireSubscription(subId);
        require(msg.sender == subscription.owner, "only owner");

        uint256 length = subscription.consumers.length;
        for (uint256 i = 0; i < length; ++i) {
            if (subscription.consumers[i] == consumer) {
                subscription.consumers[i] = subscription.consumers[length - 1];
                subscription.consumers.pop();
                return;
            }
        }
    }

    function cancelSubscription(uint256 subId, address) external {
        Subscription storage subscription = _requireSubscription(subId);
        require(msg.sender == subscription.owner, "only owner");
        delete _subscriptions[subId];
    }

    function acceptSubscriptionOwnerTransfer(uint256 subId) external {
        Subscription storage subscription = _requireSubscription(subId);
        require(msg.sender == subscription.pendingOwner, "only pending owner");
        subscription.owner = msg.sender;
        subscription.pendingOwner = address(0);
    }

    function requestSubscriptionOwnerTransfer(uint256 subId, address newOwner) external {
        Subscription storage subscription = _requireSubscription(subId);
        require(msg.sender == subscription.owner, "only owner");
        subscription.pendingOwner = newOwner;
    }

    function getSubscription(
        uint256 subId
    )
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)
    {
        Subscription storage subscription = _requireSubscription(subId);
        return (
            subscription.balance,
            subscription.nativeBalance,
            subscription.reqCount,
            subscription.owner,
            subscription.consumers
        );
    }

    function pendingRequestExists(uint256 subId) external view returns (bool) {
        return _pendingRequestCountBySubId[subId] > 0;
    }

    function getActiveSubscriptionIds(uint256 startIndex, uint256 maxCount) external view returns (uint256[] memory) {
        uint256 total = _activeSubscriptionIds.length;
        if (startIndex >= total) {
            return new uint256[](0);
        }

        uint256 count = maxCount == 0 || startIndex + maxCount > total ? total - startIndex : maxCount;
        uint256[] memory page = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            page[i] = _activeSubscriptionIds[startIndex + i];
        }
        return page;
    }

    function fundSubscriptionWithNative(uint256 subId) external payable {
        Subscription storage subscription = _requireSubscription(subId);
        subscription.nativeBalance += uint96(msg.value);
    }

    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata req
    ) external returns (uint256 requestId) {
        Subscription storage subscription = _requireSubscription(req.subId);
        require(_isConsumer(subscription, msg.sender), "consumer not authorized");

        requestId = _nextRequestId++;
        subscription.reqCount += 1;
        _pendingRequestCountBySubId[req.subId] += 1;

        pendingRequests[requestId] = PendingRequest({
            consumer: msg.sender,
            subId: req.subId,
            keyHash: req.keyHash,
            requestConfirmations: req.requestConfirmations,
            callbackGasLimit: req.callbackGasLimit,
            numWords: req.numWords,
            extraArgs: req.extraArgs,
            exists: true
        });

        emit RandomWordsRequested(requestId, req.subId, msg.sender);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] calldata words) external {
        PendingRequest memory request = pendingRequests[requestId];
        require(request.exists, "request not found");
        require(words.length == request.numWords, "wrong word count");

        delete pendingRequests[requestId];
        _pendingRequestCountBySubId[request.subId] -= 1;

        IVRFV2PlusConsumer(request.consumer).rawFulfillRandomWords(requestId, words);
        emit RandomWordsFulfilled(requestId, request.consumer, words);
    }

    function _requireSubscription(uint256 subId) private view returns (Subscription storage subscription) {
        subscription = _subscriptions[subId];
        require(subscription.owner != address(0), "subscription not found");
    }

    function _isConsumer(Subscription storage subscription, address consumer) private view returns (bool) {
        for (uint256 i = 0; i < subscription.consumers.length; ++i) {
            if (subscription.consumers[i] == consumer) {
                return true;
            }
        }
        return false;
    }
}
