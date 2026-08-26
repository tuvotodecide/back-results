import 'dotenv/config';
import { arbitrum, arbitrumSepolia, base, baseSepolia } from 'viem/chains';

const FACTORY = process.env.FACTORY;
const SPONSORSHIP_POLICY = process.env.SPONSORSHIP_POLICY;
export const sponsorshipPolicyId = SPONSORSHIP_POLICY;
export const FACTORY_ADDRESS = FACTORY;
const BUNDLER = process.env.BUNDLER;
const BUNDLER_MAIN = process.env.BUNDLER_MAIN;
const BUNDLER_ARBITRUM = process.env.BUNDLER_ARBITRUM;
const BUNDLER_MAIN_ARBITRUM = process.env.BUNDLER_MAIN_ARBITRUM;
const BASE_SEPOLIA_VOTE_MANAGER_PROXY_ADDRESS =
  '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523';
const OBSOLETE_BASE_SEPOLIA_VOTE_MANAGER_PROXY_ADDRESS =
  '0x7b57ee9103fc46ed6794329c36d2919293f0fabb';

function resolveBaseSepoliaVoteContract() {
  const canonical =
    process.env.VOTE_MANAGER_PROXY_ADDRESS?.trim() ||
    process.env.VOTE_MANAGER_ADDRESS?.trim();
  if (canonical) return canonical;

  const legacy = process.env.TVD_VOTE_MANAGER_ADDRESS?.trim();
  if (
    legacy &&
    legacy.toLowerCase() !== OBSOLETE_BASE_SEPOLIA_VOTE_MANAGER_PROXY_ADDRESS
  ) {
    return legacy;
  }

  return BASE_SEPOLIA_VOTE_MANAGER_PROXY_ADDRESS;
}

export const availableNetworks = {
  'arbitrum-sepolia': {
    chain: arbitrumSepolia,
    bundler: BUNDLER_ARBITRUM,
    explorer: 'https://sepolia.arbiscan.io/',
    nftExplorer: 'https://testnet.routescan.io/nft',
    oracle: '0x824CBE7b7C69e67D3E2A4757Aedb9D3E8eB63C80',
    userRole: '',
    juryRole:
      '0x9f70476b4563c57c3056cc4e8dffc8025828c99ea7a458e33c1502f84b53cc94',
    attestationNft: '0xdCa6d6E8f4E69C3Cf86B656f0bBf9b460727Bed9',
    participationNft: '0x9297845e37731480a090dB0d8eA2e2c65133523e',
  },
  arbitrum: {
    chain: arbitrum,
    bundler: BUNDLER_MAIN_ARBITRUM,
    explorer: 'https://arbiscan.io/',
    nftExplorer: 'https://routescan.io/nft',
    oracle: '0xb558021F42209c4E08Dab884B25b89106Dc7D747',
    userRole:
      '0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96',
    juryRole:
      '0x9f70476b4563c57c3056cc4e8dffc8025828c99ea7a458e33c1502f84b53cc94',
    attestationNft: '0xF81508fC99Ffcfbbb5421150785c9820F8cBA9b2',
    participationNft: '0x9297845e37731480a090dB0d8eA2e2c65133523e',
  },
  'base-sepolia': {
    chain: baseSepolia,
    bundler: BUNDLER,
    explorer: 'https://sepolia.basescan.org/',
    nftExplorer: 'https://testnet.routescan.io/nft',
    oracle: '0x91DB352d9836832364fDa5fFc6d7c8CF6FD78c38',
    userRole:
      '0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96',
    juryRole:
      '0x9f70476b4563c57c3056cc4e8dffc8025828c99ea7a458e33c1502f84b53cc94',
    attestationNft: '0x5D4f9dBD942C8D37dA57F6Ffd64cC9bF45939b0e',
    participationNft: '',
    voteContract: resolveBaseSepoliaVoteContract()
  },
  base: {
    chain: base,
    bundler: BUNDLER_MAIN,
    explorer: 'https://basescan.org/',
    nftExplorer: 'https://routescan.io/nft',
    oracle: '0xF81508fC99Ffcfbbb5421150785c9820F8cBA9b2',
    userRole:
      '0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96',
    juryRole:
      '0x9f70476b4563c57c3056cc4e8dffc8025828c99ea7a458e33c1502f84b53cc94',
    attestationNft: '0xded7aD213240729cEB65c4196f4020d9DbC6C094',
    participationNft: '',
    voteContract: '0x3Dc30890852cfD1875b43965A8D1995697803a92'
  },
};

export const availableNetworkNames = ['arbitrum-sepolia'];

export const gasParams = {
  maxFeePerGas: BigInt(3000000000), // 3 Gwei
  maxPriorityFeePerGas: BigInt(100000000), // 0.1 Gwei (minimum required)
  callGasLimit: BigInt(1000000),
  verificationGasLimit: BigInt(110000),
  preVerificationGas: BigInt(100000),
  paymasterPostOpGasLimit: BigInt(90000),
  paymasterVerificationGasLimit: BigInt(100000),
};
