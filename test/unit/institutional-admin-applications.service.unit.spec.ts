import {
  BadRequestException,
  ConflictException,
  NotFoundException,
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
  let service: InstitutionalAdminApplicationsService;

  const userId = new Types.ObjectId('64e000000000000000000001');
  const tenantId = new Types.ObjectId('64e000000000000000000002');
  const appId = new Types.ObjectId('64e000000000000000000003');
  const requester = { sub: '64e000000000000000000004' };

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
        if (key === 'FRONTEND_URL') return 'https://front.example.com';
        return fallback;
      }),
    };
    service = new InstitutionalAdminApplicationsService(
      applicationModel,
      roledUserModel,
      tenantModel,
      assignmentModel,
      votingEventModel,
      mailService,
      configService,
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
    });

    const result = await service.createApplication({
      dni: ' 123456 ',
      email: ' ADMIN@EXAMPLE.COM ',
      name: 'Admin Tenant',
      password: 'secret123',
      institutionName: ' Mi Institucion ',
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
        institutionName: 'Mi Institucion',
        institutionNameNorm: 'mi institucion',
        status: 'PENDING_EMAIL_VERIFICATION',
        verificationToken: expect.any(String),
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
      }),
    ).rejects.toBeInstanceOf(ConflictException);
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
      { upsert: true, new: true },
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
      { upsert: true, new: true },
    );
    expect(app.save).toHaveBeenCalled();
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
