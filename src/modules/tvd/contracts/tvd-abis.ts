import tvdAssignmentAbi from './abis/tvd-assignment.abi.json';
import tvdTokenAbi from './abis/tvd-token.abi.json';

export const TVD_TOKEN_ABI = tvdTokenAbi;
export const TVD_ASSIGNMENT_ABI = tvdAssignmentAbi;
export const TVD_ELECTORAL_CREDITS_ABI = [
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract IERC20' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tvdPerCredit',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'authorizedOperators',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'TopUp',
    inputs: [
      { name: 'institution', type: 'address', indexed: true, internalType: 'address' },
      { name: 'electionId', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'creditsPurchased', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'tvdLocked', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'VoteConsumed',
    inputs: [
      { name: 'institution', type: 'address', indexed: true, internalType: 'address' },
      { name: 'electionId', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'tvdAccrued', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
] as const;
