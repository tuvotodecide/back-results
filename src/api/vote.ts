import { createPublicClient, encodeFunctionData, formatEther, getContract, Hex, http } from "viem";
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
  const swappedPb = pb.map(p => p.reverse());

  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'castVote',
      args: [optionId, voteIdUint, voteNullifier, rewardHash, pa, swappedPb, pc],
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

function addAuthorizedAddress(
  chainId: string,
  institutionId: string,
  address: Hex
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'addAuthorizedAddress',
      args: [institutionId, address],
    })
  }
}

function removeAuthorizedAddress(
  chainId: string,
  institutionId: string,
  address: Hex
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'removeAuthorizedAddress',
      args: [institutionId, address],
    })
  }
}

function getVoteReadContract(chainId: string) {
  const { voteContract, bundler, chain } = availableNetworks[chainId];

  const publicClient = createPublicClient({
    chain,
    transport: http(bundler),
  });

  const vote = getContract({
    address: voteContract,
    abi: votingContractAbi,
    client: {public: publicClient},
  });

  return vote;
}

function voteIdToHex(voteId: string) {
  return BigInt(`0x${voteId}`);
}

async function rewardByVote(chainId: string) {
  const vote = getVoteReadContract(chainId);
  const reward = await vote.read.rewardByVote();

  if(typeof reward === 'bigint') {
    return BigInt(formatEther(reward));
  } else {
    throw new Error('On-chain vote reward is not bigint');
  }
}

async function getInstitutionAdmin(chainId: string, institutionId: string) {
  const vote = getVoteReadContract(chainId);
  return vote.read.getInstitutionAdmin([institutionId]);
}

async function isAuthorizedAddress(chainId: string, institutionId: string, address: Hex) {
  const vote = getVoteReadContract(chainId);
  return vote.read.isAuthorizedAddress([institutionId, address]);
}

export const VoteContractCalls = {
  createVote,
  updateVoteSchedule,
  castVote,
  addNewVoters,
  disableVote,
  createInstitution,
  addAuthorizedAddress,
  removeAuthorizedAddress,
}

export const VoteContractReads = {
  rewardByVote,
  getInstitutionAdmin,
  isAuthorizedAddress,
}
