export const votingContractAbi = [
  "function getVoteResults(uint256 voteId) external view returns (string[] memory options, uint256[] memory voteCounts)",
  "function getVoteInfo(uint256 voteId) external view returns (string memory name, uint48 startDate, uint48 endDate, uint48 resultsDate, uint48 totalVoters, uint256 totalVotersMkRoot, string[] memory options)"
];