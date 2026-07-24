import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OfficialPublicationRequestService } from '@/modules/institutional-voting/services/publication/official-publication-request.service';
import { OfficialPublicationRequestStateService } from '@/modules/institutional-voting/services/publication/official-publication-request-state.service';

class InMemoryRequestModel {
  docs: any[] = [];
  throwDuplicateAfterCreateLookup = false;

  async create(input: any) {
    if (this.throwDuplicateAfterCreateLookup) {
      this.throwDuplicateAfterCreateLookup = false;
      this.docs.push({
        ...input,
        requestId: 'raced-request',
        version: input.version ?? 0,
        status: input.status ?? 'PREPARING',
        statusHistory: [],
        finalizationProgress: input.finalizationProgress ?? {},
      });
      throw { code: 11000 };
    }
    if (input.activeKey && this.docs.some((doc) => doc.activeKey === input.activeKey)) {
      throw { code: 11000 };
    }
    const doc = {
      ...input,
      requestId: input.requestId ?? `request-${this.docs.length + 1}`,
      version: input.version ?? 0,
      status: input.status ?? 'PREPARING',
      statusHistory: [],
      finalizationProgress: input.finalizationProgress ?? {},
    };
    this.docs.push(doc);
    return doc;
  }

  findOne(filter: Record<string, any>) {
    const result =
      filter.activeKey && filter.status?.$in
        ? this.docs.find(
            (doc) =>
              doc.activeKey === filter.activeKey &&
              filter.status.$in.includes(doc.status),
          ) ?? null
        : this.docs.find((doc) => this.matches(doc, filter)) ?? null;
    return {
      sort: () => result,
      then: (resolve: any) => Promise.resolve(result).then(resolve),
    } as any;
  }

  async findOneAndUpdate(filter: Record<string, any>, update: any) {
    const doc = this.docs.find((item) => this.matches(item, filter));
    if (!doc) return null;
    this.applyUpdate(doc, update);
    return doc;
  }

  async updateMany(filter: Record<string, any>, update: any) {
    const docs = this.docs.filter((item) => this.matches(item, filter));
    docs.forEach((doc) => this.applyUpdate(doc, update));
    return { modifiedCount: docs.length };
  }

  private matches(doc: any, filter: Record<string, any>) {
    return Object.entries(filter).every(([key, value]) => {
      if (key === '$or' && Array.isArray(value)) {
        return value.some((item) => this.matches(doc, item));
      }
      const current = this.get(doc, key);
      if (value && typeof value === 'object' && '$in' in value) {
        return value.$in.some((expected: any) => expected === current);
      }
      if (value && typeof value === 'object' && '$exists' in value) {
        return value.$exists ? current !== undefined : current === undefined;
      }
      return current === value;
    });
  }

  private applyUpdate(doc: any, update: any) {
    Object.entries(update.$set ?? {}).forEach(([key, value]) => this.set(doc, key, value));
    Object.entries(update.$unset ?? {}).forEach(([key]) => this.set(doc, key, undefined));
    Object.entries(update.$inc ?? {}).forEach(([key, value]) =>
      this.set(doc, key, (this.get(doc, key) ?? 0) + Number(value)),
    );
    Object.entries(update.$push ?? {}).forEach(([key, value]) => {
      const list = this.get(doc, key) ?? [];
      list.push(value);
      this.set(doc, key, list);
    });
  }

  private get(doc: any, path: string) {
    return path.split('.').reduce((value, key) => value?.[key], doc);
  }

  private set(doc: any, path: string, value: any) {
    const keys = path.split('.');
    const last = keys.pop()!;
    const target = keys.reduce((current, key) => {
      current[key] ??= {};
      return current[key];
    }, doc);
    target[last] = value;
  }
}

