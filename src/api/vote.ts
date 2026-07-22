import { encodeFunctionData, Hex } from "viem";
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
  const voteIdUint = BigInt(`0x${voteId}`);

  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'createVote',
      args: [voteIdUint, institutionId, name, startDate, endDate, resultsDate, enabledVotersCount, enabledVotersMkRoot, registeredVotersMkRoot, options],
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
  voteNullifier: string,
  rewardHash: string,
  pa: string[],
  pb: string[][],
  pc: string[],
) {
  const voteIdUint = BigInt(`0x${voteId}`);

  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'castVote',
      args: [optionId, voteIdUint, voteNullifier, rewardHash, pa, pb, pc],
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

function createInstitution(
  chainId: string,
  institutionId: string,
  admin: Hex
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'createInstitution',
      args: [institutionId, admin],
    })
  }
}

export const VoteContractCalls = {
  createVote,
  updateVoteSchedule,
  castVote,
  addNewVoters,
  disableVote,
  createInstitution
}