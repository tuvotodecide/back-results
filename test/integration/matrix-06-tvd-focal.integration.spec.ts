import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { getAddress } from 'viem';

jest.mock('@/modules/payments/utils/payment-status.mapper', () => {
  const actual = jest.requireActual<
    typeof import('@/modules/payments/utils/payment-status.mapper')
  >('@/modules/payments/utils/payment-status.mapper');
  return {
    ...actual,
    mapRedEnlaceStatus: jest.fn((input) => actual.mapRedEnlaceStatus(input)),
  };
});

import { LoggerService } from '@/core/services/logger.service';
import { PaymentTransactionsService } from '@/modules/payments/services/payment-transactions.service';
import { mapRedEnlaceStatus } from '@/modules/payments/utils/payment-status.mapper';
import { TvdAccreditationWorkerService } from '@/modules/tvd/services/tvd-accreditation-worker.service';
import { TvdManualAssignmentsService } from '@/modules/tvd/services/tvd-manual-assignments.service';
import { TvdQrAccreditationsService } from '@/modules/tvd/services/tvd-qr-accreditations.service';
import { TvdCapacityService } from '@/modules/tvd/services/tvd-capacity.service';
import { OfficialPublicationApiService } from '@/modules/institutional-voting/services/publication/official-publication-api.service';
import { TvdBlockchainError } from '@/modules/tvd/errors/tvd-blockchain.error';
import {
  assertMx06TestOnlyEnvironment,
  createMx06ExternalWriteBoundary,
  expectNoMx06ExternalWrites,
  prepareMx06TestOnlyEnvironment,
} from '../utils/mx06-test-only-guard';

const observedMapRedEnlaceStatus = jest.mocked(mapRedEnlaceStatus);

const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const eventId = new Types.ObjectId();
const tenantId = new Types.ObjectId();
const userId = new Types.ObjectId();
const assignmentId = new Types.ObjectId();
const paymentId = new Types.ObjectId();

const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });
function queryResult<T>(value: T) {
  const result = Promise.resolve(value);
  return {
    exec: jest.fn().mockResolvedValue(value),
    then: result.then.bind(result),
    catch: result.catch.bind(result),
  };
}

function paymentHarness(overrides: Record<string, unknown> = {}) {
  const payment = {
    _id: paymentId,
    tenantId,
    requestedByUserId: userId,
    merchantReference: '203414',
    amountMinor: '1050',
    currency: 'BOB',
    status: 'CREATED',
    createdAt: new Date('2026-08-04T10:00:00.000Z'),
    updatedAt: new Date('2026-08-04T10:00:00.000Z'),
    ...overrides,
  };
  let findOneAndUpdateCall = 0;
  const model = {
    create: jest.fn().mockResolvedValue(payment),
    findOne: jest.fn().mockReturnValue(lean(null)),
    findOneAndUpdate: jest.fn().mockImplementation(() => {
      findOneAndUpdateCall += 1;
      return queryResult(findOneAndUpdateCall === 1
        ? { ...payment, status: 'QR_REQUESTING' }
        : { ...payment, status: 'QR_ACTIVE', providerReference: 'ATC-1', providerStatus: 'PENDING', qrImage: 'base64', qrExpiresAt: new Date('2026-08-04T10:30:00.000Z') });
    }),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    findById: jest.fn().mockResolvedValue(payment),
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([payment]) }) }) }) }),
    countDocuments: jest.fn().mockResolvedValue(1),
  };
  const provider = {
    generateQr: jest.fn().mockResolvedValue({ providerReference: 'ATC-1', originMerchantReference: '203414', amountMinor: '1050', currency: 'BOB', providerStatus: 'PENDING', responseCode: 'PENDING', qrImage: 'base64' }),
    verifyQr: jest.fn(),
  };
  const access = {
    resolveTenantForWrite: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    getRequesterObjectId: jest.fn().mockReturnValue(userId),
    resolvePaymentTargetForRequester: jest.fn().mockResolvedValue({ targetAssignmentId: assignmentId, targetWallet: wallet, targetWalletNormalized: wallet }),
    assertTenantAccess: jest.fn().mockResolvedValue(undefined),
    resolveTenantIdsForRead: jest.fn().mockResolvedValue([tenantId]),
  };
  const config = { get: jest.fn((key: string) => ({ 'app.redEnlace.qrTtl': '00:30:00', 'app.redEnlace.minAmountMinor': '1', 'app.redEnlace.maxAmountMinor': '1000000' })[key]) };
  const accreditations = { createOrReuseForConfirmedPayment: jest.fn().mockResolvedValue({ accreditationId: new Types.ObjectId(), status: 'PENDING', tokenAmount: '5', reused: false }) };
  const service = new PaymentTransactionsService(model as never, provider as never, access as never, config as unknown as ConfigService, { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService, undefined, accreditations as never);
  return { service, model, provider, access, accreditations, payment };
}

