import { OfficialPublicationReconciliationWorker } from '@/modules/institutional-voting/services/publication/official-publication-reconciliation.worker';

describe('OfficialPublicationReconciliationWorker', () => {
  let requestService: any;
  let verificationService: any;
  let finalizationService: any;
  let worker: OfficialPublicationReconciliationWorker;

  beforeEach(() => {
    requestService = {
      findReconciliationBatch: jest.fn(),
      acquireProcessingLock: jest.fn(),
      releaseProcessingLock: jest.fn(),
      getRequestById: jest.fn(),
      markChainPending: jest.fn(),
      recordChainCheck: jest.fn(),
      markChainConfirmed: jest.fn(),
      markFailedFinal: jest.fn(),
      markFailedRetryable: jest.fn(),
      markNeedsReview: jest.fn(),
      transition: jest.fn(),
    };
    verificationService = {
      verifySubmittedRequest: jest.fn(),
    };
    finalizationService = {
      finalizeOfficialPublication: jest.fn(),
    };
    worker = new OfficialPublicationReconciliationWorker(
      requestService,
      verificationService,
      finalizationService,
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            'app.officialPublication.reconciliationEnabled': 'false',
            'app.officialPublication.reconciliationBatchSize': '10',
            'app.officialPublication.reconciliationLockMs': '60000',
          };
          return values[key];
        }),
      } as any,
    );
  });

  it('TVD-PUB-P0-010 TVD-PUB-P0-013 VALIDACION_RUNTIME_WORKER | procesa SUBMITTED como pendiente y no finaliza', async () => {
    const request = makeRequest('SUBMITTED');
    let lockedRequest: any;
    requestService.findReconciliationBatch.mockResolvedValue([request]);
    requestService.acquireProcessingLock.mockImplementation(async (input: any) => {
      lockedRequest = {
        ...request,
        processingLockId: input.lockId,
      };
      return lockedRequest;
    });
    requestService.getRequestById.mockImplementation(async () => lockedRequest);
    verificationService.verifySubmittedRequest.mockResolvedValue({
      status: 'PENDING',
      code: 'OFFICIAL_PUBLICATION_USER_OPERATION_PENDING',
    });
    requestService.markChainPending.mockResolvedValue({
      ...request,
      status: 'CHAIN_PENDING',
    });

    const result = await worker.runOnce({ force: true });

    expect(result.processed).toBe(1);
    expect(requestService.markChainPending).toHaveBeenCalledWith(
      request.requestId,
      'official-publication-reconciliation-worker',
    );
    expect(finalizationService.finalizeOfficialPublication).not.toHaveBeenCalled();
    expect(requestService.releaseProcessingLock).toHaveBeenCalled();
  });

  it('TVD-PUB-P0-010 TVD-PUB-P0-012 VALIDACION_RUNTIME_WORKER | confirma CHAIN_PENDING y llama finalizacion local', async () => {
    const request = makeRequest('CHAIN_PENDING');
    let lockedRequest: any;
    requestService.findReconciliationBatch.mockResolvedValue([request]);
    requestService.acquireProcessingLock.mockImplementation(async (input: any) => {
      lockedRequest = {
        ...request,
        processingLockId: input.lockId,
      };
      return lockedRequest;
    });
    requestService.getRequestById.mockImplementation(async () => lockedRequest);
    verificationService.verifySubmittedRequest.mockResolvedValue({
      status: 'CONFIRMED',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      receiptBlockNumber: 100n,
      confirmedBlockNumber: 105n,
      confirmations: 6,
    });
    requestService.markChainConfirmed.mockResolvedValue({
      ...request,
      status: 'CHAIN_CONFIRMED',
    });

    await worker.runOnce({ force: true });

    expect(requestService.markChainConfirmed).toHaveBeenCalledWith(
      request.requestId,
      'official-publication-reconciliation-worker',
      expect.objectContaining({
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        confirmationBlock: '105',
        confirmations: 6,
      }),
    );
    expect(finalizationService.finalizeOfficialPublication).toHaveBeenCalledWith(
      request.requestId,
      'official-publication-reconciliation-worker',
    );
  });

  it('TVD-PUB-P0-013 VALIDACION_RUNTIME_WORKER | no verifica cuando otro worker mantiene lock vigente', async () => {
    const request = makeRequest('CHAIN_PENDING');
    requestService.findReconciliationBatch.mockResolvedValue([request]);
    requestService.acquireProcessingLock.mockResolvedValue(null);

    const result = await worker.runOnce({ force: true });

    expect(result.processed).toBe(0);
    expect(verificationService.verifySubmittedRequest).not.toHaveBeenCalled();
  });

  it('clasifica receipt revertido como FAILED_FINAL', async () => {
    const request = makeRequest('CHAIN_PENDING');
    let lockedRequest: any;
    requestService.findReconciliationBatch.mockResolvedValue([request]);
    requestService.acquireProcessingLock.mockImplementation(async (input: any) => {
      lockedRequest = {
        ...request,
        processingLockId: input.lockId,
      };
      return lockedRequest;
    });
    requestService.getRequestById.mockImplementation(async () => lockedRequest);
    verificationService.verifySubmittedRequest.mockResolvedValue({
      status: 'REVERTED',
      code: 'OFFICIAL_PUBLICATION_USER_OPERATION_REVERTED',
      safeMessage: 'La operacion fue revertida en blockchain',
    });

    await worker.runOnce({ force: true });

    expect(requestService.markFailedFinal).toHaveBeenCalledWith(
      request.requestId,
      'official-publication-reconciliation-worker',
      'OFFICIAL_PUBLICATION_USER_OPERATION_REVERTED',
      'La operacion fue revertida en blockchain',
      undefined,
      'CHAIN_VERIFICATION',
    );
  });

  it('error recuperable conserva errorCode y errorStage', async () => {
    const request = makeRequest('CHAIN_PENDING');
    let lockedRequest: any;
    requestService.findReconciliationBatch.mockResolvedValue([request]);
    requestService.acquireProcessingLock.mockImplementation(async (input: any) => {
      lockedRequest = {
        ...request,
        processingLockId: input.lockId,
      };
      return lockedRequest;
    });
    requestService.getRequestById.mockImplementation(async () => lockedRequest);
    verificationService.verifySubmittedRequest.mockResolvedValue({
      status: 'RETRYABLE_ERROR',
      code: 'OFFICIAL_PUBLICATION_CHAIN_VERIFICATION_RETRYABLE',
      safeMessage: 'No se pudo verificar temporalmente la operacion',
      nextRetryAt: new Date('2026-07-22T12:01:00.000Z'),
    });

    await worker.runOnce({ force: true });

    expect(requestService.markFailedRetryable).toHaveBeenCalledWith(
      request.requestId,
      'official-publication-reconciliation-worker',
      'OFFICIAL_PUBLICATION_CHAIN_VERIFICATION_RETRYABLE',
      'No se pudo verificar temporalmente la operacion',
      'CHAIN_PENDING',
      undefined,
      'CHAIN_VERIFICATION',
      1,
    );
  });

  function makeRequest(status: string) {
    return {
      requestId: 'request-1',
      status,
      version: 1,
      retryCount: 0,
      processingLockId: null,
      resumeFromStatus: null,
    };
  }
});
