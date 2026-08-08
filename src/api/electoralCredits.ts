import { encodeFunctionData } from "viem"
import creditsAbi from "../abi/electoralCredits.json";
import { VoteContractUtils } from "./vote";

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

export const CreditsContractCalls = {
  liquidate,
}