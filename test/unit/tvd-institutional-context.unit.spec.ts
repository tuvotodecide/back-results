import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TvdQueryService } from '@/modules/tvd/services/tvd-query.service';

const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const walletB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('TvdQueryService institutional context', () => {
  const userId = new Types.ObjectId();
  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();
  const assignmentA = {
    _id: new Types.ObjectId(),
    tenantId: tenantA,
    userId,
    status: 'APPROVED',
    active: true,
    accountAddress: walletA,
    accountAddressNormalized: walletA,
    walletVerifiedAt: new Date(),
    walletVerificationSource: 'TEST',
  };
  const assignmentB = {
    ...assignmentA,
    _id: new Types.ObjectId(),
    tenantId: tenantB,
    accountAddress: walletB,
    accountAddressNormalized: walletB,
  };

  const createService = (options?: {
    assignment?: Record<string, unknown> | null;
    assignments?: Record<string, unknown>[];
    payment?: Record<string, unknown> | null;
  }) => {
    const assignmentModel = {
      findOne: jest.fn(() =>
        lean(options && 'assignment' in options ? options.assignment : assignmentA),
      ),
      find: jest.fn(() => lean(options?.assignments ?? [assignmentA])),
    };
    const tenantModel = {
      findById: jest.fn((id: Types.ObjectId) =>
        lean({ _id: id, active: true, name: `Tenant ${String(id)}` }),
      ),
    };
    const userModel = { findById: jest.fn(() => lean({ _id: userId, active: true })) };
    const accreditationModel = {
      findOne: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue(null),
        sort: jest.fn(() => lean(null)),
      })),
      findById: jest.fn(() => lean(null)),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    const paymentModel = {
      findOne: jest.fn(() => lean(options?.payment ?? null)),
    };
    const blockchain = {
      getLiquidBalance: jest.fn().mockResolvedValue('1000000000000000000'),
      getTokenDecimals: jest.fn().mockResolvedValue(18),
      getTokenSymbol: jest.fn().mockResolvedValue('TVD'),
      getTokenRuntimeContext: jest.fn(() => ({ chainId: 84532, tokenContractAddress: null })),
    };
    const config = { get: jest.fn() };
    const service = new TvdQueryService(
      accreditationModel as any,
      {} as any,
      paymentModel as any,
      tenantModel as any,
      assignmentModel as any,
      userModel as any,
      blockchain as any,
      {} as any,
      config as any,
    );

    return { service, assignmentModel, paymentModel, blockchain };
  };

  const requester = { sub: String(userId), role: 'TENANT_ADMIN', active: true };

  it('usa el tenant B solicitado para el summary y su wallet, sin tomar el primer assignment', async () => {
    const { service, assignmentModel, blockchain } = createService({
      assignment: assignmentB,
    });

    const summary = await service.getMySummary(requester, String(tenantB));

    expect(assignmentModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: new Types.ObjectId(String(tenantB)) }),
    );
    expect(blockchain.getLiquidBalance).toHaveBeenCalledWith(
      expect.stringMatching(/^0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb$/i),
    );
    expect(summary).toMatchObject({
      tenantId: String(tenantB),
      assignmentId: String(assignmentB._id),
      wallet: expect.stringMatching(/^0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb$/i),
    });
  });

  it('exige tenant explícito cuando el usuario tiene más de un assignment activo', async () => {
    const { service, assignmentModel } = createService({
      assignments: [assignmentA, assignmentB],
    });

    await expect(service.resolveMyInstitutionalWallet(requester)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(assignmentModel.findOne).not.toHaveBeenCalled();
  });

  it('rechaza a quien no tiene una asignación institucional activa', async () => {
    const { service } = createService({ assignments: [] });

    await expect(service.resolveMyInstitutionalWallet(requester)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza un tenant ajeno aunque el identificador exista', async () => {
    const { service } = createService({ assignment: null });

    await expect(
      service.resolveMyInstitutionalWallet(requester, String(tenantB)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recupera el detalle de pago con el tenant activo solicitado y no con otro assignment', async () => {
    const paymentId = new Types.ObjectId();
    const payment = {
      _id: paymentId,
      tenantId: tenantB,
      targetAssignmentId: assignmentB._id,
      requestedByUserId: userId,
      targetWallet: walletB,
      targetWalletNormalized: walletB,
      provider: 'RED_ENLACE',
      merchantReference: '100000003',
      amountMinor: '1050',
      currency: 'BOB',
      status: 'QR_ACTIVE',
      regenerationStatus: 'NOT_REGENERABLE',
      regenerationReason: 'PAYMENT_STATUS_QR_ACTIVE',
    };
    const { service, assignmentModel, paymentModel } = createService({
      assignment: assignmentB,
      payment,
    });

    const result = await service.getMyPayment(
      String(paymentId),
      requester,
      String(tenantB),
    );

    expect(result).toMatchObject({
      paymentId: String(paymentId),
      merchantReference: '100000003',
    });
    expect(assignmentModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: new Types.ObjectId(String(tenantB)) }),
    );
    expect(paymentModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: new Types.ObjectId(String(paymentId)),
        tenantId: tenantB,
        targetAssignmentId: assignmentB._id,
      }),
      expect.any(Object),
    );
  });
});
