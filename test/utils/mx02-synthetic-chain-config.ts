import { availableNetworks } from '@/api/params';

const network = availableNetworks['base-sepolia'];
const original = {
  bundler: network.bundler,
  voteContract: network.voteContract,
};

/**
 * Satisfies only the synchronous configuration guard. Network-facing calls
 * remain mocked by each MX-02 suite and the global external-network guard.
 */
export function installMx02SyntheticChainConfig() {
  network.bundler = 'http://127.0.0.1:65535/mx02-no-network';
  network.voteContract = '0x0000000000000000000000000000000000000001';
}

export function restoreMx02SyntheticChainConfig() {
  network.bundler = original.bundler;
  network.voteContract = original.voteContract;
}
