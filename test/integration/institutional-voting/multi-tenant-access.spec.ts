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

  it('[MX-02][D-MULTI-001][INTEGRACION] aísla los eventos de la única institución activa frente a otra institución', async () => {
    const ownTenant = await createTenant('D-MULTI-001 Tenant propio');
    const foreignTenant = await createTenant('D-MULTI-001 Tenant ajeno');
    await assignTenantToNoContractUser(ownTenant, 'APPROVED', 'PRIMARY', '0x1000000000000000000000000000000000000001');
    const ownEvent = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, ownTenant, {
      ...institutionalVotingFixtures.event,
      name: `D-MULTI-001 propio ${Date.now()}`,
    });
    const foreignEvent = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, foreignTenant, {
      ...institutionalVotingFixtures.event,
      name: `D-MULTI-001 ajeno ${Date.now()}`,
    });

    const session = await login('nocontract@example.com');
    const tenantContexts = session.availableContexts.filter((context: { type: string }) => context.type === 'TENANT');
    const list = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .query({ tenantId: ownTenant })
      .auth(session.accessToken as string, { type: 'bearer' });

    expect(session.defaultContext).toMatchObject({ type: 'TENANT', tenantId: ownTenant });
    expect(tenantContexts.map((context: { tenantId: string }) => context.tenantId)).toContain(ownTenant);
    expect(list.status).toBe(200);
    expect(list.body.data.map((item: { id: string }) => item.id)).toContain(ownEvent.body.id);
    expect(list.body.data.map((item: { id: string }) => item.id)).not.toContain(foreignEvent.body.id);
  });

  it('[MX-02][D-MULTI-002][INTEGRACION] expone un selector con las dos instituciones activas diferenciables', async () => {
    const primaryTenantName = 'D-MULTI-002 Tenant principal';
    const secondaryTenantName = 'D-MULTI-002 Tenant secundario';
    const primaryTenantId = await createTenant(primaryTenantName);
    const secondaryTenantId = await createTenant(secondaryTenantName);
    await assignTenantToNoContractUser(primaryTenantId, 'APPROVED', 'PRIMARY', '0x2000000000000000000000000000000000000001');
    await assignTenantToNoContractUser(secondaryTenantId, 'APPROVED', 'SECONDARY', '0x2000000000000000000000000000000000000002');

    const session = await login('nocontract@example.com');
    const tenantContexts = session.availableContexts.filter((context: { type: string }) => context.type === 'TENANT');

    expect(session.requiresContextSelection).toBe(true);
    expect(tenantContexts.map((context: { tenantId: string }) => context.tenantId)).toEqual(
      expect.arrayContaining([primaryTenantId, secondaryTenantId]),
    );
    expect(tenantContexts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'TENANT',
        tenantId: primaryTenantId,
        tenantName: expect.stringContaining(primaryTenantName),
        membershipId: expect.any(String),
        hasWallet: true,
        requiresWalletUpdate: false,
        walletStatus: 'VERIFIED',
      }),
      expect.objectContaining({
        type: 'TENANT',
        tenantId: secondaryTenantId,
        tenantName: expect.stringContaining(secondaryTenantName),
        membershipId: expect.any(String),
        hasWallet: true,
        requiresWalletUpdate: false,
        walletStatus: 'VERIFIED',
      }),
    ]));
    const primaryContext = tenantContexts.find(
      (context: { tenantId?: string }) => context.tenantId === primaryTenantId,
    );
    const secondaryContext = tenantContexts.find(
      (context: { tenantId?: string }) => context.tenantId === secondaryTenantId,
    );
    expect(primaryContext?.membershipId).toEqual(expect.any(String));
    expect(secondaryContext?.membershipId).toEqual(expect.any(String));
    expect(primaryContext?.membershipId).not.toBe(secondaryContext?.membershipId);
    expect(primaryContext?.tenantName).not.toBe(secondaryContext?.tenantName);
  });

  it('[MX-02][D-MULTI-003][INTEGRACION] recalcula el rol institucional al consultar cada tenant activo', async () => {
    const primaryTenantId = await createTenant('D-MULTI-003 Tenant principal');
    const secondaryTenantId = await createTenant('D-MULTI-003 Tenant secundario');
    const userId = await assignTenantToNoContractUser(primaryTenantId, 'APPROVED', 'PRIMARY', '0x2100000000000000000000000000000000000001');
    await assignTenantToNoContractUser(secondaryTenantId, 'APPROVED', 'SECONDARY', '0x2100000000000000000000000000000000000002');
    const accessService = ctx.moduleRef.get(InstitutionalVotingAccessService);

    const primaryAccess = await accessService.resolveAdminWalletForTenant(userId, primaryTenantId);
    const secondaryAccess = await accessService.resolveAdminWalletForTenant(userId, secondaryTenantId);

    expect(primaryAccess).toMatchObject({ tenantId: primaryTenantId, institutionalRole: 'PRIMARY' });
    expect(secondaryAccess).toMatchObject({ tenantId: secondaryTenantId, institutionalRole: 'SECONDARY' });
    expect(primaryAccess.institutionalRole).not.toBe(secondaryAccess.institutionalRole);
  });

  it('[MX-02][D-MULTI-004][INTEGRACION] recalcula billetera y contexto activo al cambiar de tenant', async () => {
    const firstTenantId = await createTenant('D-MULTI-004 Tenant primera wallet');
    const secondTenantId = await createTenant('D-MULTI-004 Tenant segunda wallet');
    const userId = await assignTenantToNoContractUser(firstTenantId, 'APPROVED', 'PRIMARY', '0x2200000000000000000000000000000000000001');
    await assignTenantToNoContractUser(secondTenantId, 'APPROVED', 'SECONDARY', '0x2200000000000000000000000000000000000002');
    const accessService = ctx.moduleRef.get(InstitutionalVotingAccessService);

    const firstWallet = await accessService.resolveAdminWalletForTenant(userId, firstTenantId);
    const secondWallet = await accessService.resolveAdminWalletForTenant(userId, secondTenantId);

    expect(firstWallet).toMatchObject({ tenantId: firstTenantId, accountAddress: '0x2200000000000000000000000000000000000001' });
    expect(secondWallet).toMatchObject({ tenantId: secondTenantId, accountAddress: '0x2200000000000000000000000000000000000002' });
    expect(secondWallet.accountAddress).not.toBe(firstWallet.accountAddress);
  });

  it('[MX-02][D-MULTI-005][INTEGRACION] al cambiar de tenant no conserva las votaciones de la institución anterior', async () => {
    const tenantA = await createTenant('D-MULTI-005 Tenant A');
    const tenantB = await createTenant('D-MULTI-005 Tenant B');
    await assignTenantToNoContractUser(tenantA, 'APPROVED', 'SECONDARY', '0x3000000000000000000000000000000000000001');
    await assignTenantToNoContractUser(tenantB, 'APPROVED', 'SECONDARY', '0x3000000000000000000000000000000000000002');
    const eventA = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, tenantA, { ...institutionalVotingFixtures.event, name: `D-MULTI-005 A ${Date.now()}` });
    const eventB = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, tenantB, { ...institutionalVotingFixtures.event, name: `D-MULTI-005 B ${Date.now()}` });
    const token = (await login('nocontract@example.com')).accessToken as string;
    const firstList = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: tenantA }).auth(token, { type: 'bearer' });
    const secondList = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: tenantB }).auth(token, { type: 'bearer' });

    expect(firstList.status).toBe(200);
    expect(firstList.body.data.map((item: { id: string }) => item.id)).toContain(eventA.body.id);
    expect(secondList.status).toBe(200);
    expect(secondList.body.data.map((item: { id: string }) => item.id)).toContain(eventB.body.id);
    expect(secondList.body.data.map((item: { id: string }) => item.id)).not.toContain(eventA.body.id);
  });

  it('[MX-02][D-MULTI-006][INTEGRACION] mantiene cero mezcla de datos entre dos instituciones operativas', async () => {
    const tenantA = await createTenant('D-MULTI-006 Tenant A');
    const tenantB = await createTenant('D-MULTI-006 Tenant B');
    await assignTenantToNoContractUser(tenantA, 'APPROVED', 'SECONDARY', '0x3100000000000000000000000000000000000001');
    await assignTenantToNoContractUser(tenantB, 'APPROVED', 'SECONDARY', '0x3100000000000000000000000000000000000002');
    const eventA = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, tenantA, { ...institutionalVotingFixtures.event, name: `D-MULTI-006 A ${Date.now()}` });
    const eventB = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, tenantB, { ...institutionalVotingFixtures.event, name: `D-MULTI-006 B ${Date.now()}` });
    const token = (await login('nocontract@example.com')).accessToken as string;
    const [listA, listB] = await Promise.all([
      request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: tenantA }).auth(token, { type: 'bearer' }),
      request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: tenantB }).auth(token, { type: 'bearer' }),
    ]);

    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    expect(listA.body.data.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([eventA.body.id]));
    expect(listA.body.data.map((item: { id: string }) => item.id)).not.toContain(eventB.body.id);
    expect(listB.body.data.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([eventB.body.id]));
    expect(listB.body.data.map((item: { id: string }) => item.id)).not.toContain(eventA.body.id);
  });

  it('[MX-02][D-MULTI-007][INTEGRACION] limpia el contexto anterior antes de responder por el tenant seleccionado', async () => {
    const previousTenant = await createTenant('D-MULTI-007 Tenant previo');
    const selectedTenant = await createTenant('D-MULTI-007 Tenant seleccionado');
    await assignTenantToNoContractUser(previousTenant, 'APPROVED', 'SECONDARY', '0x3200000000000000000000000000000000000001');
    await assignTenantToNoContractUser(selectedTenant, 'APPROVED', 'SECONDARY', '0x3200000000000000000000000000000000000002');
    const previousEvent = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, previousTenant, { ...institutionalVotingFixtures.event, name: `D-MULTI-007 previo ${Date.now()}` });
    const selectedEvent = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, selectedTenant, { ...institutionalVotingFixtures.event, name: `D-MULTI-007 seleccionado ${Date.now()}` });
    const token = (await login('nocontract@example.com')).accessToken as string;
    await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: previousTenant }).auth(token, { type: 'bearer' });
    const selectedList = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: selectedTenant }).auth(token, { type: 'bearer' });

    expect(selectedList.status).toBe(200);
    expect(selectedList.body.data.map((item: { id: string }) => item.id)).toContain(selectedEvent.body.id);
    expect(selectedList.body.data.map((item: { id: string }) => item.id)).not.toContain(previousEvent.body.id);
  });

  it('[MX-02][D-MULTI-008][INTEGRACION] rechaza un institutionId manipulado sin revelar ni alterar datos ajenos', async () => {
    const ownTenant = await createTenant('D-MULTI-008 Tenant propio');
    const foreignTenant = await createTenant('D-MULTI-008 Tenant manipulado');
    await assignTenantToNoContractUser(ownTenant, 'APPROVED', 'SECONDARY', '0x4000000000000000000000000000000000000001');
    const foreignEvent = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, foreignTenant, { ...institutionalVotingFixtures.event, name: `D-MULTI-008 ajeno ${Date.now()}` });
    const token = (await login('nocontract@example.com')).accessToken as string;
    const manipulated = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: foreignTenant }).auth(token, { type: 'bearer' });
    const persistedForeignEvent = await request(ctx.httpServer).get(`/api/v1/voting/events/${foreignEvent.body.id}`).auth(ctx.adminToken, { type: 'bearer' });

    expect(manipulated.status).toBe(403);
    expect(manipulated.body.data).toBeUndefined();
    expect(persistedForeignEvent.status).toBe(200);
    expect(persistedForeignEvent.body.id).toBe(foreignEvent.body.id);
  });

  it('[MX-02][D-MULTI-009][INTEGRACION] mantiene una relación pendiente fuera del contexto operativo', async () => {
    const activeTenant = await createTenant('D-MULTI-009 Tenant activo');
    const pendingTenant = await createTenant('D-MULTI-009 Tenant pendiente');
    await assignTenantToNoContractUser(activeTenant, 'APPROVED', 'SECONDARY', '0x4100000000000000000000000000000000000001');
    await assignTenantToNoContractUser(pendingTenant, 'PENDING', 'SECONDARY', '0x4100000000000000000000000000000000000002');
    const session = await login('nocontract@example.com');
    const pendingAccess = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: pendingTenant }).auth(session.accessToken as string, { type: 'bearer' });
    const assignment = await ctx.conn.collection('tenant_admin_assignments').findOne({ tenantId: new Types.ObjectId(pendingTenant), status: 'PENDING' });

    expect(session.availableContexts.map((context: { tenantId?: string }) => context.tenantId)).not.toContain(pendingTenant);
    expect(pendingAccess.status).toBe(403);
    expect(pendingAccess.body.data).toBeUndefined();
    expect(assignment).toMatchObject({ status: 'PENDING', active: true });
  });

  it('[MX-02][D-MULTI-010][INTEGRACION] bloquea una relación suspendida sin afectar la institución activa', async () => {
    const activeTenant = await createTenant('D-MULTI-010 Tenant activo');
    const suspendedTenant = await createTenant('D-MULTI-010 Tenant suspendido');
    await assignTenantToNoContractUser(activeTenant, 'APPROVED', 'SECONDARY', '0x4200000000000000000000000000000000000001');
    await assignTenantToNoContractUser(suspendedTenant, 'SUSPENDED', 'SECONDARY', '0x4200000000000000000000000000000000000002');
    const session = await login('nocontract@example.com');
    const suspendedAccess = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: suspendedTenant }).auth(session.accessToken as string, { type: 'bearer' });
    const activeAccess = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: activeTenant }).auth(session.accessToken as string, { type: 'bearer' });
    const assignment = await ctx.conn.collection('tenant_admin_assignments').findOne({ tenantId: new Types.ObjectId(suspendedTenant) });

    expect(session.availableContexts.map((context: { tenantId?: string }) => context.tenantId)).not.toContain(suspendedTenant);
    expect(suspendedAccess.status).toBe(403);
    expect(activeAccess.status).toBe(200);
    expect(assignment).toMatchObject({ status: 'SUSPENDED', active: false });
  });

  it('[MX-02][D-MULTI-011][INTEGRACION] bloquea de forma segura una relación revocada sin efectos cross-tenant', async () => {
    const activeTenant = await createTenant('D-MULTI-011 Tenant activo');
    const revokedTenant = await createTenant('D-MULTI-011 Tenant revocado');
    await assignTenantToNoContractUser(activeTenant, 'APPROVED', 'SECONDARY', '0x4300000000000000000000000000000000000001');
    await assignTenantToNoContractUser(revokedTenant, 'REVOKED', 'SECONDARY', '0x4300000000000000000000000000000000000002');
    const preservedEvent = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, activeTenant, { ...institutionalVotingFixtures.event, name: `D-MULTI-011 activo ${Date.now()}` });
    const token = (await login('nocontract@example.com')).accessToken as string;
    const revokedAccess = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: revokedTenant }).auth(token, { type: 'bearer' });
    const activeList = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: activeTenant }).auth(token, { type: 'bearer' });
    const assignment = await ctx.conn.collection('tenant_admin_assignments').findOne({ tenantId: new Types.ObjectId(revokedTenant) });

    expect(revokedAccess.status).toBe(403);
    expect(revokedAccess.body.data).toBeUndefined();
    expect(activeList.status).toBe(200);
    expect(activeList.body.data.map((item: { id: string }) => item.id)).toContain(preservedEvent.body.id);
    expect(assignment).toMatchObject({ status: 'REVOKED', active: false });
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
