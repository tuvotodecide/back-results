import { createPublicClient, encodeFunctionData, formatEther, getContract, Hex, http } from "viem";
import { availableNetworks } from "./params";
import votingContractAbi from "../abi/voteContract.json";
import { buildPoseidon } from "circomlibjs";

function idToHex(mongoId: string) {
  return BigInt(`0x${mongoId}`)
}

async function getVoteHash(eventId: string, secret: string) {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const voteIdHex = idToHex(eventId);
  const secretInt = BigInt(secret);
  return F.toObject(poseidon([secretInt, voteIdHex])) as bigint;
}

async function getRewardHash(eventId: string, secret: string) {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const voteClaimIdHex = VoteContractUtils.idToHex(eventId + '2D526577617264'); // + 'reward' in hex
  const secretInt = BigInt(secret);
  return F.toObject(poseidon([secretInt, voteClaimIdHex])) as bigint;
}

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
  options: string[]
) {
  const voteIdUint = BigInt(`0x${voteId}`);

  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'createVote',
      args: [voteIdUint, institutionId, name, startDate, endDate, resultsDate, enabledVotersCount, enabledVotersMkRoot, options],
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
  voteNullifier: bigint,
) {
  const voteIdUint = idToHex(voteId);

  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'castVote',
      args: [optionId, voteIdUint, voteNullifier],
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
      args: [idToHex(voteId)],
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

function claimVoteReward(chainId: string, voteId: string, rewardHash: bigint, recipient: Hex) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'claimVoteReward',
      args: [idToHex(voteId), rewardHash, recipient],
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

function changeInstitutionAdmin(
  chainId: string,
  institutionId: string,
  newAdmin: Hex
) {
  return {
    to: availableNetworks[chainId].voteContract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: votingContractAbi,
      functionName: 'changeInstitutionAdmin',
      args: [institutionId, newAdmin],
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

async function getHashVoted(chainId: string, voteId: string, voteHash: bigint) {
  const vote = getVoteReadContract(chainId);

  try {
    const result = await vote.read.getOwnVoteInfo([idToHex(voteId), voteHash]) as [boolean, string];
    return result[0];
  } catch {
    return false;
  }
}

export const VoteContractUtils = {
  idToHex,
  getVoteHash,
  getRewardHash,
}

export const VoteContractCalls = {
  createVote,
  updateVoteSchedule,
  castVote,
  disableVote,
  createInstitution,
  addAuthorizedAddress,
  removeAuthorizedAddress,
  claimVoteReward,
  changeInstitutionAdmin,
}

export const VoteContractReads = {
  rewardByVote,
  getInstitutionAdmin,
  isAuthorizedAddress,
  getHashVoted,
}
