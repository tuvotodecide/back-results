import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalAdminApplicationsService } from '@/modules/institutional-admin-applications/services/institutional-admin-applications.service';

const execResolved = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
const sortResolved = <T>(value: T) => ({ sort: jest.fn().mockResolvedValue(value) });
const leanResolved = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('InstitutionalAdminApplicationsService (unit)', () => {
  let applicationModel: any;
  let roledUserModel: any;
  let tenantModel: any;
  let assignmentModel: any;
  let votingEventModel: any;
  let mailService: any;
  let configService: any;
  let httpService: any;
  let auditService: any;
  let service: InstitutionalAdminApplicationsService;
  let session: any;

  const userId = new Types.ObjectId('64e000000000000000000001');
  const tenantId = new Types.ObjectId('64e000000000000000000002');
  const appId = new Types.ObjectId('64e000000000000000000003');
  const requester = { sub: '64e000000000000000000004', role: 'ADMIN' };
  const validAccountAddress = '0x1234567890abcdef1234567890abcdef12345678';

  beforeEach(() => {
    session = {
      withTransaction: jest.fn(async (fn) => fn()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    roledUserModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
    };
    tenantModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      deleteOne: jest.fn(),
    };
    assignmentModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      exists: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    };
    votingEventModel = {
      updateMany: jest.fn(),
    };
    mailService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string, fallback?: any) => {
        if (key === 'app.mail.verificationTokenTTLHours') return 24;
        if (key === 'app.mail.verificationBaseUrl') return 'https://front.example.com';
        if (key === 'app.identity.baseUrl') return 'https://identity.example.com';
        if (key === 'app.identity.apiKey') return 'identity-api-key';
        if (key === 'IDENTITY_HTTP_TIMEOUT_MS') return 5000;
        if (key === 'FRONTEND_URL') return 'https://front.example.com';
        return fallback;
      }),
    };
    httpService = {
      axiosRef: {
        get: jest.fn().mockResolvedValue({ data: { ok: true } }),
      },
    };
    auditService = {
      record: jest.fn().mockResolvedValue(undefined),
      resolveActorInstitutionalRole: jest.fn().mockResolvedValue(null),
    };
    service = new InstitutionalAdminApplicationsService(
      applicationModel,
      roledUserModel,
      tenantModel,
      assignmentModel,
      votingEventModel,
      mailService,
      configService,
      httpService,
      auditService,
    );
  });

  it('createApplication crea usuario nuevo, solicitud pendiente de email y envia verificacion', async () => {
    tenantModel.findOne.mockResolvedValue(null);
    roledUserModel.findOne.mockReturnValue(execResolved(null));
    applicationModel.findOne.mockReturnValue(sortResolved(null));
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    roledUserModel.create.mockResolvedValue({
      _id: userId,
      password: 'hashed',
    });
    applicationModel.create.mockResolvedValue({
      _id: appId,
      status: 'PENDING_EMAIL_VERIFICATION',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      tenantId: undefined,
      userId,
      accountAddress: validAccountAddress,
    });

    const result = await service.createApplication({
      dni: ' 123456 ',
      email: ' ADMIN@EXAMPLE.COM ',
      name: 'Admin Tenant',
      password: 'secret123',
      institutionName: ' Mi Institucion ',
      accountAddress: ` ${validAccountAddress} `,
    });

    expect(result).toEqual({
      id: appId.toString(),
      status: 'PENDING_EMAIL_VERIFICATION',
      email: 'admin@example.com',
      tenantAlreadyExists: false,
      tenantId: null,
      userId: userId.toString(),
    });
    expect(applicationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dni: '123456',
        email: 'admin@example.com',
        accountAddress: validAccountAddress,
        institutionName: 'Mi Institucion',
        institutionNameNorm: 'mi institucion',
        status: 'PENDING_EMAIL_VERIFICATION',
        verificationToken: expect.any(String),
      }),
    );
    expect(applicationModel.create.mock.calls[0][0].passwordHash).not.toBe('secret123');
    expect(roledUserModel.create.mock.calls[0][0].password).not.toBe('secret123');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.com/registry/has-dni',
      expect.objectContaining({
        params: { account: validAccountAddress, dnis: '123456' },
        headers: { 'x-api-key': 'identity-api-key' },
        timeout: 5000,
      }),
    );
    expect(mailService.sendEmail).toHaveBeenCalled();
  });

  it('createApplication rechaza solicitud pendiente duplicada', async () => {
    tenantModel.findOne.mockResolvedValue(null);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    applicationModel.findOne.mockReturnValue(
      sortResolved({ status: 'PENDING_APPROVAL' }),
    );

    await expect(
      service.createApplication({
        dni: '123456',
        email: 'admin@example.com',
        name: 'Admin Tenant',
        password: 'secret123',
        institutionName: 'Mi Institucion',
        accountAddress: validAccountAddress,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(roledUserModel.create).not.toHaveBeenCalled();
    expect(applicationModel.create).not.toHaveBeenCalled();
  });

  it('createApplication rechaza wallet con formato invalido sin consultar Identity ni persistir', async () => {
    tenantModel.findOne.mockResolvedValue(null);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    applicationModel.findOne.mockReturnValue(sortResolved(null));

    await expect(
      service.createApplication({
        dni: '123456',
        email: 'admin@example.com',
        name: 'Admin Tenant',
        password: 'secret123',
        institutionName: 'Mi Institucion',
        accountAddress: '0x123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(roledUserModel.create).not.toHaveBeenCalled();
    expect(applicationModel.create).not.toHaveBeenCalled();
  });

  it('createApplication rechaza Identity ok false sin crear usuario ni solicitud', async () => {
    tenantModel.findOne.mockResolvedValue(null);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    applicationModel.findOne.mockReturnValue(sortResolved(null));
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { ok: false } });

    await expect(
      service.createApplication({
        dni: '123456',
        email: 'admin@example.com',
        name: 'Admin Tenant',
        password: 'secret123',
        institutionName: 'Mi Institucion',
        accountAddress: validAccountAddress,
      }),
    ).rejects.toMatchObject({
      message: 'La wallet no esta registrada o no corresponde al usuario solicitante.',
    });

    expect(roledUserModel.create).not.toHaveBeenCalled();
    expect(applicationModel.create).not.toHaveBeenCalled();
  });

  it('createApplication falla cerrado ante timeout, 5xx o respuesta invalida de Identity', async () => {
    const payload = {
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      password: 'secret123',
      institutionName: 'Mi Institucion',
      accountAddress: validAccountAddress,
    };

    for (const identityResult of [
      Promise.reject(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })),
      Promise.reject(Object.assign(new Error('identity 5xx'), { response: { status: 503 } })),
      Promise.resolve({ data: {} }),
    ]) {
      tenantModel.findOne.mockResolvedValue(null);
      roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      applicationModel.findOne.mockReturnValue(sortResolved(null));
      httpService.axiosRef.get.mockImplementationOnce(() => identityResult);

      await expect(service.createApplication(payload)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }

    expect(roledUserModel.create).not.toHaveBeenCalled();
    expect(applicationModel.create).not.toHaveBeenCalled();
  });

  it('createApplication no consulta Identity si la institucion ya tiene membresia pendiente', async () => {
    const existingUser = { _id: userId, email: 'admin@example.com', dni: '123456' };
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([existingUser]) });
    applicationModel.findOne.mockReturnValue(sortResolved(null));
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ status: 'PENDING', active: false }),
    });

    await expect(
      service.createApplication({
        dni: '123456',
        email: 'admin@example.com',
        name: 'Admin Tenant',
        institutionName: 'Mi Institucion',
        accountAddress: validAccountAddress,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(applicationModel.create).not.toHaveBeenCalled();
  });

  it('createApplication consulta Identity antes de cualquier write', async () => {
    tenantModel.findOne.mockResolvedValue(null);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    applicationModel.findOne.mockReturnValue(sortResolved(null));
    roledUserModel.create.mockResolvedValue({
      _id: userId,
      password: 'hashed',
    });
    applicationModel.create.mockResolvedValue({
      _id: appId,
      status: 'PENDING_EMAIL_VERIFICATION',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      tenantId: undefined,
      userId,
      accountAddress: validAccountAddress,
    });

    await service.createApplication({
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      password: 'secret123',
      institutionName: 'Mi Institucion',
      accountAddress: validAccountAddress,
    });

    expect(httpService.axiosRef.get.mock.invocationCallOrder[0]).toBeLessThan(
      roledUserModel.create.mock.invocationCallOrder[0],
    );
    expect(httpService.axiosRef.get.mock.invocationCallOrder[0]).toBeLessThan(
      applicationModel.create.mock.invocationCallOrder[0],
    );
  });

  it('verifyEmail cambia a PENDING_APPROVAL y rechaza token expirado', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_EMAIL_VERIFICATION',
      verificationToken: 'token',
      verificationTokenExpiresAt: new Date(Date.now() + 60_000),
      tenantId,
      userId,
      save: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel.findOne.mockResolvedValueOnce(app);
    assignmentModel.findOneAndUpdate.mockResolvedValue({});

    await expect(service.verifyEmail('token')).resolves.toEqual({
      id: appId.toString(),
      status: 'PENDING_APPROVAL',
      emailVerifiedAt: expect.any(Date),
    });
    expect(app.save).toHaveBeenCalled();
    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { tenantId, userId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'PENDING', active: false }),
      }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );

    applicationModel.findOne.mockResolvedValueOnce({
      status: 'PENDING_EMAIL_VERIFICATION',
      verificationTokenExpiresAt: new Date(Date.now() - 60_000),
    });
    await expect(service.verifyEmail('expired')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('approveApplication crea tenant/asignacion y marca aprobada', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      emailVerifiedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const user = {
      _id: userId,
      dni: '123456',
      email: 'admin@example.com',
      active: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    assignmentModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    assignmentModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    tenantModel.findOne.mockResolvedValueOnce(null);
    tenantModel.create.mockResolvedValue({ _id: tenantId });
    assignmentModel.findOneAndUpdate.mockResolvedValue({});
    roledUserModel.findById.mockResolvedValue(user);
    assignmentModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
    roledUserModel.updateOne.mockResolvedValue({});

    await expect(service.approveApplication(appId.toString(), requester)).resolves.toEqual({
      id: appId.toString(),
      status: 'APPROVED',
      tenantId: tenantId.toString(),
      userId: userId.toString(),
      institutionalRole: 'PRIMARY',
    });

    expect(tenantModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          name: 'Mi Institucion',
          nameNorm: 'mi institucion',
          active: true,
        }),
      ],
      expect.objectContaining({ session }),
    );
    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { tenantId, userId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'APPROVED', active: true }),
      }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
    expect(assignmentModel.findOneAndUpdate.mock.calls[0][1].$set).toEqual(
      expect.objectContaining({
        accountAddress: validAccountAddress,
        applicationId: appId,
        institutionalRole: 'PRIMARY',
      }),
    );
    expect(app.save).toHaveBeenCalled();
  });

  it('approveApplication rechaza primera aprobacion por actor no global', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = { _id: userId, dni: '123456', email: 'admin@example.com' };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue(null);

    await expect(
      service.approveApplication(appId.toString(), {
        sub: '64e000000000000000000004',
        role: 'USER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tenantModel.create).not.toHaveBeenCalled();
    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(app.save).not.toHaveBeenCalled();
  });

  it('approveApplication permite que PRIMARY del mismo tenant apruebe un SECONDARY', async () => {
    const primaryUserId = new Types.ObjectId('64e000000000000000000008');
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      emailVerifiedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const user = {
      _id: userId,
      dni: '123456',
      email: 'admin@example.com',
      active: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const primaryAssignment = {
      tenantId,
      userId: primaryUserId,
      active: true,
      status: 'APPROVED',
      institutionalRole: 'PRIMARY',
      accountAddress: '0x9999999999999999999999999999999999999999',
    };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockImplementation((query: any) =>
      leanResolved(
        query?.accountAddress ||
          query?.$or?.some((entry: any) => entry.accountAddressNormalized || entry.accountAddress)
          ? []
          : [primaryAssignment],
      ),
    );
    assignmentModel.findOne.mockImplementation((query: any) =>
      leanResolved(query?.institutionalRole === 'PRIMARY' ? primaryAssignment : null),
    );
    assignmentModel.findOneAndUpdate.mockResolvedValue({});
    roledUserModel.findById.mockResolvedValue(user);
    assignmentModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(
      service.approveApplication(appId.toString(), {
        sub: String(primaryUserId),
        role: 'USER',
      }),
    ).resolves.toMatchObject({
      status: 'APPROVED',
      institutionalRole: 'SECONDARY',
    });

    expect(assignmentModel.findOneAndUpdate.mock.calls[0][1].$set).toEqual(
      expect.objectContaining({ institutionalRole: 'SECONDARY' }),
    );
  });

  it('approveApplication permite a SUPERADMIN aprobar un administrador adicional como SECONDARY', async () => {
    const primaryUserId = new Types.ObjectId('64e000000000000000000008');
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      emailVerifiedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const user = {
      _id: userId,
      dni: '123456',
      email: 'admin@example.com',
      active: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockImplementation((query: any) =>
      leanResolved(
        query?.accountAddress ||
          query?.$or?.some((entry: any) => entry.accountAddressNormalized || entry.accountAddress)
          ? []
          : [
              {
                tenantId,
                userId: primaryUserId,
                active: true,
                status: 'APPROVED',
                institutionalRole: 'PRIMARY',
              },
            ],
      ),
    );
    assignmentModel.findOne.mockReturnValue(leanResolved(null));
    assignmentModel.findOneAndUpdate.mockResolvedValue({});
    roledUserModel.findById.mockResolvedValue(user);
    assignmentModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(service.approveApplication(appId.toString(), requester)).resolves.toMatchObject({
      institutionalRole: 'SECONDARY',
    });
  });

  it('approveApplication rechaza SECONDARY, PRIMARY ajeno o PRIMARY inactivo como aprobadores', async () => {
    const secondaryUserId = new Types.ObjectId('64e000000000000000000009');
    const primaryUserId = new Types.ObjectId('64e000000000000000000008');
    const otherTenantId = new Types.ObjectId('64e000000000000000000010');
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = { _id: userId, dni: '123456', email: 'admin@example.com' };
    const activePrimary = {
      tenantId,
      userId: primaryUserId,
      active: true,
      status: 'APPROVED',
      institutionalRole: 'PRIMARY',
    };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockReturnValue(leanResolved([activePrimary]));
    assignmentModel.findOne.mockReturnValue(leanResolved(null));

    await expect(
      service.approveApplication(appId.toString(), {
        sub: String(secondaryUserId),
        role: 'USER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.approveApplication(appId.toString(), {
        sub: String(primaryUserId),
        role: 'USER',
        tenantId: String(otherTenantId),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.approveApplication(appId.toString(), {
        sub: String(primaryUserId),
        role: 'USER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approveApplication bloquea autoaprobacion por mismo usuario', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = { _id: userId, dni: '123456', email: 'admin@example.com' };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue(null);

    await expect(
      service.approveApplication(appId.toString(), {
        sub: String(userId),
        role: 'ADMIN',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approveApplication no infiere PRIMARY desde assignments heredados sin rol', async () => {
    const legacyUserId = new Types.ObjectId('64e000000000000000000011');
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = { _id: userId, dni: '123456', email: 'admin@example.com' };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockReturnValue(
      leanResolved([
        {
          tenantId,
          userId: legacyUserId,
          active: true,
          status: 'APPROVED',
          accountAddress: '0x9999999999999999999999999999999999999999',
        },
      ]),
    );

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approveApplication bloquea tenants con dos PRIMARY activos', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = { _id: userId, dni: '123456', email: 'admin@example.com' };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockReturnValue(
      leanResolved([
        {
          tenantId,
          userId: new Types.ObjectId('64e000000000000000000012'),
          active: true,
          status: 'APPROVED',
          institutionalRole: 'PRIMARY',
        },
        {
          tenantId,
          userId: new Types.ObjectId('64e000000000000000000013'),
          active: true,
          status: 'APPROVED',
          institutionalRole: 'PRIMARY',
        },
      ]),
    );

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approveApplication rechaza solicitudes heredadas sin wallet verificada', async () => {
    applicationModel.findById.mockResolvedValue({
      _id: appId,
      status: 'PENDING_APPROVAL',
      email: 'admin@example.com',
      dni: '123456',
      save: jest.fn(),
    });

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(roledUserModel.create).not.toHaveBeenCalled();
    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approveApplication reutiliza una relacion compatible sin duplicar assignment', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      emailVerifiedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const user = {
      _id: userId,
      dni: '123456',
      email: 'admin@example.com',
      active: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          tenantId,
          userId,
          accountAddress: validAccountAddress,
          active: true,
          status: 'APPROVED',
          institutionalRole: 'SECONDARY',
        },
      ]),
    });
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        tenantId,
        userId,
        accountAddress: validAccountAddress,
        active: false,
        status: 'PENDING',
        institutionalRole: 'SECONDARY',
      }),
    });
    assignmentModel.findOneAndUpdate.mockResolvedValue({ _id: new Types.ObjectId() });
    roledUserModel.findById.mockResolvedValue(user);
    assignmentModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(service.approveApplication(appId.toString(), requester)).resolves.toMatchObject({
      status: 'APPROVED',
      tenantId: tenantId.toString(),
      userId: userId.toString(),
    });

    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { tenantId, userId },
      expect.objectContaining({
        $set: expect.objectContaining({
          active: true,
          status: 'APPROVED',
          accountAddress: validAccountAddress,
          institutionalRole: 'SECONDARY',
        }),
      }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
  });

  it('approveApplication rechaza la misma wallet asociada a otro usuario sin escribir', async () => {
    const otherUserId = new Types.ObjectId('64e000000000000000000005');
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = { _id: userId, dni: '123456', email: 'admin@example.com' };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find
      .mockReturnValueOnce(leanResolved([]))
      .mockReturnValueOnce(leanResolved([
        { tenantId, userId: otherUserId, accountAddress: validAccountAddress },
      ]));

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(roledUserModel.create).not.toHaveBeenCalled();
    expect(tenantModel.create).not.toHaveBeenCalled();
    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(app.save).not.toHaveBeenCalled();
  });

  it('approveApplication rechaza mismo usuario y tenant con wallet distinta', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = { _id: userId, dni: '123456', email: 'admin@example.com' };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockReturnValue(leanResolved([
      {
        tenantId,
        userId: new Types.ObjectId('64e000000000000000000007'),
        active: true,
        status: 'APPROVED',
        institutionalRole: 'PRIMARY',
      },
    ]));
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        tenantId,
        userId,
        accountAddress: '0x9999999999999999999999999999999999999999',
        active: true,
        status: 'APPROVED',
      }),
    });

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(app.save).not.toHaveBeenCalled();
  });

  it('approveApplication no cruza relaciones de otro tenant para el mismo usuario y wallet', async () => {
    const otherTenantId = new Types.ObjectId('64e000000000000000000006');
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const user = {
      _id: userId,
      dni: '123456',
      email: 'admin@example.com',
      active: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find
      .mockReturnValueOnce(leanResolved([]))
      .mockReturnValueOnce(leanResolved([
        { tenantId: otherTenantId, userId, accountAddress: validAccountAddress },
      ]))
      .mockReturnValueOnce(leanResolved([]))
      .mockReturnValueOnce(leanResolved([
        { tenantId: otherTenantId, userId, accountAddress: validAccountAddress },
      ]));
    assignmentModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    assignmentModel.findOneAndUpdate.mockResolvedValue({ _id: new Types.ObjectId() });
    roledUserModel.findById.mockResolvedValue(user);
    assignmentModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(service.approveApplication(appId.toString(), requester)).resolves.toMatchObject({
      tenantId: tenantId.toString(),
      userId: userId.toString(),
    });

    expect(assignmentModel.findOneAndUpdate.mock.calls[0][0]).toEqual({ tenantId, userId });
  });

  it('approveApplication detecta conflicto de wallet sin depender de mayusculas', async () => {
    const otherUserId = new Types.ObjectId('64e000000000000000000005');
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = { _id: userId, dni: '123456', email: 'admin@example.com' };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue({ _id: tenantId });
    assignmentModel.find
      .mockReturnValueOnce(leanResolved([]))
      .mockReturnValueOnce(leanResolved([
        { tenantId, userId: otherUserId, accountAddress: validAccountAddress.toUpperCase() },
      ]));

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approveApplication no marca aprobada si falla la creacion de assignment', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = {
      _id: userId,
      dni: '123456',
      email: 'admin@example.com',
      active: false,
      save: jest.fn(),
    };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue(null);
    tenantModel.create.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    assignmentModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    assignmentModel.findOneAndUpdate.mockRejectedValue(new Error('assignment write failed'));

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toThrow(
      'assignment write failed',
    );

    expect(app.save).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
    expect(tenantModel.deleteOne).not.toHaveBeenCalled();
  });

  it('approveApplication traduce E11000 del PRIMARY en ConflictException sin exponer Mongo', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = {
      _id: userId,
      dni: '123456',
      email: 'admin@example.com',
      active: false,
      save: jest.fn(),
    };
    const duplicatePrimaryError = Object.assign(
      new Error('E11000 duplicate key error collection tenant_admin_assignments'),
      {
        code: 11000,
        keyPattern: { tenantId: 1, institutionalRole: 1 },
        keyValue: { tenantId, institutionalRole: 'PRIMARY' },
      },
    );
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue(null);
    tenantModel.create.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockReturnValue(leanResolved([]));
    assignmentModel.findOne.mockReturnValue(leanResolved(null));
    assignmentModel.findOneAndUpdate.mockRejectedValue(duplicatePrimaryError);

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toMatchObject({
      message: 'La institución ya cuenta con un administrador principal activo',
    });

    await expect(service.approveApplication(appId.toString(), requester)).rejects.not.toThrow(
      'E11000',
    );
    expect(app.save).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
    expect(tenantModel.deleteOne).not.toHaveBeenCalled();
  });

  it('approveApplication no transforma E11000 de otro indice', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      dni: '123456',
      email: 'admin@example.com',
      name: 'Admin Tenant',
      passwordHash: 'hashed',
      institutionName: 'Mi Institucion',
      institutionNameNorm: 'mi institucion',
      accountAddress: validAccountAddress,
      save: jest.fn(),
    };
    const user = {
      _id: userId,
      dni: '123456',
      email: 'admin@example.com',
      active: false,
      save: jest.fn(),
    };
    const duplicateOtherIndexError = Object.assign(
      new Error('E11000 duplicate key error collection tenant_admin_assignments other_index'),
      {
        code: 11000,
        keyPattern: { tenantId: 1, userId: 1 },
        keyValue: { tenantId, userId },
      },
    );
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([user]) });
    tenantModel.findOne.mockResolvedValue(null);
    tenantModel.create.mockResolvedValue({ _id: tenantId });
    assignmentModel.find.mockReturnValue(leanResolved([]));
    assignmentModel.findOne.mockReturnValue(leanResolved(null));
    assignmentModel.findOneAndUpdate.mockRejectedValue(duplicateOtherIndexError);

    await expect(service.approveApplication(appId.toString(), requester)).rejects.toThrow(
      'other_index',
    );

    expect(app.save).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
    expect(tenantModel.deleteOne).not.toHaveBeenCalled();
  });

  it('revokeApplication deja PRIMARY revocado inactivo y sin promover reemplazo', async () => {
    const app = {
      _id: appId,
      status: 'APPROVED',
      tenantId,
      userId,
      save: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel.findById.mockResolvedValue(app);
    tenantModel.findById.mockReturnValue(leanResolved({ _id: tenantId, active: true }));
    assignmentModel.findOneAndUpdate.mockResolvedValue({});
    roledUserModel.findById.mockResolvedValue({
      _id: userId,
      active: true,
      save: jest.fn().mockResolvedValue(undefined),
    });
    assignmentModel.exists.mockResolvedValue(null);
    roledUserModel.updateOne.mockResolvedValue({});

    await expect(
      service.revokeApplication(appId.toString(), requester, 'soporte'),
    ).resolves.toEqual({
      id: appId.toString(),
      status: 'REVOKED',
      reason: 'soporte',
    });

    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { tenantId, userId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'REVOKED',
          active: false,
        }),
      }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
    expect(assignmentModel.findOneAndUpdate.mock.calls[0][1].$set).not.toHaveProperty(
      'institutionalRole',
    );
  });

  it('rejectApplication deja assignment aplicable inactivo aunque fuese PRIMARY', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      tenantId,
      userId,
      email: 'admin@example.com',
      dni: '123456',
      save: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel.findById.mockResolvedValue(app);
    assignmentModel.findOneAndUpdate.mockResolvedValue({});
    roledUserModel.findById.mockResolvedValue({ _id: userId, active: false });
    assignmentModel.exists.mockResolvedValue(null);

    await expect(
      service.rejectApplication(appId.toString(), requester, 'rechazo'),
    ).resolves.toEqual({
      id: appId.toString(),
      status: 'REJECTED',
      reason: 'rechazo',
    });

    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { tenantId, userId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'REJECTED',
          active: false,
        }),
      }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
  });

  it('rejectApplication propaga fallo de auditoria dentro de la transaccion', async () => {
    const app = {
      _id: appId,
      status: 'PENDING_APPROVAL',
      tenantId,
      userId,
      email: 'admin@example.com',
      dni: '123456',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const auditError = new Error('audit down');
    applicationModel.findById.mockResolvedValue(app);
    assignmentModel.findOneAndUpdate.mockResolvedValue({});
    roledUserModel.findById.mockResolvedValue({ _id: userId, active: false });
    assignmentModel.exists.mockResolvedValue(null);
    auditService.record.mockRejectedValueOnce(auditError);

    await expect(
      service.rejectApplication(appId.toString(), requester, 'rechazo'),
    ).rejects.toBe(auditError);

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(app.save).toHaveBeenCalledWith({ session });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ session }));
    expect(session.endSession).toHaveBeenCalled();
  });

  it('reopenApplication no crea ni reactiva assignment automaticamente', async () => {
    const app = {
      _id: appId,
      status: 'REVOKED',
      tenantId,
      userId,
      save: jest.fn().mockResolvedValue(undefined),
    };
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.findById.mockResolvedValue({ _id: userId, active: false });
    assignmentModel.exists.mockResolvedValue(null);

    await expect(service.reopenApplication(appId.toString(), requester)).resolves.toEqual({
      id: appId.toString(),
      status: 'PENDING_APPROVAL',
      reason: null,
    });

    expect(assignmentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('revokeApplication propaga fallo de auditoria dentro de la transaccion', async () => {
    const app = {
      _id: appId,
      status: 'APPROVED',
      tenantId,
      userId,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const auditError = new Error('audit down');
    applicationModel.findById.mockResolvedValue(app);
    tenantModel.findById.mockReturnValue(leanResolved({ _id: tenantId, active: true }));
    assignmentModel.findOneAndUpdate.mockResolvedValue({});
    roledUserModel.findById.mockResolvedValue({
      _id: userId,
      active: true,
      save: jest.fn().mockResolvedValue(undefined),
    });
    assignmentModel.exists.mockResolvedValue(null);
    roledUserModel.updateOne.mockResolvedValue({});
    auditService.record.mockRejectedValueOnce(auditError);

    await expect(
      service.revokeApplication(appId.toString(), requester, 'soporte'),
    ).rejects.toBe(auditError);

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(app.save).toHaveBeenCalledWith({ session });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ session }));
    expect(session.endSession).toHaveBeenCalled();
  });

  it('reopenApplication propaga fallo de auditoria dentro de la transaccion', async () => {
    const app = {
      _id: appId,
      status: 'REVOKED',
      tenantId,
      userId,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const auditError = new Error('audit down');
    applicationModel.findById.mockResolvedValue(app);
    roledUserModel.findById.mockResolvedValue({ _id: userId, active: false });
    assignmentModel.exists.mockResolvedValue(null);
    auditService.record.mockRejectedValueOnce(auditError);

    await expect(service.reopenApplication(appId.toString(), requester)).rejects.toBe(
      auditError,
    );

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(app.save).toHaveBeenCalledWith({ session });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ session }));
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rejectApplication y revokeApplication bloquean transiciones invalidas', async () => {
    applicationModel.findById.mockResolvedValueOnce({ status: 'APPROVED' });
    await expect(
      service.rejectApplication(appId.toString(), requester, 'motivo'),
    ).rejects.toBeInstanceOf(BadRequestException);

    applicationModel.findById.mockResolvedValueOnce({ status: 'PENDING_APPROVAL' });
    await expect(
      service.revokeApplication(appId.toString(), requester, 'motivo'),
    ).rejects.toBeInstanceOf(BadRequestException);

    applicationModel.findById.mockResolvedValueOnce(null);
    await expect(
      service.rejectApplication(appId.toString(), requester),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