function manualHarness() {
  const rows: Record<string, unknown>[] = [];
  const accreditationModel = {
    findOne: jest.fn((filter: { sourceId?: string }) => lean(rows.find((row) => row.sourceId === filter.sourceId) ?? null)),
    create: jest.fn(async (row: Record<string, unknown>) => {
      const created = { ...row, _id: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date() };
      rows.push(created);
      return created;
    }),
    findByIdAndUpdate: jest.fn((id: Types.ObjectId, update: { $set: Record<string, unknown> }) => {
      const row = rows.find((item) => String(item._id) === String(id));
      Object.assign(row ?? {}, update.$set);
      return lean(row ?? null);
    }),
    findById: jest.fn((id: Types.ObjectId) => lean(rows.find((item) => String(item._id) === String(id)) ?? null)),
  };
  const assignment = { _id: assignmentId, tenantId, userId, active: true, status: 'APPROVED', accountAddress: wallet, accountAddressNormalized: wallet, walletVerifiedAt: new Date(), walletVerificationSource: 'TEST' };
  const processor = { processAccreditationById: jest.fn(async (id: Types.ObjectId) => ({ ...(rows.find((row) => String(row._id) === String(id)) ?? {}), status: 'SUBMITTED', txHash: '0xabc', chainId: 84532, contractAddress: wallet })) };
  const reconciliation = { reconcileSubmittedAccreditation: jest.fn(async (id: Types.ObjectId) => ({ ...(rows.find((row) => String(row._id) === String(id)) ?? {}), status: 'CONFIRMED', txHash: '0xabc', blockNumber: '7' })) };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const service = new TvdManualAssignmentsService(
    accreditationModel as never,
    { findById: jest.fn(() => lean({ _id: tenantId, active: true })) } as never,
    { findById: jest.fn(() => lean(assignment)) } as never,
    { findById: jest.fn(() => lean({ _id: userId, active: true })) } as never,
    processor as never,
    reconciliation as never,
    audit as never,
    { get: jest.fn((key: string) => key === 'app.tvd.decimals' ? '2' : undefined) } as unknown as ConfigService,
  );
  return { service, rows, processor, reconciliation, audit, assignment };
}

