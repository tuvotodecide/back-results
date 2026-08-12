import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { AuthService } from '@/modules/auth/services/auth.service';

const sortedLean = <T>(value: T) => ({
  sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
});

const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });

const at = (value: string) => new Date(value);

const buildUser = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  email: 'admin@example.com',
  dni: '12345678',
  name: 'Admin',
  role: 'ADMIN',
  active: false,
  password: bcrypt.hashSync('secret123', 4),
  ...overrides,
});

const buildService = ({
  user,
  memberships = [],
  applications = [],
  tenants = [],
}: {
  user: any;
  memberships?: any[];
  applications?: any[];
  tenants?: any[];
}) => {
  const roledUserModel = { findOne: jest.fn().mockResolvedValue(user) };
  const membershipModel = { find: jest.fn().mockReturnValue(sortedLean(memberships)) };
  const tenantModel = { find: jest.fn().mockReturnValue(lean(tenants)) };
  const applicationModel = {
    find: jest.fn().mockReturnValue(sortedLean(applications)),
    findOne: jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue(applications[0] ?? null),
    }),
  };
  const service = new AuthService(
    roledUserModel as any,
    { exists: jest.fn() } as any,
    { exists: jest.fn() } as any,
    membershipModel as any,
    tenantModel as any,
    applicationModel as any,
    { signAsync: jest.fn() } as unknown as JwtService,
    { sendEmail: jest.fn() } as any,
    { get: jest.fn() } as any,
  );
  return { service, applicationModel, membershipModel };
};

