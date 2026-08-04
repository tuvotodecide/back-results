import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import { PresentialSessionsService } from '@/modules/institutional-voting/services/presential/presential-sessions.service';
import { VotingEventsService } from '@/modules/institutional-voting/services/events/voting-events.service';
import { PresentialSessionDocument } from '@/modules/institutional-voting/schemas/presential-session.schema';
import { VotingEventDocument } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { ParticipationService } from '@/modules/institutional-voting/services/participation/participation.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { VoteReaderService } from '@/modules/institutional-voting/services/core/vote-reader.service';
import { VoteWritterService } from '@/modules/institutional-voting/services/core/vote-writter.service';
import { PadronUsersService } from '@/modules/institutional-voting/services/core/padron-users.service';
import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';
import { PadronService } from '@/modules/institutional-voting/services/padron/padron.service';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { OfficialPublicationPreparationService } from '@/modules/institutional-voting/services/publication/official-publication-preparation.service';
import { OfficialPublicationFinalizationService } from '@/modules/institutional-voting/services/publication/official-publication-finalization.service';

type SessionRecord = {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  stationId: string;
  tokenId: string;
  tokenHash: string;
  status: 'READY' | 'CLAIMED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  claimedByCarnetNorm: string | null;
  rotationNumber: number;
  claimTtlSeconds: number;
};

const asSessionDocument = (value: SessionRecord) =>
  value as unknown as PresentialSessionDocument;

const asEventDocument = (value: Record<string, unknown>) =>
  value as unknown as VotingEventDocument;

const queryResult = <T>(resolveValue: () => T | Promise<T>) => {
  const exec = jest.fn(async () => resolveValue());
  return {
    exec,
    lean: jest.fn(async () => resolveValue()),
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return exec().then(onfulfilled, onrejected);
    },
  };
};

type SessionModelMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  findById: jest.Mock;
  findOneAndUpdate: jest.Mock;
  create: jest.Mock;
};

