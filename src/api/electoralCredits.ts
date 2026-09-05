import { Abi, encodeFunctionData } from "viem"
import creditsAbi from "../abi/electoralCredits.json";
import { VoteContractUtils } from "./vote";
import { getReadContract } from "./account";

function liquidate(contract: string, voteId: string) {
  return {
    to: contract,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: creditsAbi,
      functionName: 'liquidate',
      args: [VoteContractUtils.idToHex(voteId)],
    })
  }
}

async function tvdPerCredit(chainId: string, address: string) {
  const contract = getReadContract(chainId, address, creditsAbi as Abi);
  const tvdPerCredit = await contract.read.tvdPerCredit();

  if(typeof tvdPerCredit === 'bigint') {
    return tvdPerCredit;
  } else {
    throw new Error('On-chain vote reward is not bigint');
  }
}

export const CreditsContractCalls = {
  liquidate,
  tvdPerCredit,
}