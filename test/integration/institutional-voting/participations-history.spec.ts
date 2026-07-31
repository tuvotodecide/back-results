import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { Types } from 'mongoose';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import {
  bootstrapInstitutionalVotingContext,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn(),
}));

const VALID_API_KEY = 'valid-zk-history-key';
const ALLOWED_HISTORY_FIELDS = [
  'eventId',
  'id',
  'institutionName',
  'participatedAt',
  'title',
  'type',
];
const FORBIDDEN_HISTORY_FIELDS = [
  '_id',
  '__v',
  '_doc',
  'createdAt',
  'updatedAt',
  'carnetNorm',
  'idempotencyKey',
  'candidate',
  'option',
  'candidateId',
  'optionId',
  'candidateSelected',
  'selectedCandidateId',
  'nullifier',
  'proof',
  'zkProof',
  'vote',
  'txHash',
  'transactionId',
  'blockchainHash',
  'credential',
  'privateKey',
  'seed',
  'authToken',
  'deviceToken',
];

describe('Institutional voting integration - participation history', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    (ZkAuthGuard as unknown as jest.Mock).mockImplementation(() => ({
      canActivate: jest.fn((context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        const raw = req.headers['x-api-key'];
        const provided = Array.isArray(raw) ? raw[0] : raw;

        if (!provided) {
          throw new ForbiddenException('Missing API key (header)');
        }
        if (provided !== VALID_API_KEY) {
          throw new ForbiddenException('Not valid or expired ZK API key');
        }

        return true;
      }),
    }));

    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function insertEvent(name: string, overrides: Record<string, unknown> = {}) {
    const now = new Date();
    const result = await ctx.conn.collection('voting_events').insertOne({
      tenantId: new Types.ObjectId(ctx.createdTenantId),
      name,
      objective: `${name} objetivo`,
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date(now.getTime() - 60_000),
      votingEnd: new Date(now.getTime() + 60_000),
      resultsPublishAt: new Date(now.getTime() + 120_000),
      publicEligibilityEnabled: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });

    return result.insertedId;
  }

  async function insertParticipation(params: {
    eventId: Types.ObjectId;
    carnetNorm: string;
    participatedAt: Date;
    extra?: Record<string, unknown>;
  }) {
    const now = new Date();
    const result = await ctx.conn.collection('participations').insertOne({
      eventId: params.eventId,
      carnetNorm: params.carnetNorm,
      participatedAt: params.participatedAt,
      createdAt: now,
      updatedAt: now,
      ...params.extra,
    });

    return result.insertedId;
  }

  function historyRequest(carnet?: string) {
    const req = request(ctx.httpServer)
      .get('/api/v1/voting/events/participations')
      .set('x-api-key', VALID_API_KEY);

    return carnet === undefined ? req : req.query({ carnet });
  }

  function expectSafeHistoryItem(item: Record<string, unknown>) {
    expect(Object.keys(item).sort()).toEqual(ALLOWED_HISTORY_FIELDS);
    FORBIDDEN_HISTORY_FIELDS.forEach((field) => {
      expect(item).not.toHaveProperty(field);
    });
  }

  it('MP-GET-BE-001 requiere API key', async () => {
    const response = await request(ctx.httpServer).get(
      '/api/v1/voting/events/participations',
    );

    expect(response.status).toBe(403);
    expect(response.body).not.toEqual(expect.arrayContaining([expect.any(Object)]));
  });

  it('MP-GET-BE-002 rechaza API key inválida', async () => {
    const response = await request(ctx.httpServer)
      .get('/api/v1/voting/events/participations')
      .set('x-api-key', 'invalid-key')
      .query({ carnet: '123456' });

    expect(response.status).toBe(403);
    expect(response.body).not.toEqual(expect.arrayContaining([expect.any(Object)]));
  });

  it('MP-GET-BE-003 requiere carnet', async () => {
    const response = await historyRequest();

    expect(response.status).toBe(400);
  });

  it('PAR-YAV-P1-002 devuelve participaciones de voto con metadata segura', async () => {
    const eventId = await insertEvent('Elección Historial Seguro');
    const participatedAt = new Date('2026-01-03T14:00:00.000Z');
    const participationId = await insertParticipation({
      eventId,
      carnetNorm: '123456',
      participatedAt,
    });

    const response = await historyRequest('123456');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: participationId.toString(),
        type: 'vote_participation',
        eventId: eventId.toString(),
        title: 'Elección Historial Seguro',
        institutionName: expect.any(String),
        participatedAt: participatedAt.toISOString(),
      },
    ]);
  });

  it('MP-GET-BE-005 devuelve [] para usuario sin participaciones', async () => {
    const response = await historyRequest('NO-999');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('PAR-SEC-P0-001 / PAR-SEC-P0-002 no devuelve datos sensibles aunque existan como campos extra', async () => {
    const eventId = await insertEvent('Elección Payload Seguro');
    await insertParticipation({
      eventId,
      carnetNorm: 'SAFE001',
      participatedAt: new Date('2026-01-04T10:00:00.000Z'),
      extra: {
        candidateId: 'candidate-1',
        optionId: 'option-1',
        candidateSelected: { partyName: 'Lista Azul' },
        selectedCandidateId: 'option-1',
        nullifier: 'nullifier-1',
        proof: 'proof-1',
        zkProof: 'zk-proof-1',
        vote: 'Lista Azul',
        txHash: '0xabc',
        transactionId: 'tx-1',
        blockchainHash: '0xdef',
        credential: 'credential-secret',
        privateKey: 'private-key-secret',
        seed: 'seed-secret',
        authToken: 'auth-token-secret',
        deviceToken: 'device-token-secret',
      },
    });

    const response = await historyRequest('SAFE001');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    const [item] = response.body;
    expectSafeHistoryItem(item);
  });

  it('MP-GET-BE-007 ordena por participatedAt descendente', async () => {
    const oldEventId = await insertEvent('Elección Antigua');
    const newEventId = await insertEvent('Elección Nueva');

    await insertParticipation({
      eventId: oldEventId,
      carnetNorm: 'ORDER1',
      participatedAt: new Date('2026-01-01T10:00:00.000Z'),
    });
    await insertParticipation({
      eventId: newEventId,
      carnetNorm: 'ORDER1',
      participatedAt: new Date('2026-01-05T10:00:00.000Z'),
    });

    const response = await historyRequest('ORDER1');

    expect(response.status).toBe(200);
    expect(response.body.map((item: any) => item.title)).toEqual([
      'Elección Nueva',
      'Elección Antigua',
    ]);
  });

  it('MP-GET-BE-008 devuelve título de evento e institución', async () => {
    const eventId = await insertEvent('Elección con Institución');
    await insertParticipation({
      eventId,
      carnetNorm: 'META1',
      participatedAt: new Date('2026-01-06T12:00:00.000Z'),
    });

    const response = await historyRequest('META1');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      type: 'vote_participation',
      eventId: eventId.toString(),
      title: 'Elección con Institución',
      institutionName: expect.any(String),
    });
    expectSafeHistoryItem(response.body[0]);
  });

  it('MP-BE-009/010/011 expone solo campos permitidos y omite internos, carnetNorm e idempotencyKey', async () => {
    const eventId = await insertEvent('Elección Campos Permitidos');
    await insertParticipation({
      eventId,
      carnetNorm: 'FIELDS1',
      participatedAt: new Date('2026-01-07T12:00:00.000Z'),
      extra: {
        idempotencyKey: 'idem-history-1',
        __v: 7,
        _doc: { leaked: true },
        candidateId: 'candidate-1',
        optionId: 'option-1',
        nullifier: 'nullifier-1',
      },
    });

    const response = await historyRequest('FIELDS1');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expectSafeHistoryItem(response.body[0]);
  });

  it('MP-BE-012 mantiene /participations como ruta estática y no cae en :eventId', async () => {
    const response = await historyRequest();

    expect(response.status).toBe(400);
    expect(String(response.body.message)).toContain('carnet inválido');
  });

  it('MP-BE-013 mantiene POST /:eventId/participations enrutable sin modificar su validación actual', async () => {
    const eventId = await insertEvent('Elección Regresión POST');

    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId.toString()}/participations`)
      .send({ carnet: '123456' });

    expect([400, 403]).toContain(response.status);
    expect(response.status).not.toBe(404);
  });

  it('MP-BE-014 mantiene GET /:eventId/participations/status enrutable', async () => {
    const eventId = await insertEvent('Elección Regresión Status');

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId.toString()}/participations/status`)
      .query({ carnet: '123456' });

    expect([200, 400, 403]).toContain(response.status);
    expect(response.status).not.toBe(404);
  });

  it('MP-BE-015 mantiene GET /:eventId/participation/check-public funcionando', async () => {
    const eventId = await insertEvent('Elección Regresión Check Public');
    await insertParticipation({
      eventId,
      carnetNorm: 'CHECK1',
      participatedAt: new Date('2026-01-08T10:00:00.000Z'),
    });

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId.toString()}/participation/check-public`)
      .query({ carnet: 'CHECK1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      eventId: eventId.toString(),
      participated: true,
    });
  });

  it('MP-BE-016 aísla participaciones entre múltiples usuarios', async () => {
    const eventA = await insertEvent('Elección Usuario A');
    const eventB = await insertEvent('Elección Usuario B');
    await insertParticipation({
      eventId: eventA,
      carnetNorm: 'USERA1',
      participatedAt: new Date('2026-01-09T10:00:00.000Z'),
    });
    await insertParticipation({
      eventId: eventB,
      carnetNorm: 'USERB1',
      participatedAt: new Date('2026-01-10T10:00:00.000Z'),
    });

    const response = await historyRequest('USERA1');

    expect(response.status).toBe(200);
    expect(response.body.map((item: any) => item.title)).toEqual(['Elección Usuario A']);
    expect(response.body).toHaveLength(1);
    expectSafeHistoryItem(response.body[0]);
  });

  it('MP-BE-017 devuelve múltiples eventos del mismo usuario', async () => {
    const firstEvent = await insertEvent('Elección Multi Uno');
    const secondEvent = await insertEvent('Elección Multi Dos');
    await insertParticipation({
      eventId: firstEvent,
      carnetNorm: 'MULTI1',
      participatedAt: new Date('2026-01-11T10:00:00.000Z'),
    });
    await insertParticipation({
      eventId: secondEvent,
      carnetNorm: 'MULTI1',
      participatedAt: new Date('2026-01-12T10:00:00.000Z'),
    });

    const response = await historyRequest('MULTI1');

    expect(response.status).toBe(200);
    expect(response.body.map((item: any) => item.title)).toEqual([
      'Elección Multi Dos',
      'Elección Multi Uno',
    ]);
    response.body.forEach(expectSafeHistoryItem);
  });

  it('MP-BE-019 tolera evento sin institución y devuelve institutionName null', async () => {
    const eventId = await insertEvent('Elección sin Institución', { tenantId: null });
    await insertParticipation({
      eventId,
      carnetNorm: 'NOTENANT1',
      participatedAt: new Date('2026-01-13T10:00:00.000Z'),
    });

    const response = await historyRequest('NOTENANT1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        type: 'vote_participation',
        eventId: eventId.toString(),
        title: 'Elección sin Institución',
        institutionName: null,
      }),
    ]);
    expectSafeHistoryItem(response.body[0]);
  });

  it('MP-BE-020 responde error controlado si falla la consulta de participaciones', async () => {
    const participationModel = ctx.app.get('ParticipationModel');
    const aggregateSpy = jest
      .spyOn(participationModel, 'aggregate')
      .mockImplementationOnce(() => {
        throw new Error('db-history-failure');
      });

    const response = await historyRequest('DBFAIL1');

    expect(response.status).toBe(500);
    expect(response.body).not.toEqual(expect.arrayContaining([expect.any(Object)]));
    expect(JSON.stringify(response.body)).not.toContain('nullifier');
    expect(JSON.stringify(response.body)).not.toContain('proof');
    aggregateSpy.mockRestore();
  });
});
