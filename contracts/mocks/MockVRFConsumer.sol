// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract MockVRFConsumer is VRFConsumerBaseV2Plus {
    uint256 public lastRequestId;
    uint256 public lastFulfilledRequestId;
    uint256[] public lastRandomWords;

    constructor(address coordinator) VRFConsumerBaseV2Plus(coordinator) {}

    function requestRandomWords(
        bytes32 keyHash,
        uint256 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId) {
        VRFV2PlusClient.RandomWordsRequest memory request = VRFV2PlusClient.RandomWordsRequest({
            keyHash: keyHash,
            subId: subId,
            requestConfirmations: requestConfirmations,
            callbackGasLimit: callbackGasLimit,
            numWords: numWords,
            extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: false}))
        });

        requestId = s_vrfCoordinator.requestRandomWords(request);
        lastRequestId = requestId;
    }

    function getLastRandomWords() external view returns (uint256[] memory) {
        return lastRandomWords;
    }

    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        lastFulfilledRequestId = requestId;
        delete lastRandomWords;
        for (uint256 i = 0; i < randomWords.length; ++i) {
            lastRandomWords.push(randomWords[i]);
        }
    }
}