describe('AuthService institutional access status', () => {
  const getAccessStatus = (service: AuthService, user: any) =>
    (service as any).buildAccessStatusForUser(user);

  it('conserva REJECTED histórico cuando no existe un proceso posterior', async () => {
    const user = buildUser();
    const tenantId = new Types.ObjectId();
    const applicationId = new Types.ObjectId();
    const { service } = buildService({
      user,
      tenants: [{ _id: tenantId, name: 'Tenant A', active: true }],
      memberships: [{
        _id: new Types.ObjectId(), userId: user._id, tenantId, applicationId,
        status: 'REJECTED', active: false, reason: 'Rechazo anterior',
        createdAt: at('2026-01-01T00:00:00.000Z'), updatedAt: at('2026-01-02T00:00:00.000Z'),
      }],
      applications: [{
        _id: applicationId, userId: user._id, tenantId, email: user.email, status: 'REJECTED',
        institutionName: 'Tenant A', createdAt: at('2026-01-01T00:00:00.000Z'), updatedAt: at('2026-01-02T00:00:00.000Z'),
      }],
    });

    await expect(getAccessStatus(service, user)).resolves.toMatchObject({
      tenant: { latestStatus: 'REJECTED', hasApprovedAccess: false },
    });
  });

  it('usa la nueva solicitud pendiente del mismo tenant sin crear un estado híbrido', async () => {
    const user = buildUser();
    const tenantId = new Types.ObjectId();
    const previousApplicationId = new Types.ObjectId();
    const currentApplicationId = new Types.ObjectId();
    const currentApplication = {
      _id: currentApplicationId, userId: user._id, tenantId, email: user.email,
      status: 'PENDING_APPROVAL', institutionName: 'Tenant A',
      createdAt: at('2026-02-01T00:00:00.000Z'), updatedAt: at('2026-02-02T00:00:00.000Z'),
    };
    const { service } = buildService({
      user,
      tenants: [{ _id: tenantId, name: 'Tenant A', active: true }],
      memberships: [{
        _id: new Types.ObjectId(), userId: user._id, tenantId, applicationId: previousApplicationId,
        status: 'REJECTED', active: false,
        createdAt: at('2026-01-01T00:00:00.000Z'), updatedAt: at('2026-01-02T00:00:00.000Z'),
      }],
      applications: [
        currentApplication,
        {
          _id: previousApplicationId, userId: user._id, tenantId, email: user.email,
          status: 'REJECTED', institutionName: 'Tenant A',
          createdAt: at('2026-01-01T00:00:00.000Z'), updatedAt: at('2026-01-02T00:00:00.000Z'),
        },
      ],
    });

    const accessStatus = await getAccessStatus(service, user);

    expect(accessStatus.tenant.latestStatus).toBe('PENDING');
    expect(accessStatus.tenant.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ applicationId: String(previousApplicationId), status: 'REJECTED' }),
      expect.objectContaining({ applicationId: String(currentApplicationId), status: 'PENDING' }),
    ]));
    await expect(service.signIn({ email: user.email, password: 'secret123' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TENANT_ACCESS_PENDING' }),
    });
  });

  it('mantiene los procesos separados por tenant', async () => {
    const user = buildUser();
    const tenantA = new Types.ObjectId();
    const tenantB = new Types.ObjectId();
    const previousApplicationId = new Types.ObjectId();
    const currentApplicationId = new Types.ObjectId();
    const { service } = buildService({
      user,
      tenants: [
        { _id: tenantA, name: 'Tenant A', active: true },
        { _id: tenantB, name: 'Tenant B', active: true },
      ],
      memberships: [{
        _id: new Types.ObjectId(), userId: user._id, tenantId: tenantA, applicationId: previousApplicationId,
        status: 'REJECTED', active: false,
        createdAt: at('2026-01-01T00:00:00.000Z'), updatedAt: at('2026-01-02T00:00:00.000Z'),
      }],
      applications: [{
        _id: currentApplicationId, userId: user._id, tenantId: tenantB, email: user.email,
        status: 'PENDING_APPROVAL', institutionName: 'Tenant B',
        createdAt: at('2026-02-01T00:00:00.000Z'), updatedAt: at('2026-02-02T00:00:00.000Z'),
      }],
    });

    const accessStatus = await getAccessStatus(service, user);

    expect(accessStatus.tenant.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: String(tenantA), applicationId: String(previousApplicationId), status: 'REJECTED' }),
      expect.objectContaining({ tenantId: String(tenantB), applicationId: String(currentApplicationId), status: 'PENDING' }),
    ]));
    expect(accessStatus.tenant.latestStatus).toBe('PENDING');
  });

  it('preserva el acceso de una membresía activa aprobada', async () => {
    const user = buildUser({ active: true });
    const tenantId = new Types.ObjectId();
    const { service } = buildService({
      user,
      tenants: [{ _id: tenantId, name: 'Tenant A', active: true }],
      memberships: [{
        _id: new Types.ObjectId(), userId: user._id, tenantId,
        status: 'APPROVED', active: true,
        createdAt: at('2026-01-01T00:00:00.000Z'), updatedAt: at('2026-01-02T00:00:00.000Z'),
      }],
      applications: [{
        _id: new Types.ObjectId(), userId: user._id, tenantId, email: user.email,
        status: 'PENDING_APPROVAL', institutionName: 'Tenant A',
        createdAt: at('2026-02-01T00:00:00.000Z'), updatedAt: at('2026-02-02T00:00:00.000Z'),
      }],
    });

    await expect(getAccessStatus(service, user)).resolves.toMatchObject({
      tenant: { latestStatus: 'APPROVED', hasApprovedAccess: true },
    });
  });

  it('selecciona la aplicación más reciente aunque el arreglo no venga en ese orden', async () => {
    const user = buildUser();
    const tenantId = new Types.ObjectId();
    const oldApplicationId = new Types.ObjectId();
    const newApplicationId = new Types.ObjectId();
    const { service } = buildService({
      user,
      tenants: [{ _id: tenantId, name: 'Tenant A', active: true }],
      applications: [
        {
          _id: oldApplicationId, userId: user._id, tenantId, email: user.email,
          status: 'REJECTED', institutionName: 'Tenant A',
          createdAt: at('2026-01-01T00:00:00.000Z'), updatedAt: at('2026-01-02T00:00:00.000Z'),
        },
        {
          _id: newApplicationId, userId: user._id, tenantId, email: user.email,
          status: 'PENDING_APPROVAL', institutionName: 'Tenant A',
          createdAt: at('2026-02-01T00:00:00.000Z'), updatedAt: at('2026-02-02T00:00:00.000Z'),
        },
      ],
    });

    const accessStatus = await getAccessStatus(service, user);

    expect(accessStatus.tenant.latestStatus).toBe('PENDING');
    expect(accessStatus.tenant.items[0]).toMatchObject({ applicationId: String(newApplicationId) });
  });
});
