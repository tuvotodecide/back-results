import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalTenantsService } from '@/modules/institutional-tenants/services/institutional-tenants.service';

describe('InstitutionalTenantsService (unit)', () => {
  let tenantModel: any;
  let assignmentModel: any;
  let roledUserModel: any;
  let httpService: any;
  let configService: any;
  let auditService: any;
  let service: InstitutionalTenantsService;
  let session: any;

  const query = (value: any) => ({
    lean: jest.fn().mockResolvedValue(value),
    sort: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
  });

  const countQuery = (value: number) => ({
    session: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    tenantModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
    };
    session = {
      withTransaction: jest.fn(async (fn) => fn()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    assignmentModel = {
      findOneAndUpdate: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      countDocuments: jest.fn(),
      findById: jest.fn(),
      db: {
        startSession: jest.fn().mockResolvedValue(session),
      },
    };
    roledUserModel = {
      findById: jest.fn(),
      find: jest.fn(),
    };
    httpService = {
      axiosRef: {
        get: jest.fn().mockResolvedValue({ data: { ok: true } }),
      },
    };
    configService = {
      get: jest.fn((key: string, fallback?: any) => {
        if (key === 'app.identity.baseUrl') return 'https://identity.example.test';
        if (key === 'app.identity.apiKey') return 'identity-key';
        if (key === 'IDENTITY_HTTP_TIMEOUT_MS') return 5000;
        return fallback;
      }),
    };
    auditService = {
      record: jest.fn().mockResolvedValue(undefined),
      resolveActorInstitutionalRole: jest.fn().mockResolvedValue(null),
    };
    service = new InstitutionalTenantsService(
      tenantModel,
      assignmentModel,
      roledUserModel,
      httpService,
      configService,
      auditService,
    );
  });

  it('createTenant normaliza nombre, crea tenant activo y retorna shape estable', async () => {
    tenantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    tenantModel.create.mockResolvedValue({
      _id: new Types.ObjectId('64b000000000000000000001'),
      name: 'Mi Institucion',
      description: 'Descripcion',
      active: true,
    });

    await expect(
      service.createTenant({ name: '  Mi   Institucion ', description: ' Descripcion ' }),
    ).resolves.toEqual({
      id: '64b000000000000000000001',
      name: 'Mi Institucion',
      description: 'Descripcion',
      active: true,
    });

    expect(tenantModel.findOne).toHaveBeenCalledWith({
      nameNorm: 'mi institucion',
    });
    expect(tenantModel.create).toHaveBeenCalledWith({
      name: 'Mi Institucion',
      nameNorm: 'mi institucion',
      description: 'Descripcion',
      active: true,
    });
  });

  it('createTenant rechaza nombre duplicado', async () => {
    tenantModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });

    await expect(
      service.createTenant({ name: 'Tenant Duplicado' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('assignAdmin aprueba asignacion para tenant y usuario activos', async () => {
    const tenantId = '64b000000000000000000002';
    const userId = '64b000000000000000000003';
    tenantModel.findById.mockReturnValue(query({ _id: new Types.ObjectId(tenantId), active: true }));
    roledUserModel.findById.mockReturnValue(query({ _id: new Types.ObjectId(userId), active: true }));
    assignmentModel.findOneAndUpdate.mockResolvedValue({});

    await expect(
      service.assignAdmin(tenantId, { userId, active: true }),
    ).resolves.toEqual({ tenantId, userId, active: true });

    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        tenantId: new Types.ObjectId(tenantId),
        userId: new Types.ObjectId(userId),
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'APPROVED',
          active: true,
          approvedAt: expect.any(Date),
          revokedAt: null,
        }),
      }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
  });

  it('assignAdmin rechaza tenant invalido o inactivo', async () => {
    await expect(
      service.assignAdmin('not-valid', { userId: new Types.ObjectId().toString() }),
    ).rejects.toBeInstanceOf(NotFoundException);

    tenantModel.findById.mockReturnValue(query(null));
    await expect(
      service.assignAdmin(new Types.ObjectId().toString(), {
        userId: new Types.ObjectId().toString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ADMIN lista administradores seguros de cualquier tenant sin exponer secretos', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000010');
    const userId = new Types.ObjectId('64b000000000000000000011');
    const assignmentId = new Types.ObjectId('64b000000000000000000012');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.find.mockReturnValue(
      query([
        {
          _id: assignmentId,
          tenantId,
          userId,
          accountAddress: '0x0000000000000000000000000000000000000011',
          institutionalRole: 'PRIMARY',
          status: 'APPROVED',
          active: true,
          requestedAt: new Date('2026-01-01T00:00:00.000Z'),
          approvedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ]),
    );
    roledUserModel.find.mockReturnValue(
      query([{ _id: userId, name: 'Admin Uno', email: 'admin@example.com', active: true }]),
    );

    const result = await service.listAdmins(String(tenantId), { role: 'ADMIN' });

    expect(result).toMatchObject({
      tenantId: String(tenantId),
      total: 1,
      data: [
        {
          assignmentId: String(assignmentId),
          userId: String(userId),
          name: 'Admin Uno',
          email: 'admin@example.com',
          accountAddress: '0x0000000000000000000000000000000000000011',
          institutionalRole: 'PRIMARY',
          status: 'APPROVED',
          active: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('dni');
  });

  it('PRIMARY lista su tenant pero no otro tenant, y SECONDARY no administra', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000020');
    const requesterId = new Types.ObjectId('64b000000000000000000021');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValueOnce(query({
      _id: new Types.ObjectId(),
      tenantId,
      userId: requesterId,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    }));
    assignmentModel.find.mockReturnValue(query([]));
    roledUserModel.find.mockReturnValue(query([]));

    await expect(
      service.listAdmins(String(tenantId), { role: 'USER', sub: String(requesterId) }),
    ).resolves.toMatchObject({ tenantId: String(tenantId), total: 0 });

    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValueOnce(query(null));
    await expect(
      service.listAdmins(String(tenantId), { role: 'USER', sub: String(new Types.ObjectId()) }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('listado devuelve assignment heredado sin rol como null y no lo infiere como PRIMARY', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000030');
    const requesterId = new Types.ObjectId('64b000000000000000000031');
    const legacyUserId = new Types.ObjectId('64b000000000000000000032');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValue(query({
      _id: new Types.ObjectId(),
      tenantId,
      userId: requesterId,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    }));
    assignmentModel.find.mockReturnValue(query([{
      _id: new Types.ObjectId(),
      tenantId,
      userId: legacyUserId,
      status: 'APPROVED',
      active: true,
      accountAddress: '0x0000000000000000000000000000000000000032',
    }]));
    roledUserModel.find.mockReturnValue(query([]));

    const result = await service.listAdmins(String(tenantId), {
      role: 'USER',
      sub: String(requesterId),
    });

    expect(result.data[0].institutionalRole).toBeNull();
  });

  it('PRIMARY deshabilita SECONDARY del mismo tenant sin borrar wallet ni historial', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000040');
    const primaryUserId = new Types.ObjectId('64b000000000000000000041');
    const secondaryId = new Types.ObjectId('64b000000000000000000042');
    const secondary = {
      _id: secondaryId,
      tenantId,
      userId: new Types.ObjectId(),
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      accountAddress: '0x0000000000000000000000000000000000000042',
      approvedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne
      .mockReturnValueOnce(query({
        _id: new Types.ObjectId(),
        tenantId,
        userId: primaryUserId,
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      }))
      .mockReturnValueOnce(query(secondary));
    assignmentModel.findOneAndUpdate.mockResolvedValue({
      ...secondary,
      status: 'REVOKED',
      active: false,
      revokedAt: new Date(),
    });

    const result = await service.updateAdminStatus(
      String(tenantId),
      String(secondaryId),
      { active: false, reason: 'pausa' },
      { role: 'USER', sub: String(primaryUserId) },
    );

    expect(result).toMatchObject({
      assignmentId: String(secondaryId),
      accountAddress: secondary.accountAddress,
      institutionalRole: 'SECONDARY',
      status: 'REVOKED',
      active: false,
    });
    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: secondaryId, tenantId, institutionalRole: 'SECONDARY' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'REVOKED',
          active: false,
          reason: 'pausa',
        }),
      }),
      expect.objectContaining({ returnDocument: 'after' }),
    );
  });

  it('ADMIN rehabilita SECONDARY con wallet y usuario activo sin cambiarlo a PRIMARY', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000050');
    const secondaryId = new Types.ObjectId('64b000000000000000000051');
    const secondary = {
      _id: secondaryId,
      tenantId,
      userId: new Types.ObjectId('64b000000000000000000052'),
      institutionalRole: 'SECONDARY',
      status: 'REVOKED',
      active: false,
      accountAddress: '0x0000000000000000000000000000000000000052',
    };
    tenantModel.findById
      .mockReturnValueOnce(query({ _id: tenantId, active: true }))
      .mockReturnValueOnce(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValueOnce(query(secondary));
    roledUserModel.findById.mockReturnValue(query({ _id: secondary.userId, active: true }));
    assignmentModel.find.mockReturnValue(query([]));
    assignmentModel.findOneAndUpdate.mockResolvedValue({
      ...secondary,
      status: 'APPROVED',
      active: true,
      approvedAt: new Date(),
    });

    const result = await service.updateAdminStatus(
      String(tenantId),
      String(secondaryId),
      { active: true },
      { role: 'ADMIN', sub: String(new Types.ObjectId()) },
    );

    expect(result).toMatchObject({
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      accountAddress: secondary.accountAddress,
    });
  });

  it('bloquea rehabilitacion si falta wallet, usuario activo o tenant activo', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000060');
    const secondaryId = new Types.ObjectId('64b000000000000000000061');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValueOnce(query({
      _id: secondaryId,
      tenantId,
      userId: new Types.ObjectId(),
      institutionalRole: 'SECONDARY',
      status: 'REVOKED',
      active: false,
      accountAddress: null,
    }));

    await expect(
      service.updateAdminStatus(
        String(tenantId),
        String(secondaryId),
        { active: true },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: false }));
    await expect(
      service.updateAdminStatus(
        String(tenantId),
        String(secondaryId),
        { active: true },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bloquea SECONDARY administrando y bloquea endpoint de status contra PRIMARY', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000070');
    const requesterId = new Types.ObjectId('64b000000000000000000071');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValueOnce(query(null));

    await expect(
      service.updateAdminStatus(
        String(tenantId),
        String(new Types.ObjectId()),
        { active: false },
        { role: 'USER', sub: String(requesterId) },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne
      .mockReturnValueOnce(query({
        _id: new Types.ObjectId(),
        tenantId,
        userId: requesterId,
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      }))
      .mockReturnValueOnce(query({
        _id: new Types.ObjectId(),
        tenantId,
        userId: new Types.ObjectId(),
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      }));

    await expect(
      service.updateAdminStatus(
        String(tenantId),
        String(new Types.ObjectId()),
        { active: false },
        { role: 'USER', sub: String(requesterId) },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('PRIMARY transfiere a SECONDARY elegible y preserva wallets con exactamente un PRIMARY', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000080');
    const primaryId = new Types.ObjectId('64b000000000000000000081');
    const targetId = new Types.ObjectId('64b000000000000000000082');
    const primaryUserId = new Types.ObjectId('64b000000000000000000083');
    const targetUserId = new Types.ObjectId('64b000000000000000000084');
    const primary = {
      _id: primaryId,
      tenantId,
      userId: primaryUserId,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      accountAddress: '0x0000000000000000000000000000000000000083',
    };
    const target = {
      _id: targetId,
      tenantId,
      userId: targetUserId,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      accountAddress: '0x0000000000000000000000000000000000000084',
    };
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne
      .mockReturnValueOnce(query(target))
      .mockReturnValueOnce(query(primary));
    assignmentModel.find
      .mockReturnValueOnce(query([primary]))
      .mockReturnValueOnce(query([]));
    roledUserModel.findById.mockReturnValue(query({ _id: targetUserId, active: true }));
    assignmentModel.updateOne
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    assignmentModel.countDocuments.mockReturnValue(countQuery(1));

    await expect(
      service.transferPrimary(
        String(tenantId),
        { assignmentId: String(targetId), reason: 'rotacion' },
        { role: 'USER', sub: String(primaryUserId) },
      ),
    ).resolves.toMatchObject({
      tenantId: String(tenantId),
      previousPrimaryAssignmentId: String(primaryId),
      primaryAssignmentId: String(targetId),
    });
    expect(session.withTransaction).toHaveBeenCalled();
    expect(assignmentModel.updateOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: primaryId, institutionalRole: 'PRIMARY' }),
      expect.objectContaining({ $set: expect.objectContaining({ institutionalRole: 'SECONDARY' }) }),
      { session },
    );
    expect(assignmentModel.updateOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: targetId, institutionalRole: 'SECONDARY' }),
      expect.objectContaining({ $set: expect.objectContaining({ institutionalRole: 'PRIMARY' }) }),
      { session },
    );
  });

  it('ADMIN designa PRIMARY cuando el tenant no tiene principal y bloquea ACCESS_APPROVER', async () => {
    const tenantId = new Types.ObjectId('64b000000000000000000090');
    const targetId = new Types.ObjectId('64b000000000000000000091');
    const target = {
      _id: targetId,
      tenantId,
      userId: new Types.ObjectId(),
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      accountAddress: '0x0000000000000000000000000000000000000091',
    };
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValue(query(target));
    assignmentModel.find
      .mockReturnValueOnce(query([]))
      .mockReturnValueOnce(query([]));
    roledUserModel.findById.mockReturnValue(query({ _id: target.userId, active: true }));
    assignmentModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    assignmentModel.countDocuments.mockReturnValue(countQuery(1));

    await expect(
      service.transferPrimary(
        String(tenantId),
        { assignmentId: String(targetId) },
        { role: 'ADMIN', sub: String(new Types.ObjectId()) },
      ),
    ).resolves.toMatchObject({
      previousPrimaryAssignmentId: null,
      primaryAssignmentId: String(targetId),
    });

    assignmentModel.findOne.mockClear();
    assignmentModel.find.mockClear();
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValue(query(target));
    assignmentModel.find.mockReturnValue(query([]));
    await expect(
      service.transferPrimary(
        String(tenantId),
        { assignmentId: String(targetId) },
        { role: 'ACCESS_APPROVER', sub: String(new Types.ObjectId()) },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('bloquea transferencia a target invalido, inactivo, sin wallet o cross-tenant', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000a0');
    const targetId = new Types.ObjectId('64b0000000000000000000a1');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValue(query(null));

    await expect(
      service.transferPrimary(
        String(tenantId),
        { assignmentId: String(targetId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValue(query({
      _id: targetId,
      tenantId,
      institutionalRole: 'SECONDARY',
      status: 'REVOKED',
      active: false,
      accountAddress: '0x00000000000000000000000000000000000000a1',
    }));
    await expect(
      service.transferPrimary(
        String(tenantId),
        { assignmentId: String(targetId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.transferPrimary('bad', { assignmentId: String(targetId) }, { role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revierte la transferencia ante fallo intermedio y traduce E11000 o WriteConflict', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000b0');
    const targetId = new Types.ObjectId('64b0000000000000000000b1');
    const duplicate = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { tenantId: 1, institutionalRole: 1 },
    });
    session.withTransaction.mockImplementationOnce(async (fn) => {
      await fn();
    });
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    assignmentModel.findOne.mockReturnValue(query({
      _id: targetId,
      tenantId,
      userId: new Types.ObjectId(),
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      accountAddress: '0x00000000000000000000000000000000000000b1',
    }));
    assignmentModel.find.mockReturnValue(query([]));
    roledUserModel.findById.mockReturnValue(query({ active: true }));
    assignmentModel.updateOne.mockRejectedValueOnce(duplicate);

    await expect(
      service.transferPrimary(
        String(tenantId),
        { assignmentId: String(targetId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(session.endSession).toHaveBeenCalled();

    assignmentModel.db.startSession.mockResolvedValueOnce({
      withTransaction: jest.fn().mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 112 })),
      endSession: jest.fn().mockResolvedValue(undefined),
    });
    await expect(
      service.transferPrimary(
        String(tenantId),
        { assignmentId: String(targetId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('regulariza wallet heredada con Identity ok y conserva rol estado y active', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000c0');
    const userId = new Types.ObjectId('64b0000000000000000000c1');
    const assignmentId = new Types.ObjectId('64b0000000000000000000c2');
    const wallet = '0x00000000000000000000000000000000000000c2';
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: true, dni: '12345678' }));
    assignmentModel.find
      .mockReturnValueOnce(query([{
        _id: assignmentId,
        tenantId,
        userId,
        institutionalRole: 'SECONDARY',
        status: 'APPROVED',
        active: true,
        accountAddress: null,
      }]))
      .mockReturnValueOnce(query([]));
    assignmentModel.findOneAndUpdate.mockResolvedValue({
      _id: assignmentId,
      tenantId,
      userId,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      accountAddress: wallet,
      accountAddressNormalized: wallet.toLowerCase(),
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'LEGACY_REGULARIZATION',
    });

    const result = await service.regularizeOwnWallet(
      String(tenantId),
      { accountAddress: wallet },
      { sub: String(userId), role: 'USER' },
    );

    expect(result).toMatchObject({
      assignmentId: String(assignmentId),
      userId: String(userId),
      tenantId: String(tenantId),
      accountAddress: wallet,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      hasWallet: true,
      requiresWalletUpdate: false,
      walletStatus: 'VERIFIED',
      updated: true,
    });
    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/has-dni',
      expect.objectContaining({
        params: { account: wallet, dnis: '12345678' },
        headers: { 'x-api-key': 'identity-key' },
      }),
    );
    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: assignmentId,
        tenantId,
        userId,
        active: true,
        status: 'APPROVED',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          accountAddress: wallet,
          accountAddressNormalized: wallet.toLowerCase(),
          walletVerifiedAt: expect.any(Date),
          walletVerifiedBy: expect.any(Types.ObjectId),
          walletVerificationSource: 'LEGACY_REGULARIZATION',
        }),
      }),
      expect.objectContaining({ returnDocument: 'after' }),
    );
  });

  it('regulariza misma wallet con metadata faltante y la completa', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000c3');
    const userId = new Types.ObjectId('64b0000000000000000000c4');
    const assignmentId = new Types.ObjectId('64b0000000000000000000c5');
    const wallet = '0x00000000000000000000000000000000000000c5';
    const assignment = {
      _id: assignmentId,
      tenantId,
      userId,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      accountAddress: wallet,
      accountAddressNormalized: wallet.toLowerCase(),
      walletVerifiedAt: null,
      walletVerificationSource: null,
    };
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: true, dni: '12345678' }));
    assignmentModel.find
      .mockReturnValueOnce(query([assignment]))
      .mockReturnValueOnce(query([assignment]));
    assignmentModel.findOneAndUpdate.mockResolvedValue({
      ...assignment,
      walletVerifiedAt: new Date(),
      walletVerifiedBy: userId,
      walletVerificationSource: 'LEGACY_REGULARIZATION',
    });

    const result = await service.regularizeOwnWallet(
      String(tenantId),
      { accountAddress: wallet },
      { sub: String(userId), role: 'USER' },
    );

    expect(result).toMatchObject({
      assignmentId: String(assignmentId),
      hasWallet: true,
      requiresWalletUpdate: false,
      walletStatus: 'VERIFIED',
      updated: true,
    });
    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/has-dni',
      expect.objectContaining({
        params: { account: wallet, dnis: '12345678' },
      }),
    );
    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: assignmentId,
        accountAddress: expect.any(RegExp),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          accountAddress: wallet,
          accountAddressNormalized: wallet.toLowerCase(),
          walletVerifiedAt: expect.any(Date),
          walletVerifiedBy: expect.any(Types.ObjectId),
          walletVerificationSource: 'LEGACY_REGULARIZATION',
        }),
      }),
      expect.objectContaining({ returnDocument: 'after' }),
    );
  });

  it('regularizacion con misma wallet y metadata completa es idempotente', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000c6');
    const userId = new Types.ObjectId('64b0000000000000000000c7');
    const assignmentId = new Types.ObjectId('64b0000000000000000000c8');
    const wallet = '0x00000000000000000000000000000000000000c8';
    const assignment = {
      _id: assignmentId,
      tenantId,
      userId,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      accountAddress: wallet,
      accountAddressNormalized: wallet.toLowerCase(),
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'LEGACY_REGULARIZATION',
    };
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: true, dni: '12345678' }));
    assignmentModel.find.mockReturnValueOnce(query([assignment]));

    const result = await service.regularizeOwnWallet(
      String(tenantId),
      { accountAddress: wallet },
      { sub: String(userId), role: 'USER' },
    );

    expect(result).toMatchObject({
      hasWallet: true,
      requiresWalletUpdate: false,
      walletStatus: 'VERIFIED',
      updated: false,
    });
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('regularizacion bloquea wallet invalida, Identity false y timeout sin persistir', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000d0');
    const userId = new Types.ObjectId('64b0000000000000000000d1');
    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x123' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();

    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: true, dni: '12345678' }));
    assignmentModel.find
      .mockReturnValueOnce(query([{
        _id: new Types.ObjectId(),
        tenantId,
        userId,
        status: 'APPROVED',
        active: true,
        accountAddress: null,
      }]))
      .mockReturnValueOnce(query([]));
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { ok: false } });
    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000d1' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();

    assignmentModel.find
      .mockReturnValueOnce(query([{
        _id: new Types.ObjectId(),
        tenantId,
        userId,
        status: 'APPROVED',
        active: true,
        accountAddress: null,
      }]))
      .mockReturnValueOnce(query([]));
    httpService.axiosRef.get.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000d2' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toThrow('No se pudo verificar la wallet');
  });

  it('regularizacion bloquea wallet usada por otro usuario, tenant ajeno y relacion ambigua', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000e0');
    const userId = new Types.ObjectId('64b0000000000000000000e1');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: true, dni: '12345678' }));
    assignmentModel.find
      .mockReturnValueOnce(query([]));

    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000e1' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    assignmentModel.find
      .mockReturnValueOnce(query([{
        _id: new Types.ObjectId(),
        tenantId,
        userId,
        status: 'APPROVED',
        active: true,
        accountAddress: null,
      }]))
      .mockReturnValueOnce(query([{
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        accountAddress: '0x00000000000000000000000000000000000000e2',
      }]));
    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000e2' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();

    tenantModel.findById.mockReturnValueOnce(query({ _id: tenantId, active: false }));
    roledUserModel.findById.mockReturnValueOnce(query({ _id: userId, active: true, dni: '12345678' }));
    assignmentModel.find.mockReturnValueOnce(query([{
      _id: new Types.ObjectId(),
      tenantId,
      userId,
      status: 'APPROVED',
      active: true,
      accountAddress: null,
    }]));
    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000e3' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('regularizacion requiere usuario activo con DNI y assignment activo aprobado', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000f0');
    const userId = new Types.ObjectId('64b0000000000000000000f1');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: false, dni: '12345678' }));
    assignmentModel.find.mockReturnValue(query([{
      _id: new Types.ObjectId(),
      tenantId,
      userId,
      status: 'APPROVED',
      active: true,
      accountAddress: null,
    }]));

    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000f1' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: true, dni: '' }));
    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000f1' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: true, dni: '12345678' }));
    assignmentModel.find.mockReturnValue(query([{
      _id: new Types.ObjectId(),
      tenantId,
      userId,
      status: 'REVOKED',
      active: false,
      accountAddress: null,
    }]));
    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000f1' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('regularizacion es idempotente con la misma wallet y no reemplaza wallet distinta', async () => {
    const tenantId = new Types.ObjectId('64b0000000000000000000f2');
    const userId = new Types.ObjectId('64b0000000000000000000f3');
    const assignmentId = new Types.ObjectId('64b0000000000000000000f4');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(query({ _id: userId, active: true, dni: '12345678' }));
    assignmentModel.find.mockReturnValueOnce(query([{
      _id: assignmentId,
      tenantId,
      userId,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      accountAddress: '0x00000000000000000000000000000000000000f4',
      accountAddressNormalized: '0x00000000000000000000000000000000000000f4',
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'LEGACY_REGULARIZATION',
    }]));

    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000F4' },
        { sub: String(userId), role: 'USER' },
      ),
    ).resolves.toMatchObject({ updated: false });
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();

    assignmentModel.find.mockReturnValueOnce(query([{
      _id: assignmentId,
      tenantId,
      userId,
      status: 'APPROVED',
      active: true,
      accountAddress: '0x00000000000000000000000000000000000000f4',
    }]));
    await expect(
      service.regularizeOwnWallet(
        String(tenantId),
        { accountAddress: '0x00000000000000000000000000000000000000f5' },
        { sub: String(userId), role: 'USER' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