describe('OfficialPublicationRequestService', () => {
  let model: InMemoryRequestModel;
  let service: OfficialPublicationRequestService;
  const ids = {
    eventId: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    applicationId: new Types.ObjectId(),
    requestedByUserId: new Types.ObjectId(),
    signerUserId: new Types.ObjectId(),
    assignmentId: new Types.ObjectId(),
    padronVersionId: new Types.ObjectId(),
  };

  beforeEach(() => {
    model = new InMemoryRequestModel();
    service = new OfficialPublicationRequestService(
      model as any,
      new OfficialPublicationRequestStateService(),
    );
  });

  function input(overrides: Record<string, any> = {}) {
    return {
      ...ids,
      institutionId: String(ids.applicationId),
      signerWallet: '0x1111111111111111111111111111111111111111',
      smartAccountAddress: '0x1111111111111111111111111111111111111111',
      entryPointAddress: '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789',
      entryPointVersion: '0.6',
      chainId: 84532,
      onChainElectionId: '123',
      expiresAt: new Date('2026-07-22T12:30:00.000Z'),
      callData: { to: '0x2222222222222222222222222222222222222222', value: '0', data: '0x1234' },
      callDataHash: '0xhash',
      snapshotHash: 'snapshot',
      proxyAddress: '0x3333333333333333333333333333333333333333',
      implementationAddress: '0x4444444444444444444444444444444444444444',
      abiVersion: 'voteContract.createVote.v1',
      enabledVotersCount: 2,
      optionsHash: 'options-hash',
      merkleRoots: { ciMerkleRoot: '1', voteMerkleRoot: '2' },
      nullifiersRef: { storage: 'official_publication_artifacts', ref: 'snapshot', digest: 'n', count: 2 },
      creditsRequired: '2',
      tvdRequired: '2000000000000000000',
      tvdPerCredit: '1000000000000000000',
      tokenSource: 'TVD_CREDITS_CONTRACT',
      spender: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
      ...overrides,
    };
  }

  it('crea o recupera solicitud activa de forma idempotente', async () => {
    const first = await service.createOrGetActiveRequest(input());
    const second = await service.createOrGetActiveRequest(input());

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.request.requestId).toBe(first.request.requestId);
  });

  it('resuelve carrera de creacion por E11000 recuperando la activa', async () => {
    model.throwDuplicateAfterCreateLookup = true;
    const result = await service.createOrGetActiveRequest(input());

    expect(result.created).toBe(false);
    expect(result.request.requestId).toBe('raced-request');
  });

  it('aplica transicion atomica con estado y version', async () => {
    const { request } = await service.createOrGetActiveRequest(input());
    const updated = await service.markPrepared(request.requestId, 'admin');

    expect(updated.status).toBe('PENDING_APPROVAL');
    expect(updated.version).toBe(1);
    expect(updated.statusHistory).toHaveLength(1);
  });

  it('rechaza conflicto de version', async () => {
    const { request } = await service.createOrGetActiveRequest(input());

    await expect(
      service.transition({
        requestId: request.requestId,
        action: 'MARK_PREPARED',
        actor: 'admin',
        expectedStatus: 'PREPARING',
        expectedVersion: 99,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reclama idempotente para el mismo dispositivo y rechaza otro', async () => {
    const { request } = await service.createOrGetActiveRequest(input());
    await service.markPrepared(request.requestId, 'admin');
    const claimed = await service.claimRequest({
      requestId: request.requestId,
      actor: 'device-a',
      deviceId: 'device-a',
      lockMs: 60000,
      at: new Date('2026-07-22T12:00:00.000Z'),
    });
    const repeated = await service.claimRequest({
      requestId: request.requestId,
      actor: 'device-a',
      deviceId: 'device-a',
      lockMs: 60000,
      at: new Date('2026-07-22T12:00:05.000Z'),
    });

    expect(claimed.status).toBe('CLAIMED');
    expect(repeated.requestId).toBe(request.requestId);
    await expect(
      service.claimRequest({
        requestId: request.requestId,
        actor: 'device-b',
        deviceId: 'device-b',
        lockMs: 60000,
        at: new Date('2026-07-22T12:00:10.000Z'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('registra un unico userOpHash', async () => {
    const { request } = await service.createOrGetActiveRequest(input());
    await service.markPrepared(request.requestId, 'admin');
    await service.claimRequest({
      requestId: request.requestId,
      actor: 'device-a',
      deviceId: 'device-a',
      lockMs: 60000,
    });
    await service.transition({ requestId: request.requestId, action: 'START_SIGNING', actor: 'device-a' });
    const submitted = await service.registerSubmission({
      requestId: request.requestId,
      actor: 'device-a',
      userOpHash: '0xABC',
      txHash: '0xAAA',
    });
    const repeated = await service.registerSubmission({
      requestId: request.requestId,
      actor: 'device-a',
      userOpHash: '0xabc',
    });

    expect(submitted.userOpHash).toBe('0xabc');
    expect(submitted.txHash).toBe('0xaaa');
    expect(repeated.userOpHash).toBe('0xabc');
    await expect(
      service.registerSubmission({
        requestId: request.requestId,
        actor: 'device-a',
        userOpHash: '0xdef',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marca SIGNING y no libera claim vencido cuando ya existe userOpHash', async () => {
    const { request } = await service.createOrGetActiveRequest(input());
    await service.markPrepared(request.requestId, 'admin');
    await service.claimRequest({
      requestId: request.requestId,
      actor: 'device-a',
      deviceId: 'device-a',
      lockMs: 1,
      at: new Date('2026-07-22T12:00:00.000Z'),
    });
    const signing = await service.startSigning(request.requestId, 'device-a');
    expect(signing.status).toBe('SIGNING');

    await service.registerSubmission({
      requestId: request.requestId,
      actor: 'device-a',
      userOpHash: '0xabc',
    });
    const released = await service.releaseExpiredClaim(
      request.requestId,
      'system',
      new Date('2026-07-22T12:01:00.000Z'),
    );

    expect(released.status).toBe('SUBMITTED');
    expect(released.claimedByDeviceId).toBe('device-a');
  });

  it('estado terminal libera activeKey y fallo recuperable lo conserva', async () => {
    const { request } = await service.createOrGetActiveRequest(input());
    await service.markPrepared(request.requestId, 'admin');
    const failed = await service.markFailedRetryable(
      request.requestId,
      'admin',
      'CHAIN_PENDING',
      'Reintentar',
      'CHAIN_PENDING',
    );
    expect(failed.activeKey).toBe(service.buildActiveKey(ids.eventId));

    const final = await service.markFailedFinal(
      request.requestId,
      'admin',
      'FINAL',
      'Final',
    );
    expect(final.status).toBe('FAILED_FINAL');
    expect(final.activeKey).toBeNull();
  });

  it('fallo retryable de preparacion libera activeKey y permite nuevo request', async () => {
    const { request } = await service.createOrGetActiveRequest(input());
    const failed = await service.markFailedRetryable(
      request.requestId,
      'admin',
      'OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING',
      'No se pudo completar la preparacion de la publicacion oficial',
      'PREPARING',
      new Date('2026-07-22T12:00:00.000Z'),
      'ARTIFACT_ENCRYPTION',
    );

    expect(failed.status).toBe('FAILED_RETRYABLE');
    expect(failed.activeKey).toBeNull();
    expect(failed.errorCode).toBe('OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING');
    expect(failed.errorStage).toBe('ARTIFACT_ENCRYPTION');
    expect(failed.lastErrorAt).toEqual(new Date('2026-07-22T12:00:00.000Z'));
    await expect(service.getActiveRequestByEventId(ids.eventId)).resolves.toBeNull();

    const retried = await service.createOrGetActiveRequest(input());
    expect(retried.created).toBe(true);
    expect(retried.request.requestId).not.toBe(request.requestId);
  });

  it('FAILED_RETRYABLE pre-submission heredado con activeKey no bloquea nuevo intento', async () => {
    const { request } = await service.createOrGetActiveRequest(input());
    request.status = 'FAILED_RETRYABLE';
    request.resumeFromStatus = 'PREPARING';
    request.userOpHash = null;
    request.txHash = null;

    await expect(service.getActiveRequestByEventId(ids.eventId)).resolves.toBeNull();
    const retried = await service.createOrGetActiveRequest(input());

    expect(request.activeKey).toBeNull();
    expect(retried.created).toBe(true);
    expect(retried.request.requestId).not.toBe(request.requestId);
  });
});
