import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getAddress } from 'viem';

const CURRENT_VOTE_MANAGER_PROXY = '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523';
const OBSOLETE_VOTE_MANAGER_PROXY = '0x7B57eE9103fc46eD6794329C36D2919293F0Fabb';
const TVD_TOKEN = '0xeA5f754B3F731D048388b688eC7910Eb3b797606';
const TVD_ASSIGNMENT = '0xc14f10Afe32fae43D152Cc6Ab758C2b453a35b16';
const CORE_VESTING = '0x314b301d9818E082c9536d02FDA1be68f2969E0E';
const INCENTIVE_CAMPAIGNS = '0x78D7215D20EB2e2DD1F80400E3A9228B0E7166d5';
const ELECTORAL_CREDITS = '0xA1e9cf68769Bd676e536c45c5B0E5215216e511f';
const MULTISIG = '0x5D1E6D936a28041bE5fEE3983289c4Bbef8360e4';

describe('contract runtime configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('Base Sepolia VoteContractCalls resuelve el proxy vigente aunque exista la variable legada obsoleta', () => {
    delete process.env.VOTE_MANAGER_PROXY_ADDRESS;
    delete process.env.VOTE_MANAGER_ADDRESS;
    process.env.TVD_VOTE_MANAGER_ADDRESS = OBSOLETE_VOTE_MANAGER_PROXY;

    const { availableNetworks } = require('@/api/params');

    expect(getAddress(availableNetworks['base-sepolia'].voteContract)).toBe(
      getAddress(CURRENT_VOTE_MANAGER_PROXY),
    );
  });

  it('app.config usa VOTE_MANAGER_PROXY_ADDRESS como fuente canonica antes del nombre legado', () => {
    process.env.VOTE_MANAGER_PROXY_ADDRESS = CURRENT_VOTE_MANAGER_PROXY;
    process.env.TVD_VOTE_MANAGER_ADDRESS = OBSOLETE_VOTE_MANAGER_PROXY;

    const appConfig = require('@/config/app.config').default;
    const config = appConfig();

    expect(getAddress(config.contracts.voteManager.address)).toBe(
      getAddress(CURRENT_VOTE_MANAGER_PROXY),
    );
  });

  it('.env.example expone solo direcciones publicas vigentes y placeholders para secretos', () => {
    const example = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');

    expect(example).toContain(`VOTE_MANAGER_PROXY_ADDRESS=${CURRENT_VOTE_MANAGER_PROXY}`);
    expect(example).toContain(`TVD_VOTE_MANAGER_ADDRESS=${CURRENT_VOTE_MANAGER_PROXY}`);
    expect(example).toContain(`TVD_TOKEN_CONTRACT_ADDRESS=${TVD_TOKEN}`);
    expect(example).toContain(`TVD_TOKEN_ADDRESS=${TVD_TOKEN}`);
    expect(example).toContain(`TVD_ASSIGNMENT_CONTRACT_ADDRESS=${TVD_ASSIGNMENT}`);
    expect(example).toContain(`INSTITUTIONAL_VESTING_ADDRESS=${TVD_ASSIGNMENT}`);
    expect(example).toContain(`CORE_VESTING_ADDRESS=${CORE_VESTING}`);
    expect(example).toContain(`INCENTIVE_CAMPAIGNS_ADDRESS=${INCENTIVE_CAMPAIGNS}`);
    expect(example).toContain(`TVD_ELECTORAL_CREDITS_ADDRESS=${ELECTORAL_CREDITS}`);
    expect(example).toContain(`TVD_MULTISIG_WALLET_ADDRESS=${MULTISIG}`);
    expect(example).toContain('TVD_CHAIN_ID=84532');
    expect(example).toContain('TVD_DECIMALS=18');
    expect(example).toContain('TVD_CONFIRMATIONS_REQUIRED=1');
    expect(example).toContain('TVD_RPC_URL=<BASE_SEPOLIA_RPC_URL>');
    expect(example).toContain('TVD_OPERATOR_PRIVATE_KEY=<OPERATOR_PRIVATE_KEY>');
    expect(example).toContain('REWARD_CALLBACK_URL=<REWARD_CALLBACK_URL>');
    expect(example).not.toContain(OBSOLETE_VOTE_MANAGER_PROXY);
    expect(example).not.toMatch(/developer\.coinbase\.com\/rpc\/v1\/base-sepolia/i);
    expect(example).not.toMatch(/TVD_OPERATOR_PRIVATE_KEY=0x[a-fA-F0-9]{64}/);
  });
});
