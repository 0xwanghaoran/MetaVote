// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title MetaVote - FHE powered poll system
/// @notice Allows anyone to create polls, cast encrypted votes, finalize, and verify decrypted results on-chain.
contract MetaVote is ZamaEthereumConfig {
    struct Poll {
        string title;
        string[] options;
        euint32[] tallies;
        uint256 startTime;
        uint256 endTime;
        address creator;
        bool finalized;
        bool resultsPublished;
        uint32[] publicResults;
        bytes publicDecryptionProof;
    }

    Poll[] private polls;
    mapping(uint256 => mapping(address => bool)) private votes;

    event PollCreated(uint256 indexed pollId, string title, uint256 startTime, uint256 endTime);
    event VoteSubmitted(uint256 indexed pollId, address indexed voter);
    event PollFinalized(uint256 indexed pollId);
    event ResultsPublished(uint256 indexed pollId, uint32[] results);

    error InvalidPoll();
    error InvalidWindow();
    error InvalidOptions();
    error PollNotActive();
    error PollAlreadyFinalized();
    error PollNotFinished();
    error AlreadyVoted();
    error MismatchedResults();
    error ResultsAlreadyPublished();

    modifier pollExists(uint256 pollId) {
        if (pollId >= polls.length) {
            revert InvalidPoll();
        }
        _;
    }

    /// @notice Create a new poll with 2-4 options and a voting window.
    /// @param title The poll title.
    /// @param options The option labels (between 2 and 4).
    /// @param startTime Start timestamp for voting.
    /// @param endTime End timestamp for voting.
    /// @return pollId Identifier of the created poll.
    function createPoll(
        string memory title,
        string[] memory options,
        uint256 startTime,
        uint256 endTime
    ) external returns (uint256 pollId) {
        if (options.length < 2 || options.length > 4) {
            revert InvalidOptions();
        }
        if (startTime >= endTime || endTime <= block.timestamp) {
            revert InvalidWindow();
        }

        pollId = polls.length;
        polls.push();
        Poll storage poll = polls[pollId];

        poll.title = title;
        poll.startTime = startTime;
        poll.endTime = endTime;
        poll.creator = msg.sender;

        for (uint256 i = 0; i < options.length; i++) {
            poll.options.push(options[i]);
            poll.tallies.push(FHE.asEuint32(0));
            FHE.allowThis(poll.tallies[i]);
        }

        emit PollCreated(pollId, title, startTime, endTime);
    }

    /// @notice Cast an encrypted vote for a poll option.
    /// @param pollId Target poll id.
    /// @param encryptedChoice Encrypted option index (0-based).
    /// @param inputProof Input proof from the relayer encryption.
    function castVote(
        uint256 pollId,
        externalEuint32 encryptedChoice,
        bytes calldata inputProof
    ) external pollExists(pollId) {
        Poll storage poll = polls[pollId];

        if (block.timestamp < poll.startTime || block.timestamp >= poll.endTime) {
            revert PollNotActive();
        }
        if (poll.finalized) {
            revert PollAlreadyFinalized();
        }
        if (votes[pollId][msg.sender]) {
            revert AlreadyVoted();
        }
        votes[pollId][msg.sender] = true;

        euint32 choice = FHE.fromExternal(encryptedChoice, inputProof);

        for (uint256 i = 0; i < poll.options.length; i++) {
            ebool selected = FHE.eq(choice, FHE.asEuint32(uint32(i)));
            euint32 incremented = FHE.add(poll.tallies[i], FHE.asEuint32(1));
            poll.tallies[i] = FHE.select(selected, incremented, poll.tallies[i]);
            FHE.allowThis(poll.tallies[i]);
        }

        emit VoteSubmitted(pollId, msg.sender);
    }

    /// @notice Finalize a poll once the voting window has ended. Marks tallies as publicly decryptable.
    /// @param pollId Target poll id.
    function finalizePoll(uint256 pollId) external pollExists(pollId) {
        Poll storage poll = polls[pollId];
        if (block.timestamp < poll.endTime) {
            revert PollNotFinished();
        }
        if (poll.finalized) {
            revert PollAlreadyFinalized();
        }

        poll.finalized = true;
        for (uint256 i = 0; i < poll.tallies.length; i++) {
            poll.tallies[i] = FHE.makePubliclyDecryptable(poll.tallies[i]);
        }

        emit PollFinalized(pollId);
    }

    /// @notice Publish decrypted tallies on-chain with KMS proof verification.
    /// @param pollId Target poll id.
    /// @param clearTallies Decrypted tallies matching the poll options.
    /// @param decryptionProof KMS proof returned by the relayer.
    function publishResults(
        uint256 pollId,
        uint32[] calldata clearTallies,
        bytes calldata decryptionProof
    ) external pollExists(pollId) {
        Poll storage poll = polls[pollId];
        if (!poll.finalized) {
            revert PollNotFinished();
        }
        if (poll.resultsPublished) {
            revert ResultsAlreadyPublished();
        }
        if (clearTallies.length != poll.options.length) {
            revert MismatchedResults();
        }

        bytes32[] memory handles = new bytes32[](poll.tallies.length);
        for (uint256 i = 0; i < poll.tallies.length; i++) {
            handles[i] = euint32.unwrap(poll.tallies[i]);
        }

        FHE.checkSignatures(handles, abi.encode(clearTallies), decryptionProof);

        poll.publicResults = clearTallies;
        poll.resultsPublished = true;
        poll.publicDecryptionProof = decryptionProof;

        emit ResultsPublished(pollId, clearTallies);
    }

    /// @notice Get total poll count.
    function getPollCount() external view returns (uint256) {
        return polls.length;
    }

    /// @notice Get poll metadata.
    function getPollSummary(uint256 pollId)
        external
        view
        pollExists(pollId)
        returns (
            string memory title,
            uint256 startTime,
            uint256 endTime,
            uint256 optionCount,
            bool finalized,
            bool resultsPublished,
            address creator
        )
    {
        Poll storage poll = polls[pollId];
        return (
            poll.title,
            poll.startTime,
            poll.endTime,
            poll.options.length,
            poll.finalized,
            poll.resultsPublished,
            poll.creator
        );
    }

    /// @notice Get poll options.
    function getPollOptions(uint256 pollId) external view pollExists(pollId) returns (string[] memory) {
        return polls[pollId].options;
    }

    /// @notice Get encrypted tallies handles for a poll.
    function getEncryptedTallies(uint256 pollId) external view pollExists(pollId) returns (euint32[] memory) {
        return polls[pollId].tallies;
    }

    /// @notice Get published results if available.
    function getPublishedResults(uint256 pollId)
        external
        view
        pollExists(pollId)
        returns (uint32[] memory results, bytes memory proof)
    {
        Poll storage poll = polls[pollId];
        return (poll.publicResults, poll.publicDecryptionProof);
    }

    /// @notice Check if an address has voted in a poll.
    function hasUserVoted(uint256 pollId, address user) external view pollExists(pollId) returns (bool) {
        return votes[pollId][user];
    }
}
