import {
  ConflictException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { OfficialPublicationApiService } from '@/modules/institutional-voting/services/publication/official-publication-api.service';
import { TvdBlockchainError } from '@/modules/tvd/errors/tvd-blockchain.error';

describe('OfficialPublicationApiService', () => {
  const eventId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const requestId = 'request-1';
  const signerUserId = new Types.ObjectId();
  const signer = { sub: String(signerUserId), role: 'INSTITUTIONAL_ADMIN' };
  const event = {
    _id: eventId,
    tenantId,
    name: 'Eleccion segura',
    votingStart: new Date('2099-01-01T12:00:00.000Z'),
    votingEnd: new Date('2099-01-01T18:00:00.000Z'),
    resultsPublishAt: new Date('2099-01-01T20:00:00.000Z'),
    publishDeadline: new Date('2099-01-01T06:00:00.000Z'),
  };
  const tenant = { _id: tenantId, name: 'Institucion Uno' };

  let preparationService: any;
  let notificationService: any;
  let requestService: any;
  let accessService: any;
  let service: OfficialPublicationApiService;
  let requestDoc: any;

  beforeEach(() => {
    requestDoc = makeRequest();
    preparationService = {
      prepareOfficialPublication: jest.fn().mockResolvedValue({
        request: requestDoc,
        reused: false,
      }),
    };
    notificationService = {
      enqueueForRequest: jest.fn().mockResolvedValue({ enqueued: true }),
    };
    requestService = {
      getActiveRequestByEventId: jest.fn().mockResolvedValue(requestDoc),
      getRequestById: jest.fn().mockResolvedValue(requestDoc),
      cancelRequest: jest.fn().mockImplementation(async () => ({
        ...requestDoc,
        status: 'CANCELLED',
      })),
      releaseExpiredClaim: jest.fn().mockImplementation(async () => requestDoc),
      claimRequest: jest.fn().mockImplementation(async () => ({
        ...requestDoc,
        status: 'CLAIMED',
        claimedByDeviceId: 'device-1',
        lockedUntil: new Date('2026-07-22T12:10:00.000Z'),
      })),
      startSigning: jest.fn().mockImplementation(async () => ({
        ...requestDoc,
        status: 'SIGNING',
      })),
      rejectRequest: jest.fn().mockImplementation(async () => ({
        ...requestDoc,
        status: 'REJECTED',
      })),
      registerSubmission: jest.fn().mockImplementation(async () => ({
        ...requestDoc,
        status: 'SUBMITTED',
        userOpHash: HASH_A,
        txHash: HASH_B,
      })),
      markExpired: jest.fn().mockImplementation(async () => ({
        ...requestDoc,
        status: 'EXPIRED',
      })),
    };
    accessService = {
      getEventOrThrow: jest.fn().mockResolvedValue(event),
      assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined),
      resolveOfficialPublicationInstitution: jest.fn().mockResolvedValue({
        institutionId: requestDoc.institutionId,
        accountAddress: requestDoc.signerWallet,
        smartAccountAddress: requestDoc.smartAccountAddress,
      }),
    };
    service = new OfficialPublicationApiService(
      { findById: jest.fn().mockResolvedValue(event) } as any,
      { findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(tenant) })) } as any,
      preparationService,
      notificationService,
      requestService,
      accessService,
    );
  });

  it('crea una solicitud administrativa sin llamar flujo legacy ni exponer campos internos', async () => {
    const result = await service.createAdminRequest(String(eventId), signer);

    expect(preparationService.prepareOfficialPublication).toHaveBeenCalledWith(
      String(eventId),
      signer,
    );
    expect(result.created).toBe(true);
    expect(result.request.requestId).toBe(requestId);
    expect(result.request).not.toHaveProperty('callData');
    expect(result.request).not.toHaveProperty('activeKey');
    expect(result.request).not.toHaveProperty('encryptedPayload');
    expect(notificationService.enqueueForRequest).toHaveBeenCalledWith(requestDoc);
  });

  it('no vuelve a notificar cuando reutiliza una solicitud activa', async () => {
    preparationService.prepareOfficialPublication.mockResolvedValueOnce({
      request: requestDoc,
      reused: true,
    });

    const result = await service.createAdminRequest(String(eventId), signer);

    expect(result.created).toBe(false);
    expect(notificationService.enqueueForRequest).not.toHaveBeenCalled();
  });

  it('mapea configuracion incompleta de creditos electorales a respuesta funcional controlada', async () => {
    preparationService.prepareOfficialPublication.mockRejectedValueOnce(
      new TvdBlockchainError('TVD_CREDITS_CONFIG_INCOMPLETE'),
    );

    let caughtError: unknown;
    try {
      await service.createAdminRequest(String(eventId), signer);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(ServiceUnavailableException);
    expect((caughtError as ServiceUnavailableException).getResponse()).toEqual({
      code: 'ELECTORAL_CREDITS_CONFIGURATION_INCOMPLETE',
      message: 'La publicacion oficial no esta disponible en este entorno.',
    });
    expect(notificationService.enqueueForRequest).not.toHaveBeenCalled();
  });

  it('mapea institucion inexistente on-chain y no encola notificacion', async () => {
    preparationService.prepareOfficialPublication.mockRejectedValueOnce(
      new TvdBlockchainError('TVD_INSTITUTION_NOT_REGISTERED'),
    );

    let caughtError: unknown;
    try {
      await service.createAdminRequest(String(eventId), signer);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ConflictException);
    expect((caughtError as ConflictException).getResponse()).toEqual({
      code: 'TVD_INSTITUTION_NOT_REGISTERED',
      message: 'Institucion no registrada en blockchain',
    });
    expect(notificationService.enqueueForRequest).not.toHaveBeenCalled();
  });

  it('consulta activa como request null cuando no existe solicitud activa', async () => {
    requestService.getActiveRequestByEventId.mockResolvedValueOnce(null);
    requestService.getLatestAttemptByEventId = jest.fn().mockResolvedValueOnce(null);

    const result = await service.getActiveAdminRequest(String(eventId), signer);

    expect(result).toEqual({ request: null, latestAttempt: null });
    expect(accessService.assertTenantWriteAccess).toHaveBeenCalledWith(tenantId, signer);
  });

  it('consulta activa devuelve latestAttempt retryable sin tratarlo como request activo', async () => {
    const failed = {
      ...requestDoc,
      status: 'FAILED_RETRYABLE',
      errorCode: 'OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING',
      errorStage: 'ARTIFACT_ENCRYPTION',
      safeMessage: 'No se pudo completar la preparacion de la publicacion oficial',
    };
    requestService.getActiveRequestByEventId.mockResolvedValueOnce(null);
    requestService.getLatestAttemptByEventId = jest.fn().mockResolvedValueOnce(failed);

    const result = await service.getActiveAdminRequest(String(eventId), signer);

    expect(result.request).toBeNull();
    expect(result.latestAttempt).toMatchObject({
      requestId,
      status: 'FAILED_RETRYABLE',
      errorCode: 'OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING',
      errorStage: 'ARTIFACT_ENCRYPTION',
      retryable: true,
      active: false,
    });
  });

  it('cancela antes de submission e impide cancelar despues de userOpHash', async () => {
    const cancelled = await service.cancelAdminRequest(requestId, signer);
    expect(cancelled.request.status).toBe('CANCELLED');

    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      status: 'SUBMITTED',
      userOpHash: HASH_A,
    });
    await expect(service.cancelAdminRequest(requestId, signer)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'OFFICIAL_PUBLICATION_CANNOT_CANCEL_AFTER_SUBMISSION',
      }),
    });
  });

  it('oculta solicitudes moviles ajenas como no encontradas', async () => {
    await expect(
      service.getMobileRequest(requestId, {
        sub: String(new Types.ObjectId()),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('autoriza movil por signerUserId aunque requestedByUserId sea otro usuario', async () => {
    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      requestedByUserId: new Types.ObjectId(),
      signerUserId,
      smartAccountAddress: requestDoc.smartAccountAddress,
    });

    const result = await service.getMobileRequest(requestId, signer);

    expect(result.request.requestId).toBe(requestId);
    expect(result.request.votingStart).toBe('2099-01-01T12:00:00.000Z');
    expect(result.request.publicationDeadline).toBe('2099-01-01T06:00:00.000Z');
    expect(result.request.canPublish).toBe(true);
    expect(result.request.blockingReason).toBeNull();
  });

  it('rechaza requester que no es signer cuando intenta acceder desde movil', async () => {
    const requesterOnly = new Types.ObjectId();
    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      requestedByUserId: requesterOnly,
      signerUserId,
    });

    await expect(
      service.getMobileRequest(requestId, {
        sub: String(requesterOnly),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza smart account distinta para el signer movil', async () => {
    accessService.resolveOfficialPublicationInstitution.mockResolvedValueOnce({
      institutionId: requestDoc.institutionId,
      accountAddress: '0x9999999999999999999999999999999999999999',
      smartAccountAddress: '0x9999999999999999999999999999999999999999',
    });

    await expect(service.getMobileRequest(requestId, signer)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reclama y devuelve solo paquete de ejecucion preparado', async () => {
    const result = await service.claimMobileRequest(requestId, signer, {
      deviceId: 'device-1',
    });

    expect(requestService.claimRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        deviceId: 'device-1',
      }),
    );
    expect(result.execution.callData).toBe('0x1234');
    expect(result.execution.callDataHash).toBe('0xcall');
    expect(result).not.toHaveProperty('encryptedPayload');
    expect(result).not.toHaveProperty('nullifiersRef');
  });

  it('rechaza otro dispositivo cuando ya existe userOpHash y no libera claim', async () => {
    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      status: 'SUBMITTED',
      userOpHash: HASH_A,
      claimedByDeviceId: 'device-1',
    });

    await expect(
      service.claimMobileRequest(requestId, signer, { deviceId: 'device-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(requestService.releaseExpiredClaim).not.toHaveBeenCalled();
  });

  it('permite reutilizar claim vencido sin userOpHash', async () => {
    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      status: 'CLAIMED',
      claimedByDeviceId: 'device-old',
      lockedUntil: new Date('2020-01-01T00:00:00.000Z'),
    });
    requestService.releaseExpiredClaim.mockResolvedValueOnce({
      ...requestDoc,
      status: 'PENDING_APPROVAL',
      claimedByDeviceId: null,
      lockedUntil: null,
    });

    await service.claimMobileRequest(requestId, signer, { deviceId: 'device-2' });

    expect(requestService.releaseExpiredClaim).toHaveBeenCalled();
    expect(requestService.claimRequest).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-2' }),
    );
  });

  it('marca SIGNING de forma idempotente y registra submission sin aceptar callData del cliente', async () => {
    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      status: 'CLAIMED',
      claimedByDeviceId: 'device-1',
    });
    const signing = await service.markMobileSigning(requestId, signer, {
      deviceId: 'device-1',
    });
    expect(signing.request.status).toBe('SIGNING');

    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      status: 'SIGNING',
      claimedByDeviceId: 'device-1',
    });
    const submission = await service.registerMobileSubmission(requestId, signer, {
      deviceId: 'device-1',
      userOpHash: HASH_A.toUpperCase(),
      txHash: HASH_B.toUpperCase(),
      callData: '0xdead',
      institutionId: 'evil',
      status: 'CHAIN_CONFIRMED',
    } as any);

    expect(requestService.registerSubmission).toHaveBeenCalledWith({
      requestId,
      userOpHash: HASH_A,
      txHash: HASH_B,
      actor: String(signerUserId),
    });
    expect(submission).toMatchObject({
      status: 'SUBMITTED',
      userOpHash: HASH_A,
      txHash: HASH_B,
      request: expect.objectContaining({
        status: 'SUBMITTED',
        userOpHash: HASH_A,
        txHash: HASH_B,
      }),
    });
  });

  it('submission exige userOpHash antes de persistir', async () => {
    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      status: 'SIGNING',
      claimedByDeviceId: 'device-1',
    });

    await expect(
      service.registerMobileSubmission(requestId, signer, {
        deviceId: 'device-1',
        userOpHash: '',
      } as any),
    ).rejects.toThrow();
    expect(requestService.registerSubmission).not.toHaveBeenCalled();
  });

  it('no permite reject ni submission despues de submission incompatible', async () => {
    requestService.getRequestById.mockResolvedValue({
      ...requestDoc,
      status: 'SUBMITTED',
      userOpHash: HASH_A,
      claimedByDeviceId: 'device-1',
    });

    await expect(
      service.rejectMobileRequest(requestId, signer, {
        deviceId: 'device-1',
        reasonCode: 'USER_REJECTED' as any,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.registerMobileSubmission(requestId, signer, {
        deviceId: 'device-1',
        userOpHash: HASH_B,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marca expiracion como 410 antes del envio', async () => {
    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    await expect(
      service.claimMobileRequest(requestId, signer, { deviceId: 'device-1' }),
    ).rejects.toBeInstanceOf(GoneException);
    expect(requestService.markExpired).toHaveBeenCalledWith(
      requestId,
      'system',
      expect.any(Date),
    );
  });

  it('bloquea claim y signing cuando la ventana de publicacion esta cerrada', async () => {
    const closedEvent = {
      ...event,
      publishDeadline: new Date('2020-01-01T00:00:00.000Z'),
    };
    (service as any).votingEventModel.findById.mockResolvedValue(closedEvent);

    await expect(
      service.claimMobileRequest(requestId, signer, { deviceId: 'device-1' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PUBLICATION_WINDOW_CLOSED',
      }),
    });

    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      status: 'CLAIMED',
      claimedByDeviceId: 'device-1',
    });
    await expect(
      service.markMobileSigning(requestId, signer, { deviceId: 'device-1' }),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('permite submission idempotente con userOpHash aunque la ventana cierre despues del envio', async () => {
    const closedEvent = {
      ...event,
      publishDeadline: new Date('2020-01-01T00:00:00.000Z'),
    };
    (service as any).votingEventModel.findById.mockResolvedValue(closedEvent);
    requestService.getRequestById.mockResolvedValueOnce({
      ...requestDoc,
      status: 'SUBMITTED',
      userOpHash: HASH_A,
      txHash: HASH_B,
      claimedByDeviceId: 'device-1',
    });

    const result = await service.registerMobileSubmission(requestId, signer, {
      deviceId: 'device-1',
      userOpHash: HASH_A,
      txHash: HASH_B,
    });

    expect(result).toMatchObject({
      status: 'SUBMITTED',
      userOpHash: HASH_A,
      txHash: HASH_B,
      request: expect.objectContaining({ userOpHash: HASH_A }),
    });
    expect(requestService.registerSubmission).not.toHaveBeenCalled();
  });

  const HASH_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const HASH_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  function makeRequest(overrides: Record<string, any> = {}) {
    return {
      requestId,
      eventId,
      tenantId,
      institutionId: 'institution-1',
      requestedByUserId: signerUserId,
      signerUserId,
      signerWallet: '0x1111111111111111111111111111111111111111',
      smartAccountAddress: '0x1111111111111111111111111111111111111111',
      entryPointAddress: '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789',
      entryPointVersion: '0.6',
      status: 'PENDING_APPROVAL',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      enabledVotersCount: 3,
      creditsRequired: '3',
      tvdRequired: '3000000000000000000',
      tvdPerCredit: '1000000000000000000',
      chainId: 84532,
      callData: {
        to: '0x7b57ee9103fc46ed6794329c36d2919293f0fabb',
        value: '0',
        data: '0x1234',
      },
      callDataHash: '0xcall',
      onChainElectionId: '123',
      createdAt: new Date('2026-07-22T12:00:00.000Z'),
      updatedAt: new Date('2026-07-22T12:00:00.000Z'),
      userOpHash: null,
      txHash: null,
      claimedByDeviceId: null,
      lockedUntil: null,
      ...overrides,
    };
  }
});