describe('MX-09 kiosk QR focal unit coverage', () => {
  let service: PresentialSessionsService;
  let event: VotingEventDocument;
  let sessions: SessionRecord[];
  let access: {
    getEventOrThrow: jest.Mock;
    assertTenantWriteAccess: jest.Mock;
  };
  let participation: { checkParticipationStatus: jest.Mock };
  let sessionModelMock: SessionModelMock;

  const queryOne = (filter: Record<string, unknown>) => ({
    sort: jest.fn(() => queryResult(async () => {
      const statuses = (filter.status as { $in?: string[] } | undefined)?.$in;
      const minimumExpiration = (filter.expiresAt as { $gt?: Date } | undefined)?.$gt;
      const result = sessions
        .filter((session) =>
          (!filter.eventId || String(session.eventId) === String(filter.eventId)) &&
          session.stationId === filter.stationId &&
          (!statuses || statuses.includes(session.status)) &&
          (!minimumExpiration || session.expiresAt > minimumExpiration),
        )
        .sort((left, right) =>
          right.rotationNumber - left.rotationNumber ||
          String(right._id).localeCompare(String(left._id)),
        )[0];
      return result ? asSessionDocument(result) : null;
    })),
  });

  beforeEach(() => {
    const now = Date.now();
    event = asEventDocument({
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      name: 'Elección presencial',
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date(now - 60_000),
      votingEnd: new Date(now + 60 * 60_000),
      presentialKioskEnabled: true,
      presentialKioskTokenHash: undefined,
      save: jest.fn().mockResolvedValue(undefined),
    });
    sessions = [];
    access = {
      getEventOrThrow: jest.fn().mockResolvedValue(event),
      assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined),
    };
    participation = {
      checkParticipationStatus: jest.fn().mockResolvedValue({ status: 'CAN_VOTE' }),
    };

    sessionModelMock = {
      find: jest.fn((filter: Record<string, unknown>) => ({
        sort: jest.fn(() => ({
          limit: jest.fn(() => queryResult(async () => sessions.filter((session) => {
              const statuses = (filter.status as { $in?: string[] } | undefined)?.$in;
              const expiration = (filter.expiresAt as { $lte?: Date } | undefined)?.$lte;
              return (!filter.eventId || String(session.eventId) === String(filter.eventId)) &&
                (!filter.stationId || session.stationId === filter.stationId) &&
                (!statuses || statuses.includes(session.status)) &&
                (!expiration || session.expiresAt <= expiration);
            }).map(asSessionDocument))),
        })),
      })),
      findOne: jest.fn((filter: Record<string, unknown>) => queryOne(filter)),
      findById: jest.fn((id: Types.ObjectId | string) => queryResult(async () => {
        const session = sessions.find((entry) => String(entry._id) === String(id));
        return session ? asSessionDocument(session) : null;
      })),
      findOneAndUpdate: jest.fn((filter: Record<string, unknown>, update: { $set: Partial<SessionRecord> }) => queryResult(async () => {
        const statuses = Array.isArray(filter.status)
          ? filter.status
          : (filter.status as { $in?: string[] } | undefined)?.$in;
        const candidate = sessions.find((session) =>
          (!filter._id || String(session._id) === String(filter._id)) &&
          (!statuses || statuses.includes(session.status)) &&
          (!(filter.expiresAt as { $gt?: Date } | undefined)?.$gt || session.expiresAt > (filter.expiresAt as { $gt: Date }).$gt) &&
          (!filter.claimedByCarnetNorm || session.claimedByCarnetNorm === filter.claimedByCarnetNorm),
        );
        if (!candidate) return null;
        Object.assign(candidate, update.$set);
        return asSessionDocument(candidate);
      })),
      create: jest.fn(async (input: Partial<SessionRecord>) => {
        const session: SessionRecord = {
          _id: input._id ?? new Types.ObjectId(),
          eventId: input.eventId ?? (event._id as Types.ObjectId),
          stationId: input.stationId ?? 'kiosco-principal',
          tokenId: input.tokenId ?? 'token-id',
          tokenHash: input.tokenHash ?? 'token-hash',
          status: input.status ?? 'READY',
          expiresAt: input.expiresAt ?? new Date(),
          claimedAt: input.claimedAt ?? null,
          completedAt: input.completedAt ?? null,
          claimedByCarnetNorm: input.claimedByCarnetNorm ?? null,
          rotationNumber: input.rotationNumber ?? 1,
          claimTtlSeconds: input.claimTtlSeconds ?? 300,
        };
        sessions.push(session);
        return asSessionDocument(session);
      }),
    };

    service = new PresentialSessionsService(
      sessionModelMock as unknown as Model<PresentialSessionDocument>,
      { findById: jest.fn(() => queryResult(async () => event)) } as unknown as Model<VotingEventDocument>,
      access as unknown as InstitutionalVotingAccessService,
      participation as unknown as ParticipationService,
    );
  });

  const createReady = async (overrides: Partial<SessionRecord> = {}) => {
    const created = await service.createOrRotateCurrentSession(String(event._id), {
      stationId: overrides.stationId,
      readyTtlSeconds: 30,
      claimTtlSeconds: 30,
    }, { sub: String(new Types.ObjectId()) });
    const session = sessions.find((entry) => String(entry._id) === created.currentSession?.id);
    if (!session) throw new Error('Expected a READY session');
    Object.assign(session, overrides);
    return { created, session };
  };

  it('[MX-09][KIO-HAB-P0-001][UNITARIA] desactiva el kiosco, limpia el token, conserva terminales y no borra trazabilidad', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Elección presencial',
      objective: 'Elegir directiva',
      isReferendum: false,
      presentialKioskEnabled: true,
      presentialKioskTokenHash: 'token-hash',
      presentialKioskIssuedAt: new Date(),
      presentialKioskLastUsedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const persistedSessions = [
      { status: 'READY' },
      { status: 'CLAIMED' },
      { status: 'COMPLETED' },
      { status: 'EXPIRED' },
      { status: 'CANCELLED' },
    ];
    const presentialSessionModel = {
      updateMany: jest.fn(async (
        filter: { status: { $in: string[] } },
        update: { $set: { status: string } },
      ) => {
        persistedSessions.forEach((session) => {
          if (filter.status.$in.includes(session.status)) {
            session.status = update.$set.status;
          }
        });
        return { modifiedCount: 2 };
      }),
      deleteMany: jest.fn(),
    };
    const votingAccess = {
      getEventOrThrow: jest.fn().mockResolvedValue(event),
      assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined),
      canFullyEditEvent: jest.fn().mockReturnValue(true),
    };
    const inertModel = { deleteMany: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VotingEventsService,
        { provide: getModelToken('VotingEvent'), useValue: inertModel },
        { provide: getModelToken('EventRole'), useValue: inertModel },
        { provide: getModelToken('VotingOption'), useValue: inertModel },
        { provide: getModelToken('PadronVersion'), useValue: inertModel },
        { provide: getModelToken('PadronEntry'), useValue: inertModel },
        { provide: getModelToken('PadronImportJob'), useValue: inertModel },
        { provide: getModelToken('PadronStagingEntry'), useValue: inertModel },
        { provide: getModelToken('ComparisonReport'), useValue: inertModel },
        { provide: getModelToken('Participation'), useValue: inertModel },
        { provide: getModelToken('PresentialSession'), useValue: presentialSessionModel },
        { provide: getModelToken('EventResultsSnapshot'), useValue: inertModel },
        { provide: getModelToken('EnabledSession'), useValue: inertModel },
        { provide: InstitutionalVotingAccessService, useValue: votingAccess },
        { provide: InstitutionalVotingNotificationsService, useValue: {} },
        { provide: VoteReaderService, useValue: {} },
        { provide: VoteWritterService, useValue: {} },
        { provide: PadronUsersService, useValue: {} },
        { provide: IssuerService, useValue: {} },
        { provide: PadronService, useValue: {} },
        { provide: TvdBlockchainService, useValue: {} },
        { provide: OfficialPublicationPreparationService, useValue: {} },
        { provide: OfficialPublicationFinalizationService, useValue: {} },
      ],
    }).compile();

    try {
      const votingEvents = moduleRef.get(VotingEventsService);
      const result = await votingEvents.updateEvent(
        String(event._id),
        { presentialKioskEnabled: false },
        { sub: 'admin-1' },
      );

      expect(votingAccess.assertTenantWriteAccess).toHaveBeenCalledWith(event.tenantId, { sub: 'admin-1' });
      expect(presentialSessionModel.updateMany).toHaveBeenCalledWith(
        {
          eventId: event._id,
          status: { $in: ['READY', 'CLAIMED'] },
        },
        {
          $set: {
            status: 'CANCELLED',
            expiresAt: expect.any(Date),
          },
        },
      );
      expect(event.presentialKioskTokenHash).toBeUndefined();
      expect(event.presentialKioskIssuedAt).toBeUndefined();
      expect(event.presentialKioskLastUsedAt).toBeUndefined();
      expect(presentialSessionModel.deleteMany).not.toHaveBeenCalled();
      expect(persistedSessions.map((session) => session.status)).toEqual([
        'CANCELLED',
        'CANCELLED',
        'COMPLETED',
        'EXPIRED',
        'CANCELLED',
      ]);
      expect(event.save).toHaveBeenCalledTimes(1);
      expect(result.presentialKioskEnabled).toBe(false);
    } finally {
      await moduleRef.close();
    }
  });

  it('[MX-09][KIO-QR-P0-001][UNITARIA] normaliza estación, genera token estructurado y persiste hash, id y TTL acotado', async () => {
    const { created, session } = await createReady({ stationId: 'kiosco-principal' });
    expect(created.stationId).toBe('kiosco-principal');
    expect(created.currentSession?.qrValue).toMatch(/^pqs\.[a-f0-9]{24}\.[a-f0-9]+$/);
    expect(session.tokenId).toHaveLength(48);
    expect(session.tokenHash).not.toBe(created.currentSession?.qrValue);
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(25_000);
  });

  it('[MX-09][KIO-QR-P0-002][UNITARIA] expone QR solo para READY dentro de OFFICIALLY_PUBLISHED o PUBLISHED', async () => {
    const { created, session } = await createReady();
    expect(created.currentSession?.qrValue).toMatch(/^pqs\./);
    session.status = 'CLAIMED';
    const state = await service.getCurrentSessionState(String(event._id), undefined, undefined, { sub: 'admin' });
    expect(state.session?.qrValue).toBeNull();
    session.status = 'COMPLETED';
    event.state = 'DRAFT';
    const inactive = await service.createOrRotateCurrentSession(String(event._id), {}, { sub: 'admin' });
    expect(inactive.currentSession).toBeNull();
  });

  it('[MX-09][KIO-QR-P0-005][UNITARIA] cancela READY anterior y rechaza rotación cuando está CLAIMED', async () => {
    const { session } = await createReady();
    const rotated = await service.createOrRotateCurrentSession(String(event._id), {}, { sub: 'admin' });
    expect(session.status).toBe('CANCELLED');
    expect(rotated.currentSession?.rotationNumber).toBe(2);
    const active = sessions.find((entry) => entry.status === 'READY');
    if (!active) throw new Error('Expected active session');
    active.status = 'CLAIMED';
    await expect(service.createOrRotateCurrentSession(String(event._id), {}, { sub: 'admin' })).rejects.toBeInstanceOf(ConflictException);
    expect(sessions.filter((entry) => ['READY', 'CLAIMED'].includes(entry.status))).toHaveLength(1);
  });

  it('[MX-09][KIO-VAL-P0-001][UNITARIA] rechaza token vacío, malformado, inexistente y con hash distinto', async () => {
    await expect(service.scanAndClaim({ token: '', carnet: 'ABC-789' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.scanAndClaim({ token: 'invalid', carnet: 'ABC-789' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.scanAndClaim({ token: `pqs.${new Types.ObjectId()}.token`, carnet: 'ABC-789' })).rejects.toMatchObject({ status: 404 });
    const { created, session } = await createReady();
    session.tokenHash = 'not-the-real-hash';
    await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'ABC-789' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-09][KIO-VAL-P0-002][UNITARIA] rechaza kiosco deshabilitado y evento fuera de la ventana activa', async () => {
    const { created } = await createReady();
    event.presentialKioskEnabled = false;
    await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'ABC-789' })).rejects.toBeInstanceOf(ForbiddenException);
    event.presentialKioskEnabled = true;
    event.votingEnd = new Date(Date.now() - 1);
    await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'ABC-789' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-09][KIO-VAL-P0-003][UNITARIA] normaliza carnet y controla elegibilidad y participación previa', async () => {
    const { created } = await createReady();
    await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: ' ' })).rejects.toBeInstanceOf(BadRequestException);
    await service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: ' abc-789 ' });
    expect(participation.checkParticipationStatus).toHaveBeenCalledWith(String(event._id), 'ABC789');
    const { created: second } = await createReady({ stationId: 'second' });
    participation.checkParticipationStatus.mockResolvedValueOnce({ status: 'ALREADY_VOTED' });
    await expect(service.scanAndClaim({ token: second.currentSession?.qrToken ?? '', carnet: 'XYZ-123' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-09][KIO-VAL-P0-004][UNITARIA] hace claim READY atómico, permite el reintento propio y rechaza otro carnet', async () => {
    const { created, session } = await createReady();
    const first = await service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'ABC-789' });
    expect(first.statusCode).toBe(201);
    expect(session.status).toBe('CLAIMED');
    const retry = await service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'ABC-789' });
    expect(retry.statusCode).toBe(200);
    await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'XYZ-123' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-09][KIO-VAL-P0-005][UNITARIA] diferencia QR completed, expired, cancelled y reclamado por otra persona', async () => {
    for (const status of ['COMPLETED', 'EXPIRED', 'CANCELLED'] as const) {
      const { created, session } = await createReady({ stationId: status });
      session.status = status;
      await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'ABC-789' })).rejects.toBeInstanceOf(ConflictException);
    }
    const { created, session } = await createReady({ stationId: 'claimed' });
    session.status = 'CLAIMED';
    session.claimedByCarnetNorm = 'ABC-789';
    await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'XYZ-123' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-09][KIO-CNS-P0-001][UNITARIA] cierra solamente una sesión CLAIMED propia después de la participación', async () => {
    const { session } = await createReady();
    session.status = 'CLAIMED';
    session.claimedByCarnetNorm = 'ABC789';
    await expect(service.completeSessionForParticipation(String(event._id), String(session._id), 'XYZ-123')).rejects.toBeInstanceOf(ForbiddenException);
    const completed = await service.completeSessionForParticipation(String(event._id), String(session._id), ' abc-789 ');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toBeInstanceOf(Date);
    await expect(service.completeSessionForParticipation(String(new Types.ObjectId()), String(session._id), 'ABC-789')).rejects.toMatchObject({ status: 404 });
    expect(sessions).toContain(session);
  });

  it('[MX-09][KIO-CNS-P0-002][UNITARIA] rechaza id inválido, READY, otra votación, titular ajeno y vencimiento', async () => {
    await expect(service.assertSessionCanRegisterParticipation(String(event._id), 'bad-id', 'ABC-789')).rejects.toBeInstanceOf(BadRequestException);
    const { session } = await createReady();
    await expect(service.assertSessionCanRegisterParticipation(String(event._id), String(session._id), 'ABC-789')).rejects.toBeInstanceOf(ConflictException);
    session.status = 'CLAIMED';
    session.claimedByCarnetNorm = 'ABC789';
    await expect(service.assertSessionCanRegisterParticipation(String(event._id), String(session._id), 'XYZ-123')).rejects.toBeInstanceOf(ForbiddenException);
    session.expiresAt = new Date(Date.now() - 1);
    await expect(service.assertSessionCanRegisterParticipation(String(event._id), String(session._id), 'ABC-789')).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-09][KIO-CON-P0-001][UNITARIA] reutiliza una sesión activa en vez de duplicarla', async () => {
    const { session } = await createReady();
    const current = await service.getCurrentSessionState(String(event._id), undefined, undefined, { sub: 'admin' });
    expect(current.session?.id).toBe(String(session._id));
    expect(sessions.filter((entry) => entry.status === 'READY')).toHaveLength(1);
  });

  it('[MX-09][KIO-CON-P0-002][UNITARIA] expira READY o CLAIMED, publica la transición y no completa el cierre vencido', async () => {
    jest.useFakeTimers();
    const votingStart = event.votingStart ? new Date(event.votingStart).getTime() : Date.now();
    const controlledNow = new Date(votingStart + 30_000);
    jest.setSystemTime(controlledNow);
    try {
      const { session } = await createReady();
      session.status = 'CLAIMED';
      session.claimedByCarnetNorm = 'ABC789';
      session.claimedAt = new Date(controlledNow.getTime() - 300_000);
      session.claimTtlSeconds = 300;
      const stream = await service.createAuthorizedStream(String(event._id), undefined, undefined, { sub: 'admin' });
      const events: string[] = [];
      const subscription = stream.subscribe((message) => events.push(String(message.type)));
      session.expiresAt = new Date(controlledNow.getTime() - 1_000);
      await service.expireTimedOutSessions();
      subscription.unsubscribe();
      expect(session.status).toBe('EXPIRED');
      expect(events).toContain('session.expired');
      await expect(service.completeSessionForParticipation(String(event._id), String(session._id), ' abc-789 ')).rejects.toBeInstanceOf(ConflictException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('[MX-09][KIO-CON-P0-004][UNITARIA] condiciona el update atómico a READY y rechaza el segundo claim', async () => {
    const { created } = await createReady();
    await service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'ABC-789' });
    expect(sessionModelMock.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'READY', expiresAt: expect.objectContaining({ $gt: expect.any(Date) }) }),
      expect.any(Object),
      { returnDocument: 'after' },
    );
    await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'XYZ-123' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-09][KIO-SEC-P0-001][UNITARIA] no expone identidad ni voto y restringe reutilización del token al titular', async () => {
    const { created } = await createReady();
    expect(created.currentSession?.qrValue).not.toContain('ABC-789');
    expect(created.currentSession?.qrValue).not.toContain('option');
    await service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'ABC-789' });
    await expect(service.scanAndClaim({ token: created.currentSession?.qrToken ?? '', carnet: 'XYZ-123' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-09][KIO-SEC-P0-002][UNITARIA] compara hash, exige token limitado y permite sesión administrativa autorizada', async () => {
    const { created } = await createReady();
    await expect(service.getCurrentSessionState(String(event._id))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getCurrentSessionState(String(event._id), undefined, 'pkc_invalid')).rejects.toBeInstanceOf(UnauthorizedException);
    const state = await service.getCurrentSessionState(String(event._id), undefined, undefined, { sub: 'admin' });
    expect(state.session?.id).toBe(created.currentSession?.id);
    expect(access.assertTenantWriteAccess).toHaveBeenCalled();
  });

  it('[MX-09][KIO-SEC-P0-003][UNITARIA] emite errores controlados sin eco de token ni carnet', async () => {
    const secret = 'pqs.secret-token.never-expose';
    await expect(service.scanAndClaim({ token: secret, carnet: 'ABC-789' })).rejects.toMatchObject({ message: 'token inválido' });
    await expect(service.assertSessionCanRegisterParticipation(String(event._id), String(new Types.ObjectId()), 'ABC-789')).rejects.toMatchObject({ status: 404 });
  });
});
