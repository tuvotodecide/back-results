import { encodeFunctionData, Hex } from "viem";
import contractAbi from "@/abi/incentiveCampaigns.json"

function giveIncentive(
  contractAddress: Hex,
  recipient: Hex
) {
  return {
    to: contractAddress,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contractAbi,
      functionName: 'giveIncentive',
      args: [recipient],
    })
  }
}

export const IncentiveCampaignCalls = {
  giveIncentive
}