import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalAccessRecoveryRequestsService } from '@/modules/institutional-access-recovery-requests/services/institutional-access-recovery-requests.service';

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Recuperación de acceso unitarias', () => {
  let recoveryRequestModel: any;
  let tenantModel: any;
  let assignmentModel: any;
  let roledUserModel: any;
  let mailService: any;
  let configService: any;
  let auditService: any;
  let service: InstitutionalAccessRecoveryRequestsService;
  let session: any;

  const query = (value: any) => ({
    lean: jest.fn().mockResolvedValue(value),
    sort: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
  });

  const sessionDocQuery = (value: any) => ({
    session: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    session = {
      withTransaction: jest.fn(async (fn) => fn()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    recoveryRequestModel = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    tenantModel = {
      findById: jest.fn(),
    };
    assignmentModel = {
      find: jest.fn(),
      findOne: jest.fn(),
    };
    roledUserModel = {
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
    };
    mailService = {
      enqueueInstitutionalPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      enqueueInstitutionalEmailChangeNotice: jest.fn().mockResolvedValue(undefined),
      processPendingBatch: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string, fallback?: any) => {
        if (key === 'app.mail.passwordResetBaseUrl') return 'https://front.example.test';
        if (key === 'app.mail.passwordResetTokenTTLHours') return 2;
        return fallback;
      }),
    };
    auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    service = new InstitutionalAccessRecoveryRequestsService(
      recoveryRequestModel,
      tenantModel,
      assignmentModel,
      roledUserModel,
      mailService,
      configService,
      auditService,
    );
  });

it('D-MAIL-001 | crea solicitud valida pendiente sin cambiar correo ni exponer candidato', async () => {
    const tenantId = new Types.ObjectId('64c000000000000000000001');
    const userId = new Types.ObjectId('64c000000000000000000002');
    const assignmentId = new Types.ObjectId('64c000000000000000000003');
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, name: 'Tenant Uno', active: true }));
    roledUserModel.findOne.mockReturnValue(query(null));
    recoveryRequestModel.findOne.mockReturnValue(query(null));
    assignmentModel.find.mockReturnValue(query([{
      _id: assignmentId,
      tenantId,
      userId,
      accountAddress: '0x0000000000000000000000000000000000000001',
      institutionalRole: 'PRIMARY',
    }]));
    roledUserModel.find.mockReturnValue(query([{
      _id: userId,
      name: 'Admin Principal',
      email: 'old@example.com',
    }]));
    recoveryRequestModel.create.mockResolvedValue({
      _id: new Types.ObjectId('64c000000000000000000004'),
      status: 'PENDING',
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.createRequest({
      institutionId: String(tenantId),
      fullName: ' Admin   Principal ',
      newEmail: 'NEW@EXAMPLE.COM',
    });

    expect(result).toEqual({
      requestId: '64c000000000000000000004',
      status: 'PENDING',
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(recoveryRequestModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        fullName: 'Admin Principal',
        newEmail: 'new@example.com',
        candidateUserId: userId,
        candidateAssignmentId: assignmentId,
        currentEmail: 'old@example.com',
        accountAddress: '0x0000000000000000000000000000000000000001',
        institutionalRole: 'PRIMARY',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('old@example.com');
    expect(mailService.enqueueInstitutionalPasswordResetEmail).not.toHaveBeenCalled();
  });

it('D-MAIL-002 / D-MAIL-005 | rechaza institucion inexistente, email duplicado y solicitud pendiente duplicada', async () => {
    const tenantId = new Types.ObjectId('64c000000000000000000010');
    tenantModel.findById.mockReturnValue(query(null));
    await expect(
      service.createRequest({
        institutionId: String(tenantId),
        fullName: 'Admin',
        newEmail: 'new@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true, name: 'Tenant' }));
    roledUserModel.findOne.mockReturnValue(query({ _id: new Types.ObjectId() }));
    await expect(
      service.createRequest({
        institutionId: String(tenantId),
        fullName: 'Admin',
        newEmail: 'used@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    roledUserModel.findOne.mockReturnValue(query(null));
    recoveryRequestModel.findOne.mockReturnValue(query({ _id: new Types.ObjectId() }));
    await expect(
      service.createRequest({
        institutionId: String(tenantId),
        fullName: 'Admin',
        newEmail: 'new@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

it('D-MAIL-006 | deja pendiente sin candidato cuando la coincidencia es ambigua o inexistente', async () => {
    const tenantId = new Types.ObjectId('64c000000000000000000020');
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true, name: 'Tenant' }));
    roledUserModel.findOne.mockReturnValue(query(null));
    recoveryRequestModel.findOne.mockReturnValue(query(null));
    assignmentModel.find.mockReturnValue(query([
      { _id: new Types.ObjectId(), tenantId, userId: userA },
      { _id: new Types.ObjectId(), tenantId, userId: userB },
    ]));
    roledUserModel.find.mockReturnValue(query([
      { _id: userA, name: 'Admin Repetido', email: 'a@example.com' },
      { _id: userB, name: 'Admin Repetido', email: 'b@example.com' },
    ]));
    recoveryRequestModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      status: 'PENDING',
      requestedAt: new Date(),
    });

    await service.createRequest({
      institutionId: String(tenantId),
      fullName: 'Admin Repetido',
      newEmail: 'new@example.com',
    });

    expect(recoveryRequestModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateUserId: null,
        candidateAssignmentId: null,
        warnings: ['AMBIGUOUS_CANDIDATE'],
      }),
    );
  });

  it('D-MAIL-001 | normaliza y crea solicitud autenticada sin aceptar identidad ni wallet del cliente', async () => {
    const tenantId = new Types.ObjectId('64c000000000000000000080');
    const userId = new Types.ObjectId('64c000000000000000000081');
    const assignmentId = new Types.ObjectId('64c000000000000000000082');
    const createdAt = new Date('2026-07-28T12:00:00.000Z');
    const user = {
      _id: userId,
      dni: '1234567',
      email: 'actual@example.com',
      name: 'Admin Mail',
      active: true,
      password: 'hash-preservado',
    };
    const assignment = {
      _id: assignmentId,
      tenantId,
      userId,
      accountAddress: '0x0000000000000000000000000000000000000082',
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    };
    roledUserModel.findById.mockReturnValue(query(user));
    roledUserModel.findOne.mockReturnValue(query(null));
    recoveryRequestModel.findOne.mockReturnValue(query(null));
    assignmentModel.findOne.mockReturnValue(query(assignment));
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, name: 'Tenant Mail', active: true }));
    recoveryRequestModel.create.mockResolvedValue({
      _id: new Types.ObjectId('64c000000000000000000083'),
      status: 'PENDING',
      requestedAt: createdAt,
    });

    const result = await service.createEmailChangeRequest(
      {
        newEmail: '  Nuevo.Mail@Example.COM  ',
        reason: '  Cambio   solicitado  ',
      },
      {
        sub: String(userId),
        role: 'TENANT_ADMIN',
        userId: 'cliente-manipulado',
        dni: 'dni-cliente',
        accountAddress: '0x0000000000000000000000000000000000000999',
      },
    );

    expect(result).toEqual({
      requestId: '64c000000000000000000083',
      status: 'PENDING',
      currentEmail: 'actual@example.com',
      newEmail: 'nuevo.mail@example.com',
      requestedAt: createdAt,
    });
    expect(recoveryRequestModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'ADMIN_EMAIL_CHANGE',
        tenantId,
        institutionName: 'Tenant Mail',
        fullName: 'Admin Mail',
        newEmail: 'nuevo.mail@example.com',
        status: 'PENDING',
        candidateUserId: userId,
        candidateAssignmentId: assignmentId,
        currentEmail: 'actual@example.com',
        accountAddress: assignment.accountAddress,
        institutionalRole: 'PRIMARY',
      }),
    );
    expect(recoveryRequestModel.create.mock.calls[0][0]).not.toHaveProperty('dni');
    expect(recoveryRequestModel.create.mock.calls[0][0]).not.toHaveProperty('password');
    expect(mailService.enqueueInstitutionalPasswordResetEmail).not.toHaveBeenCalled();
    expect(mailService.enqueueInstitutionalEmailChangeNotice).not.toHaveBeenCalled();
  });

  it('D-MAIL-003 | aprueba conservando password wallet rol y usando aviso informativo', async () => {
    const requestId = new Types.ObjectId('64c000000000000000000084');
    const tenantId = new Types.ObjectId('64c000000000000000000085');
    const userId = new Types.ObjectId('64c000000000000000000086');
    const assignmentId = new Types.ObjectId('64c000000000000000000087');
    const requestDoc: any = {
      _id: requestId,
      requestType: 'ADMIN_EMAIL_CHANGE',
      tenantId,
      institutionName: 'Tenant Mail',
      fullName: 'Admin Mail',
      newEmail: 'nuevo@example.com',
      status: 'PENDING',
      candidateUserId: userId,
      candidateAssignmentId: assignmentId,
      currentEmail: 'actual@example.com',
      accountAddress: '0x0000000000000000000000000000000000000087',
      institutionalRole: 'PRIMARY',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const userDoc: any = {
      _id: userId,
      dni: '1234567',
      email: 'actual@example.com',
      name: 'Admin Mail',
      password: 'hash-preservado',
      authVersion: 3,
      active: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery(requestDoc));
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(sessionDocQuery(userDoc));
    assignmentModel.findOne.mockReturnValue(query({
      _id: assignmentId,
      tenantId,
      userId,
      accountAddress: '0x0000000000000000000000000000000000000087',
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    }));
    roledUserModel.findOne.mockReturnValue(query(null));

    const result = await service.approveEmailChangeRequest(
      String(requestId),
      { reason: 'Aprobado' },
      { role: 'ADMIN', sub: String(new Types.ObjectId()) },
    );

    expect(result).toMatchObject({
      requestId: String(requestId),
      tenantId: String(tenantId),
      userId: String(userId),
      assignmentId: String(assignmentId),
      status: 'APPROVED',
    });
    expect(userDoc).toMatchObject({
      email: 'nuevo@example.com',
      password: 'hash-preservado',
      authVersion: 4,
    });
    expect(userDoc.passwordResetToken).toBeUndefined();
    expect(requestDoc.accountAddress).toBe('0x0000000000000000000000000000000000000087');
    expect(requestDoc.institutionalRole).toBe('PRIMARY');
    expect(mailService.enqueueInstitutionalEmailChangeNotice).toHaveBeenCalledWith({
      recipient: 'nuevo@example.com',
      name: 'Admin Mail',
      targetId: userId,
      correlationId: String(requestId),
      previousEmail: 'actual@example.com',
      session,
    });
    expect(mailService.enqueueInstitutionalPasswordResetEmail).not.toHaveBeenCalled();
    expect(mailService.processPendingBatch).toHaveBeenCalledWith(1);
  });

it('D-MAIL-012 | lista y detalla solo para ADMIN con campos administrativos seguros', async () => {
    const requestId = new Types.ObjectId('64c000000000000000000030');
    const row = {
      _id: requestId,
      tenantId: new Types.ObjectId(),
      institutionName: 'Tenant',
      fullName: 'Admin',
      phoneNumber: '70000001',
      newEmail: 'new@example.com',
      supervisorPhoneNumber: '70000002',
      status: 'PENDING',
      requestedAt: new Date(),
      candidateUserId: new Types.ObjectId(),
      candidateAssignmentId: new Types.ObjectId(),
      currentEmail: 'old@example.com',
      accountAddress: '0x0000000000000000000000000000000000000001',
      institutionalRole: 'SECONDARY',
      warnings: [],
    };
    recoveryRequestModel.find.mockReturnValue(query([row]));
    recoveryRequestModel.findById.mockResolvedValue(row);

    await expect(service.listRequests({ role: 'USER' })).rejects.toBeInstanceOf(ForbiddenException);
    const list = await service.listRequests({ role: 'ADMIN' });
    expect(list.data[0]).not.toHaveProperty('currentEmail');

    const detail = await service.getRequestDetail(String(requestId), { role: 'ADMIN' });
    expect(detail).toMatchObject({
      currentEmail: 'old@example.com',
      accountAddress: row.accountAddress,
      institutionalRole: 'SECONDARY',
    });
    expect(JSON.stringify(detail)).not.toContain('password');
  });

it('D-MAIL-003 / D-MAIL-005 / D-MAIL-006 / D-MAIL-007 / D-MAIL-008 / D-MAIL-009 | aprueba conservando userId tenant assignment wallet rol y estado, y genera reset seguro', async () => {
    const requestId = new Types.ObjectId('64c000000000000000000040');
    const tenantId = new Types.ObjectId('64c000000000000000000041');
    const userId = new Types.ObjectId('64c000000000000000000042');
    const assignmentId = new Types.ObjectId('64c000000000000000000043');
    const requestDoc: any = {
      _id: requestId,
      tenantId,
      newEmail: 'new@example.com',
      status: 'PENDING',
      candidateUserId: userId,
      candidateAssignmentId: assignmentId,
      accountAddress: '0x0000000000000000000000000000000000000043',
      institutionalRole: 'PRIMARY',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const userDoc: any = {
      _id: userId,
      email: 'old@example.com',
      name: 'Admin',
      active: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery(requestDoc));
    tenantModel.findById.mockReturnValue(query({ _id: tenantId, active: true }));
    roledUserModel.findById.mockReturnValue(sessionDocQuery(userDoc));
    assignmentModel.findOne.mockReturnValue(query({
      _id: assignmentId,
      tenantId,
      userId,
      accountAddress: '0x0000000000000000000000000000000000000043',
      institutionalRole: 'PRIMARY',
      status: 'REVOKED',
      active: false,
    }));
    roledUserModel.findOne.mockReturnValue(query(null));

    const result = await service.approveRequest(
      String(requestId),
      { targetUserId: String(userId), targetAssignmentId: String(assignmentId) },
      { role: 'ADMIN', sub: String(new Types.ObjectId()) },
    );

    expect(result).toMatchObject({
      requestId: String(requestId),
      tenantId: String(tenantId),
      userId: String(userId),
      assignmentId: String(assignmentId),
      status: 'APPROVED',
    });
    expect(userDoc.email).toBe('new@example.com');
    expect(userDoc.active).toBe(false);
    expect(userDoc.passwordResetToken).toEqual(expect.any(String));
    expect(userDoc.passwordResetTokenExpiresAt).toBeInstanceOf(Date);
    expect(requestDoc.accountAddress).toBe('0x0000000000000000000000000000000000000043');
    expect(requestDoc.institutionalRole).toBe('PRIMARY');
    expect(mailService.enqueueInstitutionalPasswordResetEmail).toHaveBeenCalledWith({
      recipient: 'new@example.com',
      name: 'Admin',
      targetId: userId,
      session,
    });
    expect(mailService.processPendingBatch).toHaveBeenCalledWith(1);
    expect(JSON.stringify(result)).not.toContain(userDoc.passwordResetToken);
  });

it('D-MAIL-010 / D-MAIL-011 / D-MAIL-012 | bloquea aprobacion repetida, objetivo incoherente y email usado por otro usuario', async () => {
    const requestId = new Types.ObjectId('64c000000000000000000050');
    const tenantId = new Types.ObjectId('64c000000000000000000051');
    const userId = new Types.ObjectId('64c000000000000000000052');
    const assignmentId = new Types.ObjectId('64c000000000000000000053');
    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery({
      _id: requestId,
      tenantId,
      newEmail: 'new@example.com',
      status: 'APPROVED',
    }));
    await expect(
      service.approveRequest(
        String(requestId),
        { targetUserId: String(userId), targetAssignmentId: String(assignmentId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery({
      _id: requestId,
      tenantId,
      newEmail: 'new@example.com',
      status: 'PENDING',
      candidateUserId: userId,
      candidateAssignmentId: assignmentId,
      save: jest.fn(),
    }));
    tenantModel.findById.mockReturnValue(query({ _id: tenantId }));
    roledUserModel.findById.mockReturnValue(sessionDocQuery({
      _id: userId,
      email: 'old@example.com',
      name: 'Admin',
      save: jest.fn(),
    }));
    assignmentModel.findOne.mockReturnValue(query({
      _id: assignmentId,
      tenantId,
      userId: new Types.ObjectId(),
    }));
    roledUserModel.findOne.mockReturnValue(query(null));
    await expect(
      service.approveRequest(
        String(requestId),
        { targetUserId: String(userId), targetAssignmentId: String(assignmentId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    assignmentModel.findOne.mockReturnValue(query({ _id: assignmentId, tenantId, userId }));
    roledUserModel.findOne.mockReturnValue(query({ _id: new Types.ObjectId() }));
    await expect(
      service.approveRequest(
        String(requestId),
        { targetUserId: String(userId), targetAssignmentId: String(assignmentId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

it('D-MAIL-005 | bloquea aprobacion si el objetivo no corresponde al candidato capturado', async () => {
    const requestId = new Types.ObjectId('64c000000000000000000055');
    const tenantId = new Types.ObjectId('64c000000000000000000056');
    const userId = new Types.ObjectId('64c000000000000000000057');
    const assignmentId = new Types.ObjectId('64c000000000000000000058');
    const otherUserId = new Types.ObjectId('64c000000000000000000059');
    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery({
      _id: requestId,
      tenantId,
      newEmail: 'new@example.com',
      status: 'PENDING',
      candidateUserId: userId,
      candidateAssignmentId: assignmentId,
      accountAddress: '0x0000000000000000000000000000000000000058',
      institutionalRole: 'PRIMARY',
      save: jest.fn(),
    }));
    tenantModel.findById.mockReturnValue(query({ _id: tenantId }));
    roledUserModel.findById.mockReturnValue(sessionDocQuery({
      _id: otherUserId,
      email: 'other@example.com',
      name: 'Other Admin',
      save: jest.fn(),
    }));
    assignmentModel.findOne.mockReturnValue(query({
      _id: assignmentId,
      tenantId,
      userId,
      accountAddress: '0x0000000000000000000000000000000000000058',
      institutionalRole: 'PRIMARY',
    }));
    roledUserModel.findOne.mockReturnValue(query(null));

    await expect(
      service.approveRequest(
        String(requestId),
        { targetUserId: String(otherUserId), targetAssignmentId: String(assignmentId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mailService.enqueueInstitutionalPasswordResetEmail).not.toHaveBeenCalled();
  });

it('D-MAIL-006 | bloquea aprobacion si wallet o rol cambiaron desde la solicitud', async () => {
    const requestId = new Types.ObjectId('64c00000000000000000005a');
    const tenantId = new Types.ObjectId('64c00000000000000000005b');
    const userId = new Types.ObjectId('64c00000000000000000005c');
    const assignmentId = new Types.ObjectId('64c00000000000000000005d');
    const requestDoc: any = {
      _id: requestId,
      tenantId,
      newEmail: 'new@example.com',
      status: 'PENDING',
      candidateUserId: userId,
      candidateAssignmentId: assignmentId,
      accountAddress: '0x000000000000000000000000000000000000005d',
      institutionalRole: 'PRIMARY',
      save: jest.fn(),
    };
    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery(requestDoc));
    tenantModel.findById.mockReturnValue(query({ _id: tenantId }));
    roledUserModel.findById.mockReturnValue(sessionDocQuery({
      _id: userId,
      email: 'old@example.com',
      name: 'Admin',
      save: jest.fn(),
    }));
    roledUserModel.findOne.mockReturnValue(query(null));
    assignmentModel.findOne.mockReturnValueOnce(query({
      _id: assignmentId,
      tenantId,
      userId,
      accountAddress: '0x0000000000000000000000000000000000000001',
      institutionalRole: 'PRIMARY',
    }));

    await expect(
      service.approveRequest(
        String(requestId),
        { targetUserId: String(userId), targetAssignmentId: String(assignmentId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    assignmentModel.findOne.mockReturnValueOnce(query({
      _id: assignmentId,
      tenantId,
      userId,
      accountAddress: '0x000000000000000000000000000000000000005d',
      institutionalRole: 'SECONDARY',
    }));

    await expect(
      service.approveRequest(
        String(requestId),
        { targetUserId: String(userId), targetAssignmentId: String(assignmentId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mailService.enqueueInstitutionalPasswordResetEmail).not.toHaveBeenCalled();
  });

it('D-MAIL-013 | si falla el outbox la aprobacion propaga error dentro de la transaccion', async () => {
    const requestId = new Types.ObjectId('64c000000000000000000060');
    const tenantId = new Types.ObjectId('64c000000000000000000061');
    const userId = new Types.ObjectId('64c000000000000000000062');
    const assignmentId = new Types.ObjectId('64c000000000000000000063');
    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery({
      _id: requestId,
      tenantId,
      newEmail: 'new@example.com',
      status: 'PENDING',
      candidateUserId: userId,
      candidateAssignmentId: assignmentId,
      accountAddress: null,
      institutionalRole: null,
      save: jest.fn(),
    }));
    tenantModel.findById.mockReturnValue(query({ _id: tenantId }));
    roledUserModel.findById.mockReturnValue(sessionDocQuery({
      _id: userId,
      email: 'old@example.com',
      name: 'Admin',
      save: jest.fn(),
    }));
    assignmentModel.findOne.mockReturnValue(query({ _id: assignmentId, tenantId, userId }));
    roledUserModel.findOne.mockReturnValue(query(null));
    mailService.enqueueInstitutionalPasswordResetEmail.mockRejectedValueOnce(new Error('outbox down'));

    await expect(
      service.approveRequest(
        String(requestId),
        { targetUserId: String(userId), targetAssignmentId: String(assignmentId) },
        { role: 'ADMIN' },
      ),
    ).rejects.toThrow('outbox down');
  });

it('D-MAIL-014 | rechaza solicitud sin modificar cuenta ni assignment', async () => {
    const requestId = new Types.ObjectId('64c000000000000000000070');
    const requestDoc: any = {
      _id: requestId,
      tenantId: new Types.ObjectId(),
      institutionName: 'Tenant',
      fullName: 'Admin',
      phoneNumber: '70000001',
      newEmail: 'new@example.com',
      supervisorPhoneNumber: '70000002',
      status: 'PENDING',
      requestedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery(requestDoc));

    const result = await service.rejectRequest(
      String(requestId),
      { reason: 'No verificado' },
      { role: 'ADMIN', sub: String(new Types.ObjectId()) },
    );

    expect(result).toMatchObject({ requestId: String(requestId), status: 'REJECTED' });
    expect(requestDoc.resolutionReason).toBe('No verificado');
    expect(roledUserModel.findById).not.toHaveBeenCalled();
    expect(assignmentModel.findOne).not.toHaveBeenCalled();
  });

it('D-AUDIT-004 | rejectRequest propaga fallo de auditoria dentro de la transaccion', async () => {
    const requestId = new Types.ObjectId('64c000000000000000000071');
    const requestDoc: any = {
      _id: requestId,
      tenantId: new Types.ObjectId(),
      institutionName: 'Tenant',
      fullName: 'Admin',
      phoneNumber: '70000001',
      newEmail: 'new@example.com',
      supervisorPhoneNumber: '70000002',
      status: 'PENDING',
      requestedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const auditError = new Error('audit down');
    recoveryRequestModel.findById.mockReturnValue(sessionDocQuery(requestDoc));
    auditService.record.mockRejectedValueOnce(auditError);

    await expect(
      service.rejectRequest(
        String(requestId),
        { reason: 'No verificado' },
        { role: 'ADMIN', sub: String(new Types.ObjectId()) },
      ),
    ).rejects.toBe(auditError);

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(requestDoc.save).toHaveBeenCalledWith({ session });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ session }));
    expect(session.endSession).toHaveBeenCalled();
  });
});
