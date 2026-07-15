import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalAdminApplicationsService } from '@/modules/institutional-admin-applications/services/institutional-admin-applications.service';

const execResolved = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
const sortResolved = <T>(value: T) => ({ sort: jest.fn().mockResolvedValue(value) });

describe('InstitutionalAdminApplicationsService (unit)', () => {
  let applicationModel: any;
  let roledUserModel: any;
  let tenantModel: any;
  let assignmentModel: any;
  let votingEventModel: any;
  let mailService: any;
  let configService: any;
  let httpService: any;
  let service: InstitutionalAdminApplicationsService;

  const userId = new Types.ObjectId('64e000000000000000000001');
  const tenantId = new Types.ObjectId('64e000000000000000000002');
  const appId = new Types.ObjectId('64e000000000000000000003');
  const requester = { sub: '64e000000000000000000004' };
  const validAccountAddress = '0x1234567890abcdef1234567890abcdef12345678';

  beforeEach(() => {
    applicationModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
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
      create: jest.fn(),
      deleteMany: jest.fn(),
    };
    assignmentModel = {
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
    service = new InstitutionalAdminApplicationsService(
      applicationModel,
      roledUserModel,
      tenantModel,
      assignmentModel,
      votingEventModel,
      mailService,
      configService,
      httpService,
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
    });

    expect(tenantModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Mi Institucion',
        nameNorm: 'mi institucion',
        active: true,
      }),
    );
    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { tenantId, userId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'APPROVED', active: true }),
      }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
    expect(app.save).toHaveBeenCalled();
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