function publicationHarness() {
  const request = { requestId: 'request-1', eventId, tenantId, institutionId: 'institution-1', signerUserId: String(userId), signerWallet: wallet, smartAccountAddress: wallet, status: 'PENDING_APPROVAL', expiresAt: new Date('2099-01-01T12:00:00.000Z'), enabledVotersCount: 5, creditsRequired: '5', tvdRequired: '5', tvdPerCredit: '1', createdAt: new Date(), updatedAt: new Date(), chainId: 84532, callData: { to: wallet, value: '0', data: '0x' }, callDataHash: '0xhash' };
  const preparation = { prepareOfficialPublication: jest.fn().mockResolvedValue({ request, reused: false }) };
  const notifications = { enqueueForRequest: jest.fn().mockResolvedValue({ enqueued: true }) };
  const requests = {
    getRequestById: jest.fn().mockResolvedValue(request), getActiveRequestByEventId: jest.fn().mockResolvedValue(request), getLatestAttemptByEventId: jest.fn().mockResolvedValue(null),
    cancelRequest: jest.fn().mockResolvedValue({ ...request, status: 'CANCELLED' }), releaseExpiredClaim: jest.fn().mockResolvedValue(request),
    claimRequest: jest.fn().mockResolvedValue({ ...request, status: 'CLAIMED', claimedByDeviceId: 'device-1' }), startSigning: jest.fn().mockResolvedValue({ ...request, status: 'SIGNING', claimedByDeviceId: 'device-1' }),
    rejectRequest: jest.fn().mockResolvedValue({ ...request, status: 'REJECTED' }), registerSubmission: jest.fn().mockResolvedValue({ ...request, status: 'SUBMITTED', claimedByDeviceId: 'device-1', userOpHash: `0x${'1'.repeat(64)}`, txHash: `0x${'2'.repeat(64)}` }), markExpired: jest.fn(),
  };
  const event = { _id: eventId, tenantId, name: 'Elección MX-06', votingStart: new Date('2099-01-02T12:00:00.000Z'), votingEnd: new Date('2099-01-02T18:00:00.000Z'), resultsPublishAt: new Date('2099-01-02T20:00:00.000Z'), publishDeadline: new Date('2099-01-02T12:00:00.000Z') };
  const access = { getEventOrThrow: jest.fn().mockResolvedValue(event), assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined), resolveOfficialPublicationInstitution: jest.fn().mockResolvedValue({ institutionId: 'institution-1', smartAccountAddress: wallet }) };
  const service = new OfficialPublicationApiService(
    { findById: jest.fn().mockResolvedValue(event) } as never,
    { findById: jest.fn(() => lean({ _id: tenantId, name: 'Institución MX-06' })) } as never,
    preparation as never, notifications as never, requests as never, access as never,
  );
  return { service, request, preparation, notifications, requests, access };
}

