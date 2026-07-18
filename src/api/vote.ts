import { encodeFunctionData } from "viem";
import { availableNetworks } from "./params";
import votingContractAbi from "../abi/voteContract.json";

function createVote(
  chainId: string,
  voteId: string,
  institutionId: string,
  name: string,
  startDate: number,
  endDate: number,
  resultsDate: number,
  enabledVotersCount: number,
  enabledVotersMkRoot: bigint,
  registeredVotersMkRoot: bigint,
  options: string[]
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'createVote',
      args: [voteId, institutionId, name, startDate, endDate, resultsDate, enabledVotersCount, enabledVotersMkRoot, registeredVotersMkRoot, options],
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

function castVote(
  chainId: string,
  voteId: string,
  optionId: string,
  nullifier: string
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'castVote',
      args: [voteId, optionId, nullifier],
    })
  }
}

function addNewVoters(
  chainId: string,
  voteId: string,
  newNullifiers: string[]
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'addNewVoters',
      args: [voteId, newNullifiers],
    })
  }
}

function disableVote(
  chainId: string,
  voteId: string
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'disableVote',
      args: [voteId],
    })
  }
}

export const VoteContractCalls = {
  createVote,
  updateVoteSchedule,
  castVote,
  addNewVoters,
  disableVote
}