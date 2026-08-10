import votingContractAbi from '@/abi/voteContract.json';
import { availableNetworks } from '@/api/params';
import { VoteContractCalls } from '@/api/vote';
import { decodeFunctionData, getAddress, type Hex } from 'viem';

type AbiItem = {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: Array<{ name: string; type: string; indexed?: boolean }>;
  outputs?: Array<{ name?: string; type: string }>;
};

const abi = votingContractAbi as AbiItem[];
const chainId = 'base-sepolia';
const stableInstitutionId = 'institution-stable-id';
const primaryAdmin = '0x1111111111111111111111111111111111111111' as Hex;
const secondaryAdmin = '0x2222222222222222222222222222222222222222' as Hex;
const nextPrimaryAdmin = '0x3333333333333333333333333333333333333333' as Hex;

const selectors = {
  createInstitution: '0xe748f568',
  addAuthorizedAddress: '0x7a147472',
  removeAuthorizedAddress: '0x670acf99',
  changeInstitutionAdmin: '0xb98f2239',
  getInstitutionAdmin: '0xfdea7af0',
  isAuthorizedAddress: '0xc0523449',
};

function findFunction(name: string) {
  return abi.find((item) => item.type === 'function' && item.name === name);
}

function findEvent(name: string) {
  return abi.find((item) => item.type === 'event' && item.name === name);
}

function expectFunction(
  name: string,
  inputTypes: string[],
  outputTypes: string[],
  stateMutability: string,
) {
  const fragment = findFunction(name);
  expect(fragment).toBeDefined();
  expect(fragment?.inputs?.map((input) => input.type)).toEqual(inputTypes);
  expect(fragment?.outputs?.map((output) => output.type) ?? []).toEqual(outputTypes);
  expect(fragment?.stateMutability).toBe(stateMutability);
}

function expectDecodedCall(
  call: { to: string; value: bigint; data: Hex },
  functionName: string,
  args: unknown[],
) {
  expect(getAddress(call.to)).toBe(
    getAddress((availableNetworks as unknown as Record<string, { voteContract: string }>)[chainId].voteContract),
  );
  expect(call.value).toBe(0n);
  expect(call.data.slice(0, 10)).toBe(selectors[functionName as keyof typeof selectors]);
  const decoded = decodeFunctionData({
    abi: votingContractAbi,
    data: call.data,
  });
  expect(decoded.functionName).toBe(functionName);
  expect(decoded.args).toEqual(args);
}

describe('D-SEC institutional vote contract ABI and wrappers', () => {
  it('[MX-02][D-SEC-001][UNITARIA] createInstitution usa ABI vigente, proxy configurado y evento InstitutionCreated', () => {
    expectFunction('createInstitution', ['string', 'address'], [], 'nonpayable');
    expectFunction('getInstitutionAdmin', ['string'], ['address'], 'view');

    const created = findEvent('InstitutionCreated');
    expect(created?.inputs?.map((input) => ({
      name: input.name,
      type: input.type,
      indexed: Boolean(input.indexed),
    }))).toEqual([
      { name: 'id', type: 'string', indexed: true },
      { name: 'admin', type: 'address', indexed: false },
    ]);

    expectDecodedCall(
      VoteContractCalls.createInstitution(chainId, stableInstitutionId, primaryAdmin),
      'createInstitution',
      [stableInstitutionId, primaryAdmin],
    );
  });

  it('[MX-02][D-SEC-002][UNITARIA] addAuthorizedAddress e isAuthorizedAddress usan la ABI vigente', () => {
    expectFunction('addAuthorizedAddress', ['string', 'address'], [], 'nonpayable');
    expectFunction('isAuthorizedAddress', ['string', 'address'], ['bool'], 'view');
    expect(findEvent('AuthorizedAddressAdded')).toBeUndefined();

    expectDecodedCall(
      VoteContractCalls.addAuthorizedAddress(chainId, stableInstitutionId, secondaryAdmin),
      'addAuthorizedAddress',
      [stableInstitutionId, secondaryAdmin],
    );
  });

  it('[MX-02][D-SEC-003][UNITARIA] removeAuthorizedAddress e isAuthorizedAddress usan la ABI vigente', () => {
    expectFunction('removeAuthorizedAddress', ['string', 'address'], [], 'nonpayable');
    expectFunction('isAuthorizedAddress', ['string', 'address'], ['bool'], 'view');
    expect(findEvent('AuthorizedAddressRemoved')).toBeUndefined();

    expectDecodedCall(
      VoteContractCalls.removeAuthorizedAddress(chainId, stableInstitutionId, secondaryAdmin),
      'removeAuthorizedAddress',
      [stableInstitutionId, secondaryAdmin],
    );
  });

  it('[MX-02][D-SEC-004][UNITARIA] changeInstitutionAdmin usa ABI vigente, lectura getInstitutionAdmin y evento InstitutionAdminChanged', () => {
    expectFunction('changeInstitutionAdmin', ['string', 'address'], [], 'nonpayable');
    expectFunction('getInstitutionAdmin', ['string'], ['address'], 'view');

    const changed = findEvent('InstitutionAdminChanged');
    expect(changed?.inputs?.map((input) => ({
      name: input.name,
      type: input.type,
      indexed: Boolean(input.indexed),
    }))).toEqual([
      { name: 'id', type: 'string', indexed: true },
      { name: 'newAdmin', type: 'address', indexed: false },
    ]);

    expectDecodedCall(
      VoteContractCalls.changeInstitutionAdmin(chainId, stableInstitutionId, nextPrimaryAdmin),
      'changeInstitutionAdmin',
      [stableInstitutionId, nextPrimaryAdmin],
    );
  });
});