describe('MX-06 TVD focal integration coverage', () => {
  const admin = { sub: String(userId), role: 'ADMIN', active: true, tenantId: String(tenantId) };
  const qr = { amount: '10.50', currency: 'BOB' as const, description: 'Recarga MX-06' };
  let externalWrites = createMx06ExternalWriteBoundary();

  beforeEach(() => {
    prepareMx06TestOnlyEnvironment();
    assertMx06TestOnlyEnvironment();
    externalWrites = createMx06ExternalWriteBoundary();
  });

  afterEach(() => expectNoMx06ExternalWrites(externalWrites));

  it('[MX-06][TVD-ASSIGN-P0-001][INTEGRACION] persiste la intención institucional y confirma una asignación administrativa autorizada', async () => {
    const h = manualHarness();
    const result = await h.service.createManualAssignment({ tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '25', reason: 'Asignación institucional' }, admin, 'assign-1');
    expect(result).not.toBeNull();
    if (!result) throw new Error('Expected a persisted manual assignment result');
    expect(h.rows).toHaveLength(1); expect(h.rows[0]).toMatchObject({ sourceType: 'MANUAL_GRANT', targetWallet: getAddress(wallet), tokenAmountSmallestUnit: '2500' }); expect(result.status).toBe('CONFIRMED');
  });
  it('[MX-06][TVD-ASSIGN-P0-002][INTEGRACION] rechaza la wallet de una institución distinta sin crear acreditación', async () => {
    const h = manualHarness(); h.assignment.tenantId = new Types.ObjectId();
    await expect(h.service.createManualAssignment({ tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '25', reason: 'Asignación institucional' }, admin, 'assign-2')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TVD_ASSIGNMENT_TENANT_MISMATCH' }) }); expect(h.rows).toHaveLength(0);
  });
  it('[MX-06][TVD-ASSIGN-P0-003][INTEGRACION] mantiene persistencia vacía ante monto inválido', async () => {
    const h = manualHarness(); await expect(h.service.createManualAssignment({ tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '0', reason: 'Asignación institucional' }, admin, 'assign-3')).rejects.toBeInstanceOf(BadRequestException); expect(h.rows).toHaveLength(0);
  });
  it('[MX-06][TVD-ASSIGN-P0-004][INTEGRACION] reutiliza una intención por la misma clave funcional', async () => {
    const h = manualHarness(); const dto = { tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '25', reason: 'Asignación institucional' }; const first = await h.service.createManualAssignment(dto, admin, 'assign-4'); const second = await h.service.createManualAssignment(dto, admin, 'assign-4');
    expect(first).not.toBeNull(); expect(second).not.toBeNull();
    if (!first || !second) throw new Error('Expected idempotent persisted manual assignment results');
    expect(second.id).toBe(first.id); expect(h.processor.processAccreditationById).toHaveBeenCalledTimes(1);
  });
  it('[MX-06][TVD-ASSIGN-P0-005][INTEGRACION] conserva la intención no confirmada ante evidencia blockchain inconsistente', async () => {
    const h = manualHarness();
    h.processor.processAccreditationById.mockRejectedValue(new TvdBlockchainError('TVD_RECEIPT_NOT_FOUND'));
    await expect(h.service.createManualAssignment({ tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '25', reason: 'Asignación institucional' }, admin, 'assign-5')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.rows[0]).toMatchObject({ status: 'NEEDS_REVIEW', lastErrorCode: 'TVD_RECEIPT_NOT_FOUND' });
  });

  it('[MX-06][TVD-QR-P0-001][INTEGRACION] guarda monto, wallet y referencia congelados antes de generar QR', async () => { const h = paymentHarness(); await h.service.createQrPayment(qr, admin, 'qr-1'); expect(h.model.create).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: '1050', targetWallet: wallet, targetAssignmentId: assignmentId })); expect(h.provider.generateQr).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: '1050', currency: 'BOB' })); });
  it('[MX-06][TVD-QR-P0-003][INTEGRACION] impide generar QR cuando falta la clave de idempotencia', async () => { const h = paymentHarness(); await expect(h.service.createQrPayment(qr, admin)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYMENT_IDEMPOTENCY_KEY_REQUIRED' }) }); expect(h.provider.generateQr).not.toHaveBeenCalled(); });
  it('[MX-06][TVD-QR-P0-004][INTEGRACION] devuelve el registro existente para una repetición equivalente', async () => { const h = paymentHarness({ status: 'QR_ACTIVE', idempotencyRequestHash: require('crypto').createHash('sha256').update(JSON.stringify({ tenantId: String(tenantId), userId: String(userId), amountMinor: '1050', currency: 'BOB', description: 'Recarga MX-06' })).digest('hex'), providerReference: 'ATC-1', qrImage: 'base64' }); h.model.findOne.mockReturnValue(lean(h.payment)); const result = await h.service.createQrPayment(qr, admin, 'qr-4'); expect(result.status).toBe('QR_ACTIVE'); expect(h.model.create).not.toHaveBeenCalled(); });
  it('[MX-06][TVD-QR-P0-006][INTEGRACION] confirma callback congelado y reutiliza una única acreditación QR_PAYMENT', async () => {
    const h = paymentHarness({
      status: 'QR_ACTIVE',
      providerReference: 'ATC-1',
      targetAssignmentId: assignmentId,
      targetWallet: wallet,
      tvdQuote: { fiatAmountMinor: '1050', fiatCurrency: 'BOB', tokenAmount: '5' },
    });
    const confirmed = {
      ...h.payment,
      status: 'PAYMENT_CONFIRMED',
      providerStatus: 'SUCCESS',
      confirmationSource: 'WEBHOOK',
    };
    h.model.findOne.mockReturnValueOnce(queryResult(h.payment));
    h.model.findOneAndUpdate.mockReturnValue(queryResult(confirmed));
    h.model.findById.mockResolvedValue(confirmed);
    h.accreditations.createOrReuseForConfirmedPayment
      .mockResolvedValueOnce({ accreditationId: new Types.ObjectId(), sourceType: 'QR_PAYMENT', status: 'PENDING', reused: false });

    const callback = {
      providerReference: 'ATC-1',
      providerStatus: 'SUCCESS',
      responseCode: '00',
      amountMinor: '1050',
      currency: 'BOB' as const,
    };
    observedMapRedEnlaceStatus.mockClear();
    const first = await h.service.applyWebhookConfirmation(callback);

    expect(observedMapRedEnlaceStatus).toHaveBeenCalledTimes(1);
    expect(observedMapRedEnlaceStatus).toHaveBeenCalledWith(expect.objectContaining({
      source: 'WEBHOOK',
      providerStatus: 'SUCCESS',
      responseCode: '00',
    }));
    expect(observedMapRedEnlaceStatus.mock.results[0]?.value).toMatchObject({ status: 'PAYMENT_CONFIRMED' });
    expect(h.model.updateOne).toHaveBeenCalledWith(
      { _id: paymentId },
      expect.objectContaining({
        $set: expect.objectContaining({
          tokenAccreditationStatus: 'PENDING',
          tokenAccreditationId: expect.anything(),
          tokenAccreditationErrorCode: null,
        }),
      }),
    );
    expect(h.model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(h.accreditations.createOrReuseForConfirmedPayment).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ status: 'PAYMENT_CONFIRMED' });

    h.model.findOne.mockReturnValue(queryResult(confirmed));
    h.accreditations.createOrReuseForConfirmedPayment.mockResolvedValueOnce({
      accreditationId: new Types.ObjectId(), sourceType: 'QR_PAYMENT', status: 'PENDING', reused: true,
    });
    const replay = await h.service.applyWebhookConfirmation(callback);

    expect(replay).toMatchObject({ status: 'PAYMENT_CONFIRMED' });
    expect(h.model.findOne).toHaveBeenCalledWith({
      provider: 'RED_ENLACE',
      providerReference: 'ATC-1',
    });
    expect(h.model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: paymentId }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'PAYMENT_CONFIRMED', providerStatus: 'SUCCESS', confirmationSource: 'WEBHOOK' }) }),
      { new: true },
    );
    expect(h.model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(h.accreditations.createOrReuseForConfirmedPayment).toHaveBeenCalledTimes(2);
    expect(h.accreditations.createOrReuseForConfirmedPayment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: paymentId, amountMinor: '1050', currency: 'BOB' }),
      { source: 'WEBHOOK' },
    );
    expect(h.accreditations.createOrReuseForConfirmedPayment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: paymentId, amountMinor: '1050', currency: 'BOB' }),
      { source: 'WEBHOOK' },
    );
    expect(h.accreditations.createOrReuseForConfirmedPayment.mock.results).toHaveLength(2);
    expect(h.accreditations.createOrReuseForConfirmedPayment.mock.results[0].value).resolves.toMatchObject({ sourceType: 'QR_PAYMENT', status: 'PENDING', reused: false });
    expect(h.accreditations.createOrReuseForConfirmedPayment.mock.results[1].value).resolves.toMatchObject({ sourceType: 'QR_PAYMENT', status: 'PENDING', reused: true });
    expect(first).not.toHaveProperty('creditedBalance');
    expect(replay).not.toHaveProperty('creditedBalance');
  });
  it('[MX-06][TVD-QR-P0-007][INTEGRACION] envía confirmación tardía a conciliación sin acreditar saldo', async () => {
    const h = paymentHarness({ status: 'EXPIRED', providerReference: 'ATC-1' });
    const reconciliationPendingPayment = {
      ...h.payment,
      status: 'RECONCILIATION_PENDING',
      providerStatus: '00',
    };
    h.model.findOne.mockImplementation(() => queryResult(h.payment));
    h.model.findOneAndUpdate.mockImplementation(() => queryResult(reconciliationPendingPayment));

    const result = await h.service.applyWebhookConfirmation({
      providerReference: 'ATC-1',
      providerStatus: '00',
      responseCode: '00',
      amountMinor: '1050',
      currency: 'BOB',
    });

    expect(result.status).toBe('RECONCILIATION_PENDING');
    expect(result.status).not.toBe('PAYMENT_CONFIRMED');
    expect(h.model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(h.model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: paymentId, status: expect.objectContaining({ $in: expect.any(Array) }) }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'RECONCILIATION_PENDING', providerStatus: '00' }) }),
      { new: true },
    );
    expect(h.accreditations.createOrReuseForConfirmedPayment).not.toHaveBeenCalled();
  });
  it('[MX-06][TVD-QR-P0-008][INTEGRACION] expira el QR con el TTL del proveedor conservando su transacción', async () => { jest.useFakeTimers().setSystemTime(new Date('2026-08-04T10:00:00.000Z')); const h = paymentHarness(); await h.service.createQrPayment(qr, admin, 'qr-8'); expect(h.provider.generateQr).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: new Date('2026-08-04T10:30:00.000Z') })); jest.useRealTimers(); });
  it('[MX-06][TVD-QR-P0-009][INTEGRACION] no confirma una respuesta incompleta de Red Enlace', async () => { const h = paymentHarness(); h.provider.generateQr.mockResolvedValue({ providerReference: 'ATC-1', amountMinor: '1050', currency: 'BOB', providerStatus: 'PENDING' }); await expect(h.service.createQrPayment(qr, admin, 'qr-9')).rejects.toBeDefined(); expect(h.model.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ status: 'PROVIDER_STATUS_UNRESOLVED' }) })); });
  it('[MX-06][TVD-QR-P0-010][INTEGRACION] no degrada un pago confirmado por un callback tardío', async () => { const h = paymentHarness({ status: 'PAYMENT_CONFIRMED', providerReference: 'ATC-1', providerStatus: '00' }); h.model.findOne.mockReturnValue(queryResult(h.payment)); const result = await h.service.applyWebhookConfirmation({ providerReference: 'ATC-1', providerStatus: '05', responseCode: '05' }); expect(result.status).toBe('PAYMENT_CONFIRMED'); expect(h.model.findOneAndUpdate).not.toHaveBeenCalled(); });

  it('[MX-06][TVD-RES-P0-001][INTEGRACION] crea una única acreditación PENDING desde un pago confirmado', async () => {
    const created: Record<string, unknown>[] = [];
    const payment = {
      _id: paymentId,
      tenantId,
      requestedByUserId: userId,
      targetAssignmentId: assignmentId,
      targetWallet: wallet,
      targetWalletNormalized: wallet.toLowerCase(),
      amountMinor: '1050',
      currency: 'BOB',
      status: 'PAYMENT_CONFIRMED',
      providerReference: '1511556',
      merchantReference: '203414',
      tvdQuote: {
        fiatAmountMinor: '1050',
        fiatCurrency: 'BOB',
        bobPerToken: '2.10',
        exchangeRateVersion: 3,
        tokenAmount: '5',
        tokenAmountSmallestUnit: '500',
        quotedAt: new Date('2026-08-04T10:00:00.000Z'),
      },
    };
    const config = {
      get: jest.fn((key: string) => key === 'app.tvd.decimals' ? '2' : undefined),
    } as unknown as ConfigService;
    const service = new TvdQrAccreditationsService(
      {
        findOne: jest.fn().mockReturnValue(lean(null)),
        create: jest.fn(async (row: Record<string, unknown>) => {
          const result = { ...row, _id: new Types.ObjectId() };
          created.push(result);
          return result;
        }),
      } as never,
      { findById: jest.fn(() => lean({ active: true })) } as never,
      {
        findById: jest.fn(() => lean({
          tenantId,
          active: true,
          status: 'APPROVED',
          userId,
          accountAddress: wallet,
          accountAddressNormalized: wallet.toLowerCase(),
          walletVerifiedAt: new Date('2026-08-04T09:00:00.000Z'),
          walletVerificationSource: 'TEST',
        })),
      } as never,
      { findById: jest.fn(() => lean({ active: true })) } as never,
      { record: jest.fn().mockResolvedValue({}) } as never,
      config,
    );

    const result = await service.createOrReuseForConfirmedPayment(payment, { source: 'WEBHOOK' });

    expect(result.status).toBe('PENDING');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      sourceType: 'QR_PAYMENT',
      sourceId: String(paymentId),
      tenantId,
      targetAssignmentId: assignmentId,
      targetWallet: wallet,
      targetWalletNormalized: wallet.toLowerCase(),
      status: 'PENDING',
      tokenAmount: '5',
      tokenAmountSmallestUnit: '500',
    });
  });
  it('[MX-06][TVD-RES-P0-002][INTEGRACION] coordina el worker y evita procesar dos veces una acreditación reclamada', async () => { let claimed = false; const processor = { processNextPending: jest.fn(async () => { if (claimed) return null; claimed = true; return { status: 'SUBMITTED', id: 'acc-1' }; }), recoverExpiredClaims: jest.fn() }; const worker = new TvdAccreditationWorkerService({ countDocuments: jest.fn(), findOne: jest.fn() } as never, processor as never, { reconcileSubmittedBatch: jest.fn() } as never, { validateBlockchainConfiguration: jest.fn().mockResolvedValue({ configured: true }) } as never, { get: jest.fn((key: string) => key === 'app.tvd.accreditationWorkerEnabled' ? 'true' : undefined) } as unknown as ConfigService); const [one, two] = await Promise.all([worker.processPendingBatch(1), worker.processPendingBatch(1)]); expect([...one, ...two]).toHaveLength(1); expect(processor.processNextPending).toHaveBeenCalledTimes(2); });
  it('[MX-06][TVD-RES-P0-003][INTEGRACION] mantiene la acreditación bloqueada cuando el receipt no es compatible', async () => { const worker = new TvdAccreditationWorkerService({ countDocuments: jest.fn(), findOne: jest.fn() } as never, { processNextPending: jest.fn().mockResolvedValue({ status: 'BLOCKED_CONFIGURATION', lastErrorCode: 'TVD_EVENT_AMOUNT_MISMATCH' }), recoverExpiredClaims: jest.fn() } as never, { reconcileSubmittedBatch: jest.fn().mockResolvedValue([{ status: 'BLOCKED_CONFIGURATION', lastErrorCode: 'TVD_EVENT_AMOUNT_MISMATCH' }]) } as never, { validateBlockchainConfiguration: jest.fn().mockResolvedValue({ configured: true }) } as never, { get: jest.fn((key: string) => key === 'app.tvd.accreditationWorkerEnabled' ? 'true' : undefined) } as unknown as ConfigService); const result = await worker.reconcileSubmittedBatch(1); expect(result).toEqual([{ status: 'BLOCKED_CONFIGURATION', lastErrorCode: 'TVD_EVENT_AMOUNT_MISMATCH' }]); });
  it('[MX-06][TVD-RES-P0-004][INTEGRACION] usa balance blockchain como fuente autoritativa de capacidad', async () => { const service = new TvdCapacityService({} as never, {} as never, {} as never, {} as never, { resolveMyInstitutionalWallet: jest.fn().mockResolvedValue({ tenantId: String(tenantId), wallet }) } as never, { getLiquidBalance: jest.fn().mockResolvedValue('700'), getTokenDecimals: jest.fn().mockResolvedValue(2) } as never); const result = await service.estimateCapacity('10', { sub: String(userId), tenantId: String(tenantId) }); expect(result).toMatchObject({ availableTokens: '7', estimatedRequiredTokens: '10', hasEstimatedCapacity: false, balanceSource: 'BLOCKCHAIN' }); });

  it('[MX-06][TVD-PUB-P0-004][INTEGRACION] prepara la solicitud cuando la capacidad vigente es suficiente', async () => { const h = publicationHarness(); const result = await h.service.createAdminRequest(String(eventId), admin); expect(result.created).toBe(true); expect(h.preparation.prepareOfficialPublication).toHaveBeenCalledWith(String(eventId), admin); });
  it('[MX-06][TVD-PUB-P0-005][INTEGRACION] rechaza preflight económico obsoleto sin notificar al firmante', async () => { const h = publicationHarness(); h.preparation.prepareOfficialPublication.mockRejectedValue(new TvdBlockchainError('TVD_CREDITS_BALANCE_INSUFFICIENT')); await expect(h.service.createAdminRequest(String(eventId), admin)).rejects.toBeInstanceOf(BadRequestException); expect(h.notifications.enqueueForRequest).not.toHaveBeenCalled(); });
  it('[MX-06][TVD-PUB-P0-006][INTEGRACION] persiste una solicitud activa y encola su aviso seguro', async () => { const h = publicationHarness(); await h.service.createAdminRequest(String(eventId), admin); expect(h.notifications.enqueueForRequest).toHaveBeenCalledWith(h.request); });
  it('[MX-06][TVD-PUB-P0-007][INTEGRACION] reutiliza la solicitud activa sin duplicar aviso ni operación', async () => { const h = publicationHarness(); h.preparation.prepareOfficialPublication.mockResolvedValue({ request: h.request, reused: true }); const result = await h.service.createAdminRequest(String(eventId), admin); expect(result.created).toBe(false); expect(h.notifications.enqueueForRequest).not.toHaveBeenCalled(); });
  it('[MX-06][TVD-PUB-P0-009][INTEGRACION] rechaza una firma desde un dispositivo distinto al que reclamó', async () => { const h = publicationHarness(); h.requests.getRequestById.mockResolvedValue({ ...h.request, status: 'SIGNING', claimedByDeviceId: 'device-a' }); await expect(h.service.markMobileSigning('request-1', { sub: String(userId) }, { deviceId: 'device-b' })).rejects.toBeInstanceOf(ConflictException); });
  it('[MX-06][TVD-PUB-P0-010][INTEGRACION] registra un único userOpHash tras validar el dispositivo firmante', async () => { const h = publicationHarness(); h.requests.getRequestById.mockResolvedValue({ ...h.request, status: 'SIGNING', claimedByDeviceId: 'device-1' }); const result = await h.service.registerMobileSubmission('request-1', { sub: String(userId) }, { deviceId: 'device-1', userOpHash: `0x${'1'.repeat(64)}` }); expect(result.status).toBe('SUBMITTED'); expect(h.requests.registerSubmission).toHaveBeenCalledTimes(1); });
  it('[MX-06][TVD-PUB-P0-011][INTEGRACION] conserva la publicación pendiente hasta que el receipt validado finaliza', async () => { const h = publicationHarness(); h.requests.getRequestById.mockResolvedValue({ ...h.request, status: 'SUBMITTED', userOpHash: `0x${'1'.repeat(64)}` }); await expect(h.service.cancelAdminRequest('request-1', admin)).rejects.toBeInstanceOf(ConflictException); expect(h.requests.cancelRequest).not.toHaveBeenCalled(); });
  it('[MX-06][TVD-PUB-P0-012][INTEGRACION] no permite cancelar con evidencia blockchain incompatible o ya enviada', async () => { const h = publicationHarness(); h.requests.getRequestById.mockResolvedValue({ ...h.request, status: 'SUBMITTED', userOpHash: `0x${'1'.repeat(64)}` }); await expect(h.service.cancelAdminRequest('request-1', admin)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'OFFICIAL_PUBLICATION_CANNOT_CANCEL_AFTER_SUBMISSION' }) }); });
  it('[MX-06][TVD-PUB-P0-013][INTEGRACION] trata la misma submission como idempotente sin volver a persistirla', async () => { const h = publicationHarness(); const submitted = { ...h.request, status: 'SUBMITTED', claimedByDeviceId: 'device-1', userOpHash: `0x${'1'.repeat(64)}`, txHash: `0x${'2'.repeat(64)}` }; h.requests.getRequestById.mockResolvedValue(submitted); const result = await h.service.registerMobileSubmission('request-1', { sub: String(userId) }, { deviceId: 'device-1', userOpHash: submitted.userOpHash }); expect(result.status).toBe('SUBMITTED'); expect(h.requests.registerSubmission).not.toHaveBeenCalled(); });
  it('[MX-06][TVD-SEC-P0-001][INTEGRACION] bloquea una asignación cuando el solicitante no tiene rol ADMIN', async () => { const h = manualHarness(); await expect(h.service.createManualAssignment({ tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '25', reason: 'Asignación institucional' }, { sub: String(userId), role: 'USER', active: true }, 'sec-1')).rejects.toBeInstanceOf(ForbiddenException); expect(h.rows).toHaveLength(0); });
  it('[MX-06][TVD-UI-P1-002][INTEGRACION] deja trazabilidad recuperable sin declarar saldo final ante fallo temporal', async () => { const h = paymentHarness(); h.provider.generateQr.mockRejectedValue(new Error('timeout')); await expect(h.service.createQrPayment(qr, admin, 'ui-2')).rejects.toThrow('timeout'); expect(h.model.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ status: 'PROVIDER_ERROR' }) })); });
});
