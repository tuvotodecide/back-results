const mockReadContract = jest.fn();
const mockWaitForTransactionReceipt = jest.fn();
const mockSendTransaction = jest.fn();
const mockEncodeFunctionData = jest.fn();
const mockCreatePublicClient = jest.fn();
const mockCreateWalletClient = jest.fn();
const mockCreatePimlicoClient = jest.fn();
const mockToSimpleSmartAccount = jest.fn();
const mockCreateSmartAccountClient = jest.fn();

jest.mock('viem', () => ({
  createPublicClient: (...args: any[]) => mockCreatePublicClient(...args),
  createWalletClient: (...args: any[]) => mockCreateWalletClient(...args),
  http: jest.fn((url: string) => ({ url })),
  encodeFunctionData: (...args: any[]) => mockEncodeFunctionData(...args),
}));

jest.mock('viem/accounts', () => ({
  privateKeyToAccount: jest.fn((privateKey: string) => ({
    privateKey,
    address: '0xResolver',
  })),
}));

jest.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
  baseSepolia: { id: 84532, name: 'Base Sepolia' },
  arbitrum: { id: 42161, name: 'Arbitrum' },
  arbitrumSepolia: { id: 421614, name: 'Arbitrum Sepolia' },
}));

jest.mock('permissionless/clients/pimlico', () => ({
  createPimlicoClient: (...args: any[]) => mockCreatePimlicoClient(...args),
}));

jest.mock('permissionless/accounts', () => ({
  toSimpleSmartAccount: (...args: any[]) => mockToSimpleSmartAccount(...args),
}));

jest.mock('permissionless', () => ({
  createSmartAccountClient: (...args: any[]) => mockCreateSmartAccountClient(...args),
}));

jest.mock('viem/account-abstraction', () => ({
  entryPoint07Address: '0xEntryPoint',
}));

jest.mock('@/modules/attestation/abi/AttestationOracle.json', () => [
  { type: 'function', name: 'resolve' },
]);

import { ConfigService } from '@nestjs/config';
import { OracleResolverService } from '@/modules/attestation/services/oracle-resolver.service';

describe('OracleResolverService (unit)', () => {
  let service: OracleResolverService;

  function config(overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
      RESOLVER_KEY: '0xprivate',
      RPC_URL: 'https://mock-rpc.local',
      CHAIN: 'base-sepolia',
      ORACLE_ADDRESS: '0xOracle',
      ...overrides,
    };
    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadContract.mockReset();
    mockWaitForTransactionReceipt.mockReset();
    mockSendTransaction.mockReset();
    mockEncodeFunctionData.mockReset();

    mockReadContract.mockResolvedValue([1, 7n]);
    mockWaitForTransactionReceipt.mockResolvedValue({});
    mockSendTransaction.mockResolvedValue('0xtx');
    mockEncodeFunctionData.mockReturnValue('0xencoded');
    mockCreatePublicClient.mockReturnValue({
      readContract: mockReadContract,
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
    });
    mockCreateWalletClient.mockReturnValue({
      sendTransaction: mockSendTransaction,
    });
    mockCreatePimlicoClient.mockReturnValue({
      getUserOperationGasPrice: jest.fn(),
    });
    mockToSimpleSmartAccount.mockResolvedValue({ address: '0xSmartAccount' });
    mockCreateSmartAccountClient.mockReturnValue({
      sendTransaction: mockSendTransaction,
    });

    service = new OracleResolverService(config());
  });

  it('[REC-PAR-P0-006] no envia transaccion contractual mockeada si no hay items pendientes', async () => {
    await expect(service.resolveAttestations([])).resolves.toEqual({ success: true });

    expect(mockSendTransaction).not.toHaveBeenCalled();
    expect(mockEncodeFunctionData).not.toHaveBeenCalled();
  });

  it('[ACT-SND-P0-001][ACT-SND-P0-002] construye payload contractual mockeado y envia una tx por acta o apoyo', async () => {
    const result = await service.resolveAttestations([
      { tableCode: 'A-1', electionId: 'election-1' },
      { tableCode: 'A-2', electionId: 'election-1' },
    ]);

    expect(result).toEqual({
      success: true,
      hash: '0xtx',
      hashes: ['0xtx', '0xtx'],
    });
    expect(mockEncodeFunctionData).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: 'resolve',
        args: ['A-1-election-1'],
      }),
    );
    expect(mockSendTransaction).toHaveBeenCalledTimes(2);
    expect(mockSendTransaction).toHaveBeenCalledWith({
      to: '0xOracle',
      data: '0xencoded',
      value: 0n,
    });
  });

  it('[SEC-FIL-P0-003] retorna error contractual mockeado sin filtrar secretos ante fallo RPC', async () => {
    mockSendTransaction.mockRejectedValueOnce(new Error('rpc failed'));

    await expect(
      service.resolveAttestations([{ tableCode: 'A-1', electionId: 'election-1' }]),
    ).resolves.toEqual({ success: false, error: 'rpc failed' });
  });

  it('[SEC-FIL-P0-003] rechaza configuracion contractual incompleta sin ejecutar contrato real', async () => {
    service = new OracleResolverService(config({ RESOLVER_KEY: undefined }));

    await expect(service.initialize()).rejects.toThrow(
      'Configuración blockchain incompleta',
    );
  });

  it('[ADM-CAS-P1-003] lee contrato mockeado y normaliza estado de caso de atestiguamiento', async () => {
    mockReadContract.mockResolvedValueOnce([3, 99n]);

    await expect(service.getAttestationInfo('A-1', 'election-1')).resolves.toEqual({
      status: 3,
      finalResult: 99n,
    });
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xOracle',
        functionName: 'getAttestationInfo',
        args: ['A-1-election-1'],
      }),
    );
  });

  it('[ADM-CAS-P1-003] mapea estados contractuales VERIFYING CONSENSUAL CLOSED y PENDING', () => {
    expect(service.mapContractStatusToString(0)).toBe('VERIFYING');
    expect(service.mapContractStatusToString(1)).toBe('CONSENSUAL');
    expect(service.mapContractStatusToString(3)).toBe('CLOSED');
    expect(service.mapContractStatusToString(4)).toBe('PENDING');
  });
});
