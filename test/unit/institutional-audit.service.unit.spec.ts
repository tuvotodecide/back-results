import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';

describe('InstitutionalAuditService (unit)', () => {
  let auditEventModel: any;
  let assignmentModel: any;
  let tenantModel: any;
  let service: InstitutionalAuditService;

  const tenantId = new Types.ObjectId('64d000000000000000000001');
  const actorId = new Types.ObjectId('64d000000000000000000002');
  const targetUserId = new Types.ObjectId('64d000000000000000000003');

  const query = (value: any) => ({
    lean: jest.fn().mockResolvedValue(value),
    session: jest.fn().mockReturnThis(),
  });

  beforeEach(() => {
    auditEventModel = {
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    assignmentModel = {
      findOne: jest.fn(),
    };
    tenantModel = {
      findById: jest.fn(),
    };
    service = new InstitutionalAuditService(
      auditEventModel,
      assignmentModel,
      tenantModel,
    );
  });

  it('registra eventos append-only y sanitiza secretos, DNI, tokens, correos y telefonos', async () => {
    auditEventModel.create.mockImplementation(async (doc: any) => doc);

    await service.record({
      tenantId,
      actor: { sub: String(actorId), role: 'ADMIN' },
      action: 'INSTITUTIONAL_APPLICATION_CREATED',
      targetType: 'InstitutionalAdminApplication',
      targetId: 'application-1',
      targetUserId,
      applicationId: new Types.ObjectId('64d000000000000000000004'),
      previousState: {
        password: 'secret',
        passwordHash: 'hash',
        verificationToken: 'token',
        passwordResetToken: 'reset',
        dni: '123456',
        email: 'admin@example.com',
        phoneNumber: '77777777',
        identityResponse: { ok: true, discoverableHash: 'hash' },
        status: 'PENDING',
      },
      newState: {
        status: 'PENDING_APPROVAL',
        hasAccountAddress: true,
        nested: { apiKey: 'key', safe: 'ok' },
      },
      reason: '  revision  ',
      correlationId: 'req-1',
    });

    expect(auditEventModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorUserId: actorId,
        actorGlobalRole: 'ADMIN',
        action: 'INSTITUTIONAL_APPLICATION_CREATED',
        targetType: 'InstitutionalAdminApplication',
        targetUserId,
        previousState: { status: 'PENDING' },
        newState: {
          status: 'PENDING_APPROVAL',
          hasAccountAddress: true,
          nested: { safe: 'ok' },
        },
        reason: 'revision',
        correlationId: 'req-1',
        createdAt: expect.any(Date),
      }),
    );
  });

  it('registra dentro de la sesion cuando existe transaccion', async () => {
    const session = { id: 'session' } as any;
    auditEventModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

    await service.record({
      tenantId,
      actor: { sub: String(actorId), role: 'ADMIN' },
      action: 'TENANT_PRIMARY_TRANSFERRED',
      targetType: 'TenantAdminAssignment',
      targetId: 'assignment-1',
      session,
    });

    expect(auditEventModel.create).toHaveBeenCalledWith(
      [expect.objectContaining({ action: 'TENANT_PRIMARY_TRANSFERRED' })],
      { session },
    );
  });

  it('resuelve rol institucional activo del actor contra DB', async () => {
    assignmentModel.findOne.mockReturnValue(query({ institutionalRole: 'PRIMARY' }));

    await expect(
      service.resolveActorInstitutionalRole(tenantId, { sub: String(actorId), role: 'USER' }),
    ).resolves.toBe('PRIMARY');
    expect(assignmentModel.findOne).toHaveBeenCalledWith({
      tenantId,
      userId: actorId,
      status: 'APPROVED',
      active: true,
      institutionalRole: { $in: ['PRIMARY', 'SECONDARY'] },
    });
  });

  it('ADMIN consulta cualquier tenant con paginacion, orden y filtros seguros', async () => {
    const eventId = new Types.ObjectId('64d000000000000000000005');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    auditEventModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: eventId,
        tenantId,
        actorUserId: actorId,
        action: 'INSTITUTIONAL_RECOVERY_APPROVED',
        targetType: 'InstitutionalAccessRecoveryRequest',
        targetId: 'recovery-1',
        targetUserId,
        previousState: { status: 'PENDING' },
        newState: { status: 'APPROVED' },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }]),
    });
    auditEventModel.countDocuments.mockResolvedValue(1);

    const result = await service.listTenantAudit(
      String(tenantId),
      {
        action: 'INSTITUTIONAL_RECOVERY_APPROVED',
        actorUserId: String(actorId),
        targetUserId: String(targetUserId),
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
        page: 2,
        limit: 10,
      },
      { sub: String(actorId), role: 'ADMIN' },
    );

    expect(auditEventModel.find).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      action: 'INSTITUTIONAL_RECOVERY_APPROVED',
      actorUserId: actorId,
      targetUserId,
      createdAt: {
        $gte: new Date('2026-01-01T00:00:00.000Z'),
        $lte: new Date('2026-01-02T00:00:00.000Z'),
      },
    }));
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      limit: 10,
      data: [expect.objectContaining({
        id: String(eventId),
        tenantId: String(tenantId),
        actorUserId: String(actorId),
        targetUserId: String(targetUserId),
      })],
    });
  });

  it('PRIMARY consulta solo su tenant y SECONDARY o ACCESS_APPROVER quedan bloqueados', async () => {
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    auditEventModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    auditEventModel.countDocuments.mockResolvedValue(0);
    assignmentModel.findOne.mockReturnValueOnce(query({ institutionalRole: 'PRIMARY' }));

    await expect(
      service.listTenantAudit(String(tenantId), {}, { sub: String(actorId), role: 'USER' }),
    ).resolves.toMatchObject({ total: 0 });

    assignmentModel.findOne.mockReturnValueOnce(query(null));
    await expect(
      service.listTenantAudit(String(tenantId), {}, { sub: String(actorId), role: 'USER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    assignmentModel.findOne.mockReturnValueOnce(query(null));
    await expect(
      service.listTenantAudit(String(tenantId), {}, { sub: String(actorId), role: 'ACCESS_APPROVER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza tenant inexistente y no expone eventos globales sin tenant por ruta de tenant', async () => {
    tenantModel.findById.mockReturnValue(query(null));

    await expect(
      service.listTenantAudit(String(tenantId), {}, { sub: String(actorId), role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditEventModel.find).not.toHaveBeenCalled();
  });
});
