jest.mock('@/api/vote', () => ({
  VoteContractCalls: {
    addAuthorizedAddress: jest.fn().mockReturnValue({
      to: '0x9999999999999999999999999999999999999999',
      data: '0xaabbcc',
      value: 0n,
    }),
  },
  VoteContractReads: {},
}));

import { InstitutionalAdminApplicationsService } from '@/modules/institutional-admin-applications/services/institutional-admin-applications.service';

describe('InstitutionalAdminApplicationsService receipt verification', () => {
  const signer = '0x1111111111111111111111111111111111111111';
  const target = '0x2222222222222222222222222222222222222222';
  const userOpHash = `0x${'a'.repeat(64)}`;
  const applicationId = '64e000000000000000000003';
  let userOperationService: any;
  let chainVerificationService: any;
  let service: InstitutionalAdminApplicationsService;

  beforeEach(() => {
    userOperationService = {
      getBlockNumber: jest.fn().mockResolvedValue(1n),
      getUserOperationByHash: jest.fn().mockResolvedValue({
        userOperation: { sender: signer, callData: `0xdeadbeef${'9'.repeat(40)}aabbcc0011` },
      }),
      getUserOperationReceipt: jest.fn().mockResolvedValue({
        userOpHash,
        sender: signer,
        success: true,
        txHash: `0x${'b'.repeat(64)}`,
        receipt: { transactionHash: `0x${'b'.repeat(64)}`, status: '0x1', blockNumber: '0x1', logs: [] },
      }),
    };
    chainVerificationService = {
      decodeSmartAccountCalls: jest.fn().mockReturnValue([{
        to: '0x9999999999999999999999999999999999999999', value: 0n, data: '0xaabbcc',
      }]),
    };
    const config = { get: jest.fn((key: string) => {
      if (key === 'app.blockchain.chain') return 'base-sepolia';
      if (key === 'app.blockchain.privateKey') return `0x${'1'.repeat(64)}`;
      return '';
    }) };
    service = new InstitutionalAdminApplicationsService(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, config as any, {} as any, {} as any, {} as any, {} as any,
      userOperationService, chainVerificationService, {} as any,
    );
    jest.spyOn(service as any, 'resolveMobileAuthorizationContext').mockResolvedValue({
      tenant: { _id: 'tenant-1' }, primary: { accountAddress: signer },
    });
    jest.spyOn(service as any, 'requireStableInstitutionId').mockReturnValue('institution-1');
    jest.spyOn(service as any, 'resolveMobileAuthorizationAction').mockReturnValue('ADD_AUTHORIZED_ADDRESS');
  });

  const application = () => ({
    _id: applicationId,
    mobileAuthorizationUserOpHash: userOpHash,
    accountAddress: target,
    mobileAuthorizationAction: 'ADD_AUTHORIZED_ADDRESS',
  });

  it('consulta explícitamente el receipt y confirma sólo la operación exitosa y coincidente', async () => {
    await expect((service as any).verifyMobileAuthorizationUserOperation(application())).resolves.toMatchObject({
      status: 'CONFIRMED',
      code: 'INSTITUTIONAL_USER_OPERATION_CONFIRMED',
      txHash: `0x${'b'.repeat(64)}`,
    });
    expect(userOperationService.getUserOperationByHash).toHaveBeenCalledWith(userOpHash);
    expect(userOperationService.getUserOperationReceipt).toHaveBeenCalledWith(userOpHash);
  });

  it('mantiene pendiente una operación cuyo receipt todavía no existe', async () => {
    userOperationService.getUserOperationReceipt.mockResolvedValue(null);
    await expect((service as any).verifyMobileAuthorizationUserOperation(application())).resolves.toEqual({
      status: 'PENDING', code: 'INSTITUTIONAL_USER_OPERATION_PENDING',
    });
  });

  it('bloquea un receipt que no pertenece al userOpHash persistido', async () => {
    userOperationService.getUserOperationReceipt.mockResolvedValue({
      userOpHash: `0x${'c'.repeat(64)}`, sender: signer, success: true, txHash: `0x${'b'.repeat(64)}`,
      receipt: { transactionHash: `0x${'b'.repeat(64)}`, status: '0x1', blockNumber: '0x1', logs: [] },
    });
    await expect((service as any).verifyMobileAuthorizationUserOperation(application())).resolves.toEqual({
      status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_RECEIPT_MISMATCH',
    });
  });

  it('acota el retry y aplica backoff cuando no hay receipt ni postestado on-chain', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    (service as any).applicationModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ ...application(), status: 'PENDING_CHAIN_CONFIRMATION', chainAttempts: 1 }),
      updateOne,
    };
    userOperationService.getUserOperationReceipt.mockResolvedValue(null);
    jest.spyOn(service as any, 'isMobileAuthorizationConfirmedOnNetwork').mockResolvedValue(false);

    await expect(service.processMobileAuthorizationRetry(applicationId)).resolves.toMatchObject({
      processed: true, status: 'RETRY_PENDING', attempts: 2,
    });
    expect(updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({
        status: 'CHAIN_RETRY_PENDING',
        chainStatus: 'RETRY_PENDING',
        chainAttempts: 2,
        chainNextRetryAt: expect.any(Date),
      }),
    }));
  });

  it('reconcilia por postestado on-chain aunque el bundler no conozca el userOpHash', async () => {
    const complete = jest.spyOn(service as any, 'completeMobileAuthorizationFromNetwork').mockResolvedValue(undefined);
    const onChain = jest.spyOn(service as any, 'isMobileAuthorizationConfirmedOnNetwork').mockResolvedValue(true);
    (service as any).applicationModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ ...application(), status: 'PENDING_CHAIN_CONFIRMATION', chainAttempts: 1 }),
      updateOne: jest.fn(),
    };
    userOperationService.getUserOperationByHash.mockResolvedValue(null);
    userOperationService.getUserOperationReceipt.mockResolvedValue(null);

    await expect(service.processMobileAuthorizationRetry(applicationId)).resolves.toMatchObject({
      processed: true,
      status: 'CONFIRMED',
      reusedNetworkState: true,
    });
    expect(onChain).toHaveBeenCalledWith(expect.objectContaining({ _id: applicationId }), 'institution-1', target);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ _id: applicationId }));
  });

  it('termina el pending desconocido al alcanzar el límite sin habilitar otra firma', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    (service as any).applicationModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ ...application(), status: 'CHAIN_RETRY_PENDING', chainAttempts: 4 }),
      updateOne,
    };
    userOperationService.getUserOperationByHash.mockResolvedValue(null);
    userOperationService.getUserOperationReceipt.mockResolvedValue(null);
    jest.spyOn(service as any, 'isMobileAuthorizationConfirmedOnNetwork').mockResolvedValue(false);

    await expect(service.processMobileAuthorizationRetry(applicationId)).resolves.toMatchObject({
      processed: true,
      status: 'FAILED',
      attempts: 5,
      reissuable: false,
    });
    expect(updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({
        status: 'CHAIN_FAILED',
        chainStatus: 'FAILED',
        chainNextRetryAt: null,
        chainLastError: 'INSTITUTIONAL_USER_OPERATION_PENDING',
      }),
    }));
  });

  it('bloquea una operación revertida o firmada por una cuenta distinta', async () => {
    userOperationService.getUserOperationReceipt.mockResolvedValueOnce({
      receipt: { status: '0x0' },
    });
    await expect((service as any).verifyMobileAuthorizationUserOperation(application())).resolves.toEqual({
      status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_REVERTED',
    });

    userOperationService.getUserOperationReceipt.mockResolvedValue({
      userOpHash, sender: signer, success: true, txHash: `0x${'b'.repeat(64)}`,
      receipt: { transactionHash: `0x${'b'.repeat(64)}`, status: '0x1', blockNumber: '0x1', logs: [] },
    });
    userOperationService.getUserOperationByHash.mockResolvedValue({
      userOperation: { sender: target, callData: `0xdeadbeef${'9'.repeat(40)}aabbcc0011` },
    });
    await expect((service as any).verifyMobileAuthorizationUserOperation(application())).resolves.toEqual({
      status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_SENDER_MISMATCH',
    });
  });

  it('marca terminal un receipt revertido sin ejecutar la finalización local', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    (service as any).applicationModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ ...application(), status: 'PENDING_CHAIN_CONFIRMATION', chainAttempts: 1 }),
      updateOne,
    };
    jest.spyOn(service as any, 'completeMobileAuthorizationFromNetwork');
    userOperationService.getUserOperationReceipt.mockResolvedValue({
      userOpHash, sender: signer, success: false, txHash: `0x${'b'.repeat(64)}`,
      receipt: { transactionHash: `0x${'b'.repeat(64)}`, status: '0x0', blockNumber: '0x1', logs: [] },
    });

    await expect(service.processMobileAuthorizationRetry(applicationId)).resolves.toMatchObject({
      processed: true, status: 'FAILED', reason: 'INSTITUTIONAL_USER_OPERATION_REVERTED', reissuable: true,
    });
    expect((service as any).completeMobileAuthorizationFromNetwork).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({ status: 'CHAIN_FAILED', chainStatus: 'FAILED' }),
    }));
  });

  it('permite revisar de nuevo un CHAIN_FAILED antes de habilitar una nueva firma', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const findOneAndUpdate = jest.fn().mockResolvedValue({
      ...application(), status: 'CHAIN_FAILED', chainAttempts: 1,
    });
    (service as any).applicationModel = { findOneAndUpdate, updateOne };
    userOperationService.getUserOperationReceipt.mockResolvedValue({
      userOpHash, sender: signer, success: false, txHash: `0x${'b'.repeat(64)}`,
      receipt: { transactionHash: `0x${'b'.repeat(64)}`, status: '0x0', blockNumber: '0x1', logs: [] },
    });

    await expect(service.processMobileAuthorizationRetry(applicationId)).resolves.toMatchObject({
      processed: true, status: 'FAILED', reissuable: true,
    });
    expect(findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: { $in: expect.arrayContaining(['CHAIN_FAILED']) },
    }), expect.anything(), expect.anything());
  });

  it('bloquea un receipt exitoso si el calldata no corresponde a la autorización registrada', async () => {
    chainVerificationService.decodeSmartAccountCalls.mockReturnValue([
      { to: '0x9999999999999999999999999999999999999999', value: 0n, data: '0xdeadbeef' },
    ]);
    await expect((service as any).verifyMobileAuthorizationUserOperation(application())).resolves.toEqual({
      status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_CALL_MISMATCH',
    });
  });
});
