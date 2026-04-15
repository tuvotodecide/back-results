import { encodeFunctionData } from "viem";
import { availableNetworks } from "./params";
import votingContractAbi from "../abi/voteContract.json";

function createVote(
  chainId: string,
  voteId: string,
  name: string,
  startDate: number,
  endDate: number,
  resultsDate: number,
  voters: string[],
  options: string[]
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'createVote',
      args: [voteId, name, startDate, endDate, resultsDate, voters, options],
    })
  }
}

function updateVoteSchedule(
  chainId: string,
  voteId: string,
  startDate: number,
  endDate: number,
  resultsDate: number,
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'updateVoteDates',
      args: [voteId, startDate, endDate, resultsDate],
    })
  }
}

export const VoteContractCalls = {
  createVote,
  updateVoteSchedule,
}