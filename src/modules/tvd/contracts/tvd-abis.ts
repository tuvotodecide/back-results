import tvdAssignmentAbi from './abis/tvd-assignment.abi.json';
import tvdTokenAbi from './abis/tvd-token.abi.json';

export const TVD_TOKEN_ABI = tvdTokenAbi;
export const TVD_ASSIGNMENT_ABI = tvdAssignmentAbi;
export const TVD_ELECTORAL_CREDITS_ABI = [
  {
    type: 'function',
    name: 'OPERATOR_ROLE',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'DEFAULT_ADMIN_ROLE',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasRole',
    inputs: [
      { name: 'role', type: 'bytes32', internalType: 'bytes32' },
      { name: 'account', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
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
    name: 'maxTokenPerElection',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'topUp',
    inputs: [
      { name: 'institution', type: 'address', internalType: 'address' },
      { name: 'electionId', type: 'uint256', internalType: 'uint256' },
      { name: 'creditsToBuy', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setOperator',
    inputs: [
      { name: 'operator', type: 'address', internalType: 'address' },
      { name: 'authorized', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getElection',
    inputs: [{ name: 'electionId', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      { name: 'institution', type: 'address', internalType: 'address' },
      { name: 'creditBalance', type: 'uint256', internalType: 'uint256' },
      { name: 'lockedTVD', type: 'uint256', internalType: 'uint256' },
      { name: 'pendingTVD', type: 'uint256', internalType: 'uint256' },
      { name: 'startCreditBalance', type: 'uint256', internalType: 'uint256' },
      { name: 'startLockedTVD', type: 'uint256', internalType: 'uint256' },
      { name: 'liquidated', type: 'bool', internalType: 'bool' },
      { name: 'burnedTVD', type: 'uint256', internalType: 'uint256' },
      { name: 'consumedTVD', type: 'uint256', internalType: 'uint256' },
      { name: 'refundedTVD', type: 'uint256', internalType: 'uint256' },
    ],
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
    name: 'OperatorUpdated',
    inputs: [
      { name: 'operator', type: 'address', indexed: true, internalType: 'address' },
      { name: 'authorized', type: 'bool', indexed: false, internalType: 'bool' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RoleGranted',
    inputs: [
      { name: 'role', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'account', type: 'address', indexed: true, internalType: 'address' },
      { name: 'sender', type: 'address', indexed: true, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RoleRevoked',
    inputs: [
      { name: 'role', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'account', type: 'address', indexed: true, internalType: 'address' },
      { name: 'sender', type: 'address', indexed: true, internalType: 'address' },
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
