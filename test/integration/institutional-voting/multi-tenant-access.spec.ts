import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Multi tenant', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  }, 240000);

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function login(email: string) {
    const result = await request(ctx.httpServer).post('/api/v1/auth/login').send({
      email,
      password: 'secret123',
    });
    return result.body;
  }

  async function createTenant(name: string) {
    const response = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `${name} ${Date.now()} ${Math.random().toString(16).slice(2)}`,
        description: 'Tenant para pruebas multiinstitucion',
      });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  async function assignTenantToNoContractUser(
    tenantId: string,
    status: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED',
    institutionalRole: 'PRIMARY' | 'SECONDARY',
    accountAddress: string,
  ) {
    const user = await ctx.conn.collection('roled_users').findOne({ email: 'nocontract@example.com' });
    expect(user?._id).toBeDefined();
    await ctx.conn.collection('roled_users').updateOne(
      { _id: user!._id },
      {
        $set: {
          role: 'USER',
          votingDepartmentId: null,
          votingMunicipalityId: null,
          territorialAccessStatus: 'NONE',
        },
      },
    );
    await ctx.conn.collection('tenant_admin_assignments').insertOne({
      tenantId: new Types.ObjectId(tenantId),
      userId: user!._id,
      status,
      active: status === 'APPROVED' || status === 'PENDING',
      accountAddress,
      accountAddressNormalized: accountAddress.toLowerCase(),
      institutionalRole,
      requestedAt: new Date(),
      approvedAt: status === 'APPROVED' ? new Date() : null,
      suspendedAt: status === 'SUSPENDED' ? new Date() : null,
      revokedAt: status === 'REVOKED' ? new Date() : null,
      walletVerifiedAt: status === 'APPROVED' ? new Date() : null,
      walletVerificationSource: 'TEST',
    });
    return String(user!._id);
  }

  it('D-MULTI-001 | aísla eventos por tenant entre admin global y tenant admin', async () => {
    const ownEvent = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        name: `Own Event ${Date.now()}`,
      },
    );

    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Other Tenant ${Date.now()}`,
        description: 'Otro tenant',
      });

    const otherEvent = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      {
        ...institutionalVotingFixtures.event,
        name: `Other Event ${Date.now()}`,
      },
    );

    const tenantList = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.tenantAdminToken, { type: 'bearer' });
    expect(tenantList.status).toBe(200);
    expect(tenantList.body.data.map((item: any) => item.id)).toContain(ownEvent.body.id);
    expect(tenantList.body.data.map((item: any) => item.id)).not.toContain(otherEvent.body.id);

    const adminList = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.map((item: any) => item.id)).toContain(ownEvent.body.id);
    expect(adminList.body.data.map((item: any) => item.id)).toContain(otherEvent.body.id);
  });

  it('D-MULTI-001 | una sola institución activa queda como contexto institucional por defecto', async () => {
    const tenantId = await createTenant('D-MULTI-001 Tenant único');
    await assignTenantToNoContractUser(
      tenantId,
      'APPROVED',
      'PRIMARY',
      '0x1000000000000000000000000000000000000001',
    );

    const session = await login('nocontract@example.com');
    const tenantContexts = session.availableContexts.filter((context: any) => context.type === 'TENANT');

    expect(session.requiresContextSelection).toBe(false);
    expect(session.defaultContext).toMatchObject({
      type: 'TENANT',
      tenantId,
      hasWallet: true,
      walletStatus: 'VERIFIED',
    });
    expect(session.tenantId).toBe(tenantId);
    expect(tenantContexts).toHaveLength(1);
  });

  it('D-MULTI-002 / D-MULTI-003 / D-MULTI-004 | selector con varias instituciones activas recalcula rol y wallet por tenant', async () => {
    const primaryTenantId = await createTenant('D-MULTI-002 Tenant principal');
    const secondaryTenantId = await createTenant('D-MULTI-002 Tenant secundario');
    const userId = await assignTenantToNoContractUser(
      primaryTenantId,
      'APPROVED',
      'PRIMARY',
      '0x2000000000000000000000000000000000000001',
    );
    await assignTenantToNoContractUser(
      secondaryTenantId,
      'APPROVED',
      'SECONDARY',
      '0x2000000000000000000000000000000000000002',
    );

    const session = await login('nocontract@example.com');
    const tenantContexts = session.availableContexts.filter((context: any) => context.type === 'TENANT');
    expect(session.requiresContextSelection).toBe(true);
    expect(tenantContexts.map((context: any) => context.tenantId)).toEqual(
      expect.arrayContaining([primaryTenantId, secondaryTenantId]),
    );

    const accessService = ctx.moduleRef.get(InstitutionalVotingAccessService);
    await expect(accessService.resolveAdminWalletForTenant(userId, primaryTenantId)).resolves.toMatchObject({
      tenantId: primaryTenantId,
      accountAddress: '0x2000000000000000000000000000000000000001',
      institutionalRole: 'PRIMARY',
    });
    await expect(accessService.resolveAdminWalletForTenant(userId, secondaryTenantId)).resolves.toMatchObject({
      tenantId: secondaryTenantId,
      accountAddress: '0x2000000000000000000000000000000000000002',
      institutionalRole: 'SECONDARY',
    });
  });

  it('D-MULTI-005 / D-MULTI-006 / D-MULTI-007 | cambiar tenant no mezcla votaciones ni conserva datos del contexto anterior', async () => {
    const tenantA = await createTenant('D-MULTI-005 Tenant A');
    const tenantB = await createTenant('D-MULTI-005 Tenant B');
    await assignTenantToNoContractUser(
      tenantA,
      'APPROVED',
      'SECONDARY',
      '0x3000000000000000000000000000000000000001',
    );
    await assignTenantToNoContractUser(
      tenantB,
      'APPROVED',
      'SECONDARY',
      '0x3000000000000000000000000000000000000002',
    );
    const session = await login('nocontract@example.com');
    const token = session.accessToken as string;

    const eventA = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, tenantA, {
      ...institutionalVotingFixtures.event,
      name: `D-MULTI-005 A ${Date.now()}`,
    });
    const eventB = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, tenantB, {
      ...institutionalVotingFixtures.event,
      name: `D-MULTI-005 B ${Date.now()}`,
    });

    const listA = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .query({ tenantId: tenantA })
      .auth(token, { type: 'bearer' });
    const listB = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .query({ tenantId: tenantB })
      .auth(token, { type: 'bearer' });

    expect(listA.status).toBe(200);
    expect(listA.body.data.map((item: any) => item.id)).toContain(eventA.body.id);
    expect(listA.body.data.map((item: any) => item.id)).not.toContain(eventB.body.id);
    expect(listB.status).toBe(200);
    expect(listB.body.data.map((item: any) => item.id)).toContain(eventB.body.id);
    expect(listB.body.data.map((item: any) => item.id)).not.toContain(eventA.body.id);
  });

  it('D-MULTI-008 / D-MULTI-009 / D-MULTI-010 / D-MULTI-011 | bloquea institutionId manipulado y contextos no operativos', async () => {
    const activeTenant = await createTenant('D-MULTI-008 Tenant activo');
    const pendingTenant = await createTenant('D-MULTI-009 Tenant pendiente');
    const suspendedTenant = await createTenant('D-MULTI-010 Tenant suspendido');
    const revokedTenant = await createTenant('D-MULTI-011 Tenant eliminado');
    await assignTenantToNoContractUser(
      activeTenant,
      'APPROVED',
      'SECONDARY',
      '0x4000000000000000000000000000000000000001',
    );
    await assignTenantToNoContractUser(
      pendingTenant,
      'PENDING',
      'SECONDARY',
      '0x4000000000000000000000000000000000000002',
    );
    await assignTenantToNoContractUser(
      suspendedTenant,
      'SUSPENDED',
      'SECONDARY',
      '0x4000000000000000000000000000000000000003',
    );
    await assignTenantToNoContractUser(
      revokedTenant,
      'REVOKED',
      'SECONDARY',
      '0x4000000000000000000000000000000000000004',
    );

    const session = await login('nocontract@example.com');
    const token = session.accessToken as string;
    const tenantContextIds = session.availableContexts
      .filter((context: any) => context.type === 'TENANT')
      .map((context: any) => context.tenantId);

    expect(tenantContextIds).toContain(activeTenant);
    expect(tenantContextIds).not.toEqual(expect.arrayContaining([pendingTenant, suspendedTenant, revokedTenant]));

    const foreignTenant = await createTenant('D-MULTI-008 Tenant ajeno');
    const directPending = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .query({ tenantId: pendingTenant })
      .auth(token, { type: 'bearer' });
    const directSuspended = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .query({ tenantId: suspendedTenant })
      .auth(token, { type: 'bearer' });
    const directRevoked = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .query({ tenantId: revokedTenant })
      .auth(token, { type: 'bearer' });
    const manipulated = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .query({ tenantId: foreignTenant })
      .auth(token, { type: 'bearer' });

    expect(directPending.status).toBe(403);
    expect(directSuspended.status).toBe(403);
    expect(directRevoked.status).toBe(403);
    expect(manipulated.status).toBe(403);
    expect(directPending.body.data).toBeUndefined();
    expect(directSuspended.body.data).toBeUndefined();
    expect(directRevoked.body.data).toBeUndefined();
    expect(manipulated.body.data).toBeUndefined();
  });

  it('D-MULTI-005 / D-MULTI-006 | bloquea detalle y mutación de evento ajeno para tenant admin', async () => {
    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Forbidden Tenant ${Date.now()}`,
        description: 'Tenant ajeno',
      });

    const otherEvent = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      institutionalVotingFixtures.event,
    );

    const detailForbidden = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${otherEvent.body.id}`)
      .auth(ctx.tenantAdminToken, { type: 'bearer' });
    expect(detailForbidden.status).toBe(403);

    const patchForbidden = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${otherEvent.body.id}`)
      .auth(ctx.tenantAdminToken, { type: 'bearer' })
      .send({ name: 'Intento no autorizado' });
    expect(patchForbidden.status).toBe(403);
  });

  it('D-PERM-001 / D-PERM-006 | bloquea endpoints administrativos sin autenticación y con usuario sin asignación activa', async () => {
    const unauthorized = await request(ctx.httpServer)
      .post('/api/v1/voting/events')
      .send({
        ...institutionalVotingFixtures.event,
        tenantId: ctx.createdTenantId,
      });
    expect(unauthorized.status).toBe(401);

    const mayorToken = (await login('mcbba@example.com')).accessToken as string;
    const noAssignment = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(mayorToken, { type: 'bearer' });
    expect(noAssignment.status).toBe(200);
    expect(noAssignment.body.data).toEqual([]);

    const forbiddenCreate = await request(ctx.httpServer)
      .post('/api/v1/voting/events')
      .auth(mayorToken, { type: 'bearer' })
      .send({
        ...institutionalVotingFixtures.event,
        tenantId: ctx.createdTenantId,
      });
    expect(forbiddenCreate.status).toBe(403);
  });

  it('D-REV-001 / D-PERM-007 | bloquea mutaciones con token ya emitido cuando se revoca la asignación institucional', async () => {
    await ctx.conn.collection('tenant_admin_assignments').updateOne(
      {
        tenantId: new Types.ObjectId(ctx.createdTenantId),
      },
      {
        $set: {
          active: false,
          status: 'REVOKED',
          revokedAt: new Date(),
        },
      },
    );

    const forbiddenCreate = await request(ctx.httpServer)
      .post('/api/v1/voting/events')
      .auth(ctx.tenantAdminToken, { type: 'bearer' })
      .send({
        ...institutionalVotingFixtures.event,
        tenantId: ctx.createdTenantId,
      });

    expect(forbiddenCreate.status).toBe(403);
  });

  it('D-COMPAT-001 | mantiene públicos los endpoints públicos sin bearer token', async () => {
    const event = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );

    const landing = await request(ctx.httpServer).get('/api/v1/voting/events/public/landing');
    expect(landing.status).toBe(200);

    const status = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${event.body.id}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(status.status).toBe(200);
  });
});
