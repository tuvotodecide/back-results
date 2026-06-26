import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { VotingEventsService } from '@/modules/institutional-voting/services/events/voting-events.service';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { EventRole } from '@/modules/institutional-voting/schemas/event-role.schema';
import { VotingOption } from '@/modules/institutional-voting/schemas/voting-option.schema';
import { PadronVersion } from '@/modules/institutional-voting/schemas/padron-version.schema';
import { PadronEntry } from '@/modules/institutional-voting/schemas/padron-entry.schema';
import { PadronImportJob } from '@/modules/institutional-voting/schemas/padron-import-job.schema';
import { PadronStagingEntry } from '@/modules/institutional-voting/schemas/padron-staging-entry.schema';
import { ComparisonReport } from '@/modules/institutional-voting/schemas/comparison-report.schema';
import { Participation } from '@/modules/institutional-voting/schemas/participation.schema';
import { PresentialSession } from '@/modules/institutional-voting/schemas/presential-session.schema';
import { EventResultsSnapshot } from '@/modules/institutional-voting/schemas/event-results-snapshot.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { VoteReaderService } from '@/modules/institutional-voting/services/core/vote-reader.service';
import { EnabledSession } from '@/modules/institutional-voting/schemas/enabled-session.shcema';
import { VoteWritterService } from '@/modules/institutional-voting/services/core/vote-writter.service';
import { PadronUsersService } from '@/modules/institutional-voting/services/core/padron-users.service';
import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';
import { PadronService } from '@/modules/institutional-voting/services/padron/padron.service';

describe('VotingEventsService (unit)', () => {
  let service: VotingEventsService;

  let votingEventModel: any;
  let eventRoleModel: any;
  let votingOptionModel: any;
  let padronVersionModel: any;
  let padronEntryModel: any;
  let padronImportJobModel: any;
  let padronStagingEntryModel: any;
  let enabledSessionModel: any;
  let comparisonReportModel: any;
  let participationModel: any;
  let presentialSessionModel: any;
  let resultsSnapshotModel: any;
  let accessService: any;
  let notificationsService: any;
  let voteReaderService: any;
  let voteWritterService: any;
  let padronUsersService: any;
  let issuerService: any;
  let padronService: any;

  beforeEach(async () => {
    votingEventModel = {
      create: jest.fn(),
      find: jest.fn(),
      deleteOne: jest.fn(),
    };
    eventRoleModel = {
      countDocuments: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      deleteMany: jest.fn(),
      deleteOne: jest.fn(),
    };
    votingOptionModel = {
      countDocuments: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      deleteOne: jest.fn(),
    };
    padronVersionModel = {
      exists: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      deleteMany: jest.fn(),
    };
    padronEntryModel = {
      find: jest.fn(),
      deleteMany: jest.fn(),
    };
    padronEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(), carnetNorm: '111' }]),
    });
    padronImportJobModel = {
      findOne: jest.fn(),
      deleteMany: jest.fn(),
    };
    padronImportJobModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    padronStagingEntryModel = {
      find: jest.fn(),
      deleteMany: jest.fn(),
    };
    padronStagingEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    enabledSessionModel = {
      insertMany: jest.fn(),
      findOne: jest.fn(),
    }
    comparisonReportModel = {
      exists: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
      deleteMany: jest.fn(),
    };
    participationModel = {
      deleteMany: jest.fn(),
    };
    presentialSessionModel = {
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    };
    resultsSnapshotModel = {
      deleteMany: jest.fn(),
    };
    accessService = {
      getEventOrThrow: jest.fn(),
      getTenantOrThrow: jest.fn(),
      assertTenantWriteAccess: jest.fn(),
      resolveReadableTenantIds: jest.fn(),
      parseAndValidateDates: jest.fn(),
      computePublishDeadline: jest.fn((votingStart: Date) => new Date(votingStart.getTime() - 6 * 60 * 60 * 1000)),
      getCreateLeadHours: jest.fn(() => 12),
      getOfficialPublicationLeadHours: jest.fn(() => 6),
      canFullyEditEvent: jest.fn(() => true),
      canModifyPadronDuringVoting: jest.fn(() => false),
      hasPublicationWindowExpired: jest.fn(() => false),
      normalizeName: jest.fn((value: string) => value.trim().toLowerCase()),
    };
    notificationsService = {
      notifyConvocationIfEligible: jest.fn(),
      notifyOfficialPublicationConfirmed: jest.fn(),
      notifyVotingCancelledToCurrentPadron: jest.fn(),
      notifyNewsToCurrentPadron: jest.fn(),
      notifyScheduleUpdatedToCurrentPadron: jest.fn(),
    };
    voteReaderService = {
      getResults: jest.fn(),
    };
    voteWritterService = {
      createVote: jest.fn(),
      updateVoteSchedule: jest.fn(),
      castVote: jest.fn(),
    };
    padronUsersService = {
      getPadronUsersFromEvent: jest.fn(),
    };
    issuerService = {
      issueCredential: jest.fn(),
      getDidsByDnis: jest.fn().mockResolvedValue([{ dni: '111' }]),
    };
    padronService = {
      materializeActiveDraftVersion: jest.fn().mockResolvedValue(null),
      removeUnregisteredStagingEntriesForOfficialPublication: jest.fn().mockResolvedValue({
        removedCount: 0,
        remainingCount: 1,
      }),
    };


    const moduleRef = await Test.createTestingModule({
      providers: [
        VotingEventsService,
        { provide: getModelToken(VotingEvent.name), useValue: votingEventModel },
        { provide: getModelToken(EventRole.name), useValue: eventRoleModel },
        { provide: getModelToken(VotingOption.name), useValue: votingOptionModel },
        { provide: getModelToken(PadronVersion.name), useValue: padronVersionModel },
        { provide: getModelToken(PadronEntry.name), useValue: padronEntryModel },
        { provide: getModelToken(PadronImportJob.name), useValue: padronImportJobModel },
        { provide: getModelToken(PadronStagingEntry.name), useValue: padronStagingEntryModel },
        { provide: getModelToken(EnabledSession.name), useValue: enabledSessionModel },
        {
          provide: getModelToken(ComparisonReport.name),
          useValue: comparisonReportModel,
        },
        { provide: getModelToken(Participation.name), useValue: participationModel },
        { provide: getModelToken(PresentialSession.name), useValue: presentialSessionModel },
        {
          provide: getModelToken(EventResultsSnapshot.name),
          useValue: resultsSnapshotModel,
        },
        { provide: InstitutionalVotingAccessService, useValue: accessService },
        {
          provide: InstitutionalVotingNotificationsService,
          useValue: notificationsService,
        },
        { provide: VoteReaderService, useValue: voteReaderService },
        { provide: VoteWritterService, useValue: voteWritterService },
        { provide: PadronUsersService, useValue: padronUsersService },
        { provide: IssuerService, useValue: issuerService },
        { provide: PadronService, useValue: padronService },
      ],
    }).compile();

    service = moduleRef.get(VotingEventsService);
  });

  it('crea un evento institucional en borrador', async () => {
    const tenant = { _id: new Types.ObjectId() };
    const created = {
      _id: new Types.ObjectId(),
      tenantId: tenant._id,
      name: 'Eleccion Directiva',
      objective: 'Elegir directiva',
      votingStart: new Date('2026-01-01T08:00:00.000Z'),
      votingEnd: new Date('2026-01-01T10:00:00.000Z'),
      resultsPublishAt: new Date('2026-01-01T11:00:00.000Z'),
      state: 'DRAFT',
    };
    accessService.getTenantOrThrow.mockResolvedValue(tenant);
    accessService.parseAndValidateDates.mockReturnValue({
      votingStart: created.votingStart,
      votingEnd: created.votingEnd,
      resultsPublishAt: created.resultsPublishAt,
    });
    votingEventModel.create.mockResolvedValue(created);

    const result = await service.createEvent(
      {
        tenantId: String(tenant._id),
        name: created.name,
        objective: created.objective,
        votingStart: created.votingStart.toISOString(),
        votingEnd: created.votingEnd.toISOString(),
        resultsPublishAt: created.resultsPublishAt.toISOString(),
      },
      { sub: 'user-1' },
    );

    expect(accessService.assertTenantWriteAccess).toHaveBeenCalledWith(
      tenant._id,
      { sub: 'user-1' },
    );
    expect(result.state).toBe('DRAFT');
    expect(result.isReferendum).toBe(false);
    expect(result.allowPostPublicationPadronEnable).toBe(true);
    expect(eventRoleModel.create).not.toHaveBeenCalled();
  });

  it('persiste referendum y crea automaticamente el cargo tecnico CONSULTA', async () => {
    const tenant = { _id: new Types.ObjectId() };
    const created = {
      _id: new Types.ObjectId(),
      tenantId: tenant._id,
      name: 'Consulta normativa',
      objective: 'Aprobar nueva normativa',
      isReferendum: true,
      votingStart: new Date('2026-01-01T08:00:00.000Z'),
      votingEnd: new Date('2026-01-01T10:00:00.000Z'),
      resultsPublishAt: new Date('2026-01-01T11:00:00.000Z'),
      state: 'DRAFT',
    };
    accessService.getTenantOrThrow.mockResolvedValue(tenant);
    accessService.parseAndValidateDates.mockReturnValue({
      votingStart: created.votingStart,
      votingEnd: created.votingEnd,
      resultsPublishAt: created.resultsPublishAt,
    });
    votingEventModel.create.mockResolvedValue(created);
    eventRoleModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      eventId: created._id,
      name: 'CONSULTA',
      normalizedName: 'consulta',
      maxWinners: 1,
    });

    const result = await service.createEvent(
      {
        tenantId: String(tenant._id),
        name: created.name,
        objective: created.objective,
        isReferendum: true,
        votingStart: created.votingStart.toISOString(),
        votingEnd: created.votingEnd.toISOString(),
        resultsPublishAt: created.resultsPublishAt.toISOString(),
      },
      { sub: 'user-1' },
    );

    expect(votingEventModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ isReferendum: true }),
    );
    expect(eventRoleModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: created._id,
        name: 'CONSULTA',
        normalizedName: 'consulta',
        maxWinners: 1,
      }),
    );
    expect(result.isReferendum).toBe(true);
    expect(result.allowPostPublicationPadronEnable).toBe(true);
  });

  it('marca como CANCELLED un evento DRAFT sin borrar recursos relacionados', async () => {
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Eleccion borrador',
      objective: 'Elegir directiva',
      convocationNotifiedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);

    const result = await service.deleteEvent(String(event._id), { sub: 'admin-1' });

    expect(event.state).toBe('CANCELLED');
    expect(event.cancelledAt).toBeInstanceOf(Date);
    expect(event.cancelledBy).toBe('admin-1');
    expect(event.publicationConfirmed).toBe(false);
    expect(event.save).toHaveBeenCalled();
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
    expect(eventRoleModel.deleteMany).not.toHaveBeenCalled();
    expect(votingOptionModel.deleteMany).not.toHaveBeenCalled();
    expect(padronEntryModel.deleteMany).not.toHaveBeenCalled();
    expect(padronVersionModel.deleteMany).not.toHaveBeenCalled();
    expect(participationModel.deleteMany).not.toHaveBeenCalled();
    expect(presentialSessionModel.deleteMany).not.toHaveBeenCalled();
    expect(resultsSnapshotModel.deleteMany).not.toHaveBeenCalled();
    expect(votingEventModel.deleteOne).not.toHaveBeenCalled();
    expect(comparisonReportModel.deleteMany).not.toHaveBeenCalled();
    expect(notificationsService.notifyVotingCancelledToCurrentPadron).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: String(event._id),
      deleted: true,
      state: 'CANCELLED',
      cancellationNotification: null,
    });
  });

  it('no notifica cancelación si READY_FOR_REVIEW nunca notificó convocatoria', async () => {
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      name: 'Eleccion sin convocatoria',
      objective: 'Elegir directiva',
      convocationNotifiedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);

    await service.deleteEvent(String(event._id), { sub: 'admin-1' });

    expect(event.state).toBe('CANCELLED');
    expect(notificationsService.notifyVotingCancelledToCurrentPadron).not.toHaveBeenCalled();
  });

  it('notifica cancelación si READY_FOR_REVIEW ya notificó convocatoria', async () => {
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      name: 'Eleccion con convocatoria',
      objective: 'Elegir directiva',
      convocationNotifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    notificationsService.notifyVotingCancelledToCurrentPadron.mockResolvedValue({
      sent: 2,
      failed: 0,
    });

    const result = await service.deleteEvent(String(event._id), { sub: 'admin-1' });

    expect(event.state).toBe('CANCELLED');
    expect(notificationsService.notifyVotingCancelledToCurrentPadron).toHaveBeenCalledWith(event);
    expect(result.cancellationNotification).toEqual({ sent: 2, failed: 0 });
  });

  it('rechaza cancelar eventos publicados oficialmente', async () => {
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'OFFICIALLY_PUBLISHED',
      save: jest.fn(),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);

    await expect(
      service.deleteEvent(String(event._id), { sub: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);

    expect(event.state).toBe('OFFICIALLY_PUBLISHED');
    expect(event.save).not.toHaveBeenCalled();
    expect(notificationsService.notifyVotingCancelledToCurrentPadron).not.toHaveBeenCalled();
  });

  it('excluye eventos CANCELLED del listado normal de administración', async () => {
    const tenantId = new Types.ObjectId();
    accessService.resolveReadableTenantIds.mockResolvedValue([tenantId]);
    votingEventModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    const result = await service.listEvents({ sub: 'admin-1' }, String(tenantId));

    expect(votingEventModel.find).toHaveBeenCalledWith({
      tenantId: { $in: [tenantId] },
      state: { $ne: 'CANCELLED' },
    });
    expect(result).toEqual({ data: [] });
  });

  it('devuelve contrato público claro para eventos CANCELLED', async () => {
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'CANCELLED',
      name: 'Eleccion eliminada',
      objective: 'Elegir directiva',
      isReferendum: false,
    };
    accessService.getEventOrThrow.mockResolvedValue(event);

    const result = await service.getPublicEventDetail(String(event._id));

    expect(result).toEqual({
      id: String(event._id),
      tenantId: String(event.tenantId),
      name: 'Eleccion eliminada',
      objective: 'Elegir directiva',
      isReferendum: false,
      state: 'CANCELLED',
      availabilityStatus: 'CANCELLED',
      phase: 'UNAVAILABLE',
      votingStart: null,
      votingEnd: null,
      resultsPublishAt: null,
      publicEligibilityEnabled: false,
      presentialKioskEnabled: false,
      resultsAvailable: false,
      roles: [],
      options: [],
      results: [],
    });
    expect(eventRoleModel.find).not.toHaveBeenCalled();
    expect(votingOptionModel.find).not.toHaveBeenCalled();
  });

  it('actualiza la bandera de habilitación limitada del padrón sin tocar la edición estructural', async () => {
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      isReferendum: false,
      presentialKioskEnabled: false,
      allowPostPublicationPadronEnable: true,
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);

    const result = await service.updateEvent(
      String(event._id),
      { allowPostPublicationPadronEnable: false },
      { sub: 'user-1' },
    );

    expect(event.allowPostPublicationPadronEnable).toBe(false);
    expect(event.save).toHaveBeenCalled();
    expect(result.allowPostPublicationPadronEnable).toBe(false);
  });

  it('rechaza pasar a READY_FOR_REVIEW si faltan precondiciones críticas', async () => {
    const findOneLean = jest.fn().mockResolvedValue(null);
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Eleccion incompleta',
      objective: 'Pendiente de configuracion',
      save: jest.fn(),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    votingOptionModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    padronVersionModel.findOne.mockReturnValue({ lean: findOneLean });

    await expect(
      service.markReadyForReview(String(event._id), { sub: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);

    try {
      await service.markReadyForReview(String(event._id), { sub: 'admin-1' });
    } catch (error: any) {
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          message: 'Faltan precondiciones para pasar a READY_FOR_REVIEW',
          pending: expect.arrayContaining(['cargos', 'opciones', 'padron', 'horarios']),
        }),
      );
    }
  });

  it('confirma publicación oficial sin renotificar cuando la revisión ya fue notificada', async () => {
    const currentPadron = {
      _id: new Types.ObjectId(),
      totals: { validCount: 1, invalidCount: 0, duplicateCount: 0 },
    };
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      convocationNotifiedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'Presidente' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ roleName: 'Presidente' }] }]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentPadron),
    });
    padronUsersService.getPadronUsersFromEvent.mockResolvedValue([{ dni: '111' }]);
    voteWritterService.createVote.mockResolvedValue(['nullifier-1']);
    issuerService.issueCredential.mockResolvedValue({
      '111': { credentialData: 'credential-111' },
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    notificationsService.notifyOfficialPublicationConfirmed.mockResolvedValue({ sent: 2 });

    issuerService.getDidsByDnis.mockImplementation((dnis: string[]) =>
      dnis.length ? Promise.resolve([{ dni: '111' }]) : Promise.resolve([]),
    );
    const result = await service.publishEvent(String(event._id), { sub: 'admin-1' });

    expect(padronService.materializeActiveDraftVersion).toHaveBeenCalledWith(
      String(event._id),
      { sub: 'admin-1' },
      expect.objectContaining({
        comparisonStatus: 'OK',
      }),
    );
    expect(event.save).toHaveBeenCalled();
    expect(notificationsService.notifyConvocationIfEligible).not.toHaveBeenCalled();
    expect(notificationsService.notifyOfficialPublicationConfirmed).toHaveBeenCalledWith(event);
    expect(result.state).toBe('OFFICIALLY_PUBLISHED');
  });

  it('elimina no registrados antes de confirmar la publicación oficial', async () => {
    const importJobId = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      convocationNotifiedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'Presidente' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ roleName: 'Presidente' }] }]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    padronImportJobModel.findOne
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: importJobId,
            summary: {
              stagingCount: 2,
              invalidCount: 0,
              duplicateCount: 0,
              enabledCount: 1,
              disabledCount: 1,
              missingIdentityCount: 1,
            },
          }),
        }),
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: importJobId,
            summary: {
              stagingCount: 1,
              invalidCount: 0,
              duplicateCount: 0,
              enabledCount: 1,
              disabledCount: 0,
              missingIdentityCount: 0,
            },
          }),
        }),
      });
    padronService.removeUnregisteredStagingEntriesForOfficialPublication.mockResolvedValue({
      removedCount: 1,
      remainingCount: 2,
    });
    padronUsersService.getPadronUsersFromEvent.mockResolvedValue([{ dni: '111' }]);
    issuerService.getDidsByDnis.mockResolvedValue([{ dni: '111' }]);
    voteWritterService.createVote.mockResolvedValue(['nullifier-1']);
    issuerService.issueCredential.mockResolvedValue({
      '111': { credentialData: 'credential-111' },
    });
    enabledSessionModel.insertMany.mockResolvedValue([]);
    notificationsService.notifyOfficialPublicationConfirmed.mockResolvedValue({ sent: 1 });

    const result = await service.confirmOfficialPublication(String(event._id), {}, { sub: 'admin-1' });

    expect(padronService.removeUnregisteredStagingEntriesForOfficialPublication).toHaveBeenCalledWith(
      String(event._id),
      { sub: 'admin-1' },
    );
    expect(padronService.materializeActiveDraftVersion).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyConvocationIfEligible).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      state: 'OFFICIALLY_PUBLISHED',
      removedUnregisteredCount: 1,
    }));
  });

  it('bloquea publicación oficial si todos los registros siguen no registrados', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'Presidente' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ roleName: 'Presidente' }] }]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    padronImportJobModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          summary: {
            stagingCount: 2,
            invalidCount: 0,
            duplicateCount: 0,
            missingIdentityCount: 2,
          },
        }),
      }),
    });
    padronService.removeUnregisteredStagingEntriesForOfficialPublication.mockRejectedValue(
      new BadRequestException(
        'No se puede publicar oficialmente porque todos los registros del padrón están no registrados. Debe quedar al menos un registro registrado en el padrón.',
      ),
    );

    await expect(
      service.confirmOfficialPublication(String(event._id), {}, { sub: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);

    expect(padronService.materializeActiveDraftVersion).not.toHaveBeenCalled();
    expect(event.save).not.toHaveBeenCalled();
    expect(notificationsService.notifyOfficialPublicationConfirmed).not.toHaveBeenCalled();
  });

  it('bloquea publicación oficial mientras el padrón siga pendiente de aprobación operativa', async () => {
    const currentPadron = {
      _id: new Types.ObjectId(),
      totals: { validCount: 2, invalidCount: 0, duplicateCount: 0 },
    };
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'Presidente' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ roleName: 'Presidente' }] }]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentPadron),
    });
    comparisonReportModel.exists.mockResolvedValue(false);

    await expect(
      service.publishEvent(String(event._id), { sub: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);

    expect(comparisonReportModel.updateOne).not.toHaveBeenCalled();
    expect(event.save).not.toHaveBeenCalled();
  });

  it('caduca la elección y bloquea la publicación oficial cuando el deadline ya venció', async () => {
    const currentPadron = {
      _id: new Types.ObjectId(),
      totals: { validCount: 2, invalidCount: 0, duplicateCount: 0 },
    };
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() - 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'Presidente' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ roleName: 'Presidente' }] }]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentPadron),
    });
    comparisonReportModel.exists.mockResolvedValue(true);

    await expect(
      service.publishEvent(String(event._id), { sub: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);

    expect(event.state).toBe('PUBLICATION_EXPIRED');
    expect(event.publicationConfirmed).toBe(false);
    expect(event.publicationExpiredAt).toBeInstanceOf(Date);
    expect(event.save).toHaveBeenCalled();
    expect(padronService.materializeActiveDraftVersion).not.toHaveBeenCalled();
    expect(notificationsService.notifyOfficialPublicationConfirmed).not.toHaveBeenCalled();
  });

  it('abre revisión y notifica a empadronados cuando la elección está completa', async () => {
    const currentPadron = {
      _id: new Types.ObjectId(),
      totals: { validCount: 2, invalidCount: 0, duplicateCount: 0 },
    };
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'Presidente' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ roleName: 'Presidente' }] }]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentPadron),
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    notificationsService.notifyConvocationIfEligible.mockResolvedValue({ sent: 2 });

    const result = await service.markReadyForReview(String(event._id), { sub: 'admin-1' });

    expect(padronService.materializeActiveDraftVersion).toHaveBeenCalledWith(
      String(event._id),
      { sub: 'admin-1' },
      expect.objectContaining({
        comparisonStatus: 'OK',
      }),
    );
    expect(notificationsService.notifyConvocationIfEligible).toHaveBeenCalledWith(event);
    expect(result.state).toBe('READY_FOR_REVIEW');
  });

  it('permite READY_FOR_REVIEW en referendum usando el cargo tecnico interno', async () => {
    const currentPadron = {
      _id: new Types.ObjectId(),
      totals: { validCount: 2, invalidCount: 0, duplicateCount: 0 },
    };
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Consulta normativa',
      objective: 'Aprobar normativa interna',
      isReferendum: true,
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'CONSULTA' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { active: true, candidates: [{ roleName: 'CONSULTA', name: 'Sí' }] },
      ]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentPadron),
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    notificationsService.notifyConvocationIfEligible.mockResolvedValue({ sent: 2 });

    const result = await service.markReadyForReview(String(event._id), { sub: 'admin-1' });

    expect(result.state).toBe('READY_FOR_REVIEW');
    expect(event.save).toHaveBeenCalled();
    expect(notificationsService.notifyConvocationIfEligible).toHaveBeenCalledWith(event);
  });

  it('bloquea READY_FOR_REVIEW si no hay votantes registrados y habilitados para notificar', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() + 6 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'Presidente' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ roleName: 'Presidente' }] }]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    padronImportJobModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          summary: {
            stagingCount: 2,
            invalidCount: 0,
            duplicateCount: 0,
            enabledCount: 0,
            disabledCount: 2,
            missingIdentityCount: 1,
          },
        }),
      }),
    });

    try {
      await service.markReadyForReview(String(event._id), { sub: 'admin-1' });
      throw new Error('markReadyForReview should have failed');
    } catch (error: any) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          message: 'Faltan precondiciones para pasar a READY_FOR_REVIEW',
          pending: ['padron_registered_enabled'],
        }),
      );
    }

    expect(padronService.materializeActiveDraftVersion).not.toHaveBeenCalled();
  });

  it('permite READY_FOR_REVIEW con no registrados deshabilitados si hay votantes registrados habilitados', async () => {
    const importJobId = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Eleccion 2026',
      objective: 'Elegir directiva',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() + 6 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ name: 'Presidente' }]),
    });
    votingOptionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ roleName: 'Presidente' }] }]),
    });
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    padronImportJobModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: importJobId,
          summary: {
            stagingCount: 3,
            invalidCount: 0,
            duplicateCount: 0,
            enabledCount: 2,
            disabledCount: 1,
            missingIdentityCount: 1,
          },
        }),
      }),
    });
    padronStagingEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ ciNorm: '111' }, { ciNorm: '222' }]),
    });
    issuerService.getDidsByDnis.mockResolvedValue([{ dni: '111' }, { dni: '222' }]);
    notificationsService.notifyConvocationIfEligible.mockResolvedValue({ sent: 2 });

    const result = await service.markReadyForReview(String(event._id), { sub: 'admin-1' });

    expect(padronService.materializeActiveDraftVersion).toHaveBeenCalledWith(
      String(event._id),
      { sub: 'admin-1' },
      expect.objectContaining({
        comparisonStatus: 'OK',
      }),
    );
    expect(notificationsService.notifyConvocationIfEligible).toHaveBeenCalledWith(event);
    expect(result.state).toBe('READY_FOR_REVIEW');
  });

  it('permite actualizar el evento en READY_FOR_REVIEW sin volver a DRAFT', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      name: 'Evento inicial',
      objective: 'Objetivo inicial',
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    const result = await service.updateEvent(
      String(event._id),
      { name: ' Evento actualizado ', objective: ' Objetivo nuevo ' },
      { sub: 'admin-1' },
    );

    expect(event.save).toHaveBeenCalled();
    expect(result).toEqual({
      id: String(event._id),
      tenantId: String(event.tenantId),
      name: 'Evento actualizado',
      objective: 'Objetivo nuevo',
      isReferendum: false,
      state: 'READY_FOR_REVIEW',
      presentialKioskEnabled: false,
      allowPostPublicationPadronEnable: true,
    });
  });

  it('bloquea actualizar el evento cuando ya no está en borrador', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
      save: jest.fn(),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    accessService.canFullyEditEvent.mockReturnValue(false);

    await expect(
      service.updateEvent(
        String(event._id),
        { name: 'Nuevo nombre' },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('permite actualizar el evento cuando aún está en borrador', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Evento inicial',
      objective: 'Objetivo inicial',
      save: jest.fn().mockResolvedValue(undefined),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);

    const result = await service.updateEvent(
      String(event._id),
      { name: ' Evento actualizado ', objective: ' Objetivo nuevo ' },
      { sub: 'admin-1' },
    );

    expect(event.save).toHaveBeenCalled();
    expect(result).toEqual({
      id: String(event._id),
      tenantId: String(event.tenantId),
      name: 'Evento actualizado',
      objective: 'Objetivo nuevo',
      isReferendum: false,
      state: 'DRAFT',
      presentialKioskEnabled: false,
      allowPostPublicationPadronEnable: true,
    });
  });

  it('no permite cambiar el tipo referendum por actualización posterior del evento', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Consulta',
      objective: 'Objetivo inicial',
      isReferendum: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);

    const result = await service.updateEvent(
      String(event._id),
      { isReferendum: false } as any,
      { sub: 'admin-1' },
    );

    expect(event.isReferendum).toBe(true);
    expect(result.isReferendum).toBe(true);
  });

  it('permite apagar el kiosco presencial antes de la publicación y cancela sesiones activas', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Evento inicial',
      objective: 'Objetivo inicial',
      presentialKioskEnabled: true,
      presentialKioskTokenHash: 'hash',
      presentialKioskIssuedAt: new Date(),
      presentialKioskLastUsedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    presentialSessionModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const result = await service.updateEvent(
      String(event._id),
      { presentialKioskEnabled: false },
      { sub: 'admin-1' },
    );

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
    expect(event.save).toHaveBeenCalled();
    expect(result.presentialKioskEnabled).toBe(false);
  });

  it('bloquea actualizar roles cuando el evento ya no está en borrador', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    accessService.canFullyEditEvent.mockReturnValue(false);

    await expect(
      service.updateRole(
        String(event._id),
        String(new Types.ObjectId()),
        { name: 'Secretario' },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('bloquea crear cargos cuando el evento ya fue publicado', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    accessService.canFullyEditEvent.mockReturnValue(false);

    await expect(
      service.createRole(
        String(event._id),
        { name: 'Secretario', maxWinners: 1 },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(eventRoleModel.create).not.toHaveBeenCalled();
  });

  it('bloquea crear, editar y eliminar cargos manuales en referendum', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      isReferendum: true,
    };
    const roleId = new Types.ObjectId();
    accessService.getEventOrThrow.mockResolvedValue(event);

    await expect(
      service.createRole(
        String(event._id),
        { name: 'Presidencia', maxWinners: 1 },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.updateRole(
        String(event._id),
        String(roleId),
        { name: 'Presidencia' },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.deleteRole(String(event._id), String(roleId), { sub: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);

    expect(eventRoleModel.create).not.toHaveBeenCalled();
    expect(eventRoleModel.findOne).not.toHaveBeenCalled();
  });

  it('bloquea crear opciones cuando el evento ya fue publicado', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    accessService.canFullyEditEvent.mockReturnValue(false);

    await expect(
      service.createOption(
        String(event._id),
        { name: 'Lista Azul', color: '#2563EB', candidates: [] },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(votingOptionModel.create).not.toHaveBeenCalled();
  });

  it('crea opciones con multiples colores y deriva color principal', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    votingOptionModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      eventId: event._id,
      tenantId: event.tenantId,
      name: 'Lista Azul',
      color: '#2563EB',
      colors: ['#2563EB', '#FFFFFF'],
      candidates: [],
      active: true,
      toObject() {
        return this;
      },
    });

    const created = await service.createOption(
      String(event._id),
      { name: 'Lista Azul', colors: ['#2563eb', '#ffffff'], candidates: [] },
      { sub: 'admin-1' },
    );

    expect(created.color).toBe('#2563EB');
    expect(created.colors).toEqual(['#2563EB', '#FFFFFF']);
    expect(votingOptionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        color: '#2563EB',
        colors: ['#2563EB', '#FFFFFF'],
      }),
    );
  });

  it('actualiza opciones con colors[] manteniendo compatibilidad de respuesta', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
    };
    const option = {
      _id: new Types.ObjectId(),
      eventId: event._id,
      tenantId: event.tenantId,
      name: 'Lista Verde',
      normalizedName: 'lista verde',
      color: '#00AA00',
      colors: ['#00AA00'],
      logoUrl: null,
      candidates: [],
      active: true,
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return this;
      },
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    votingOptionModel.findOne.mockResolvedValue(option);

    const updated = await service.updateOption(
      String(event._id),
      String(option._id),
      { colors: ['#00ff00', '#ffffff'] },
      { sub: 'admin-1' },
    );

    expect(option.color).toBe('#00FF00');
    expect(option.colors).toEqual(['#00FF00', '#FFFFFF']);
    expect(updated.color).toBe('#00FF00');
    expect(updated.colors).toEqual(['#00FF00', '#FFFFFF']);
  });

  it('normaliza lectura legacy de opciones con color unico', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    votingOptionModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          eventId: event._id,
          tenantId: event.tenantId,
          name: 'Lista Legacy',
          color: '#f97316',
          candidates: [],
          active: true,
        },
      ]),
    });

    const listed = await service.listOptions(String(event._id), { sub: 'admin-1' });

    expect(listed.data[0].color).toBe('#F97316');
    expect(listed.data[0].colors).toEqual(['#F97316']);
  });

  it('rechaza colores invalidos al crear opciones', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
    };
    accessService.getEventOrThrow.mockResolvedValue(event);

    await expect(
      service.createOption(
        String(event._id),
        { name: 'Lista Invalida', colors: ['azul'], candidates: [] },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(votingOptionModel.create).not.toHaveBeenCalled();
  });

  it('bloquea desactivar una opción cuando el evento ya fue publicado', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    accessService.canFullyEditEvent.mockReturnValue(false);

    await expect(
      service.deactivateOption(
        String(event._id),
        String(new Types.ObjectId()),
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(votingOptionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('bloquea editar el cronograma cuando el evento ya fue publicado', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
      save: jest.fn(),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    accessService.canFullyEditEvent.mockReturnValue(false);

    await expect(
      service.updateSchedule(
        String(event._id),
        {
          votingStart: new Date().toISOString(),
          votingEnd: new Date(Date.now() + 60_000).toISOString(),
          resultsPublishAt: new Date(Date.now() + 120_000).toISOString(),
        },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(accessService.parseAndValidateDates).not.toHaveBeenCalled();
    expect(event.save).not.toHaveBeenCalled();
  });

  it('notifica actualización de cronograma si la revisión previa ya fue notificada', async () => {
    const event: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'READY_FOR_REVIEW',
      convocationNotifiedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const parsedDates = {
      votingStart: new Date('2026-07-10T12:00:00.000Z'),
      votingEnd: new Date('2026-07-10T18:00:00.000Z'),
      resultsPublishAt: new Date('2026-07-10T20:00:00.000Z'),
    };
    const publishDeadline = new Date('2026-07-09T12:00:00.000Z');

    accessService.getEventOrThrow.mockResolvedValue(event);
    accessService.parseAndValidateDates.mockReturnValue(parsedDates);
    accessService.computePublishDeadline.mockReturnValue(publishDeadline);
    notificationsService.notifyScheduleUpdatedToCurrentPadron.mockResolvedValue({ sent: 2 });

    const result = await service.updateSchedule(
      String(event._id),
      {
        votingStart: parsedDates.votingStart.toISOString(),
        votingEnd: parsedDates.votingEnd.toISOString(),
        resultsPublishAt: parsedDates.resultsPublishAt.toISOString(),
      },
      { sub: 'admin-1' },
    );

    expect(event.publishDeadline).toBe(publishDeadline);
    expect(event.officialPublicationReminderSentAt).toBeUndefined();
    expect(event.save).toHaveBeenCalled();
    expect(notificationsService.notifyScheduleUpdatedToCurrentPadron).toHaveBeenCalledWith(
      event,
    );
    expect(result.publishDeadline).toBe(publishDeadline);
  });

  it('publica noticias manuales usando solo imageUrl y link del JSON', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      name: 'Eleccion con noticias',
    };
    const dto = {
      title: 'Convocatoria oficial',
      body: 'Mensaje para empadronados',
      imageUrl: 'https://cdn.example.com/news.png',
      link: 'https://example.com/noticia',
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    notificationsService.notifyNewsToCurrentPadron.mockResolvedValue({
      sent: 3,
      skipped: null,
    });

    const result = await service.publishNews(String(event._id), dto, { sub: 'admin-1' });

    expect(notificationsService.notifyNewsToCurrentPadron).toHaveBeenCalledWith(
      event,
      dto,
    );
    expect(result).toEqual({
      eventId: String(event._id),
      sent: 3,
      skipped: null,
    });
  });

  it('resuelve elegibilidad pública transversal entre eventos visibles', async () => {
    const tenantId = new Types.ObjectId();
    const eventEligibleId = new Types.ObjectId();
    const eventDisabledId = new Types.ObjectId();
    const eventPendingId = new Types.ObjectId();
    const eligibleVersionId = new Types.ObjectId();
    const disabledVersionId = new Types.ObjectId();
    const pendingVersionId = new Types.ObjectId();

    votingEventModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: eventPendingId,
          tenantId,
          name: 'Beta',
          state: 'PUBLISHED',
          publicEligibilityEnabled: true,
          votingStart: new Date(Date.now() + 60_000),
          votingEnd: new Date(Date.now() + 120_000),
          resultsPublishAt: new Date(Date.now() + 180_000),
        },
        {
          _id: eventEligibleId,
          tenantId,
          name: 'Alfa',
          state: 'PUBLISHED',
          publicEligibilityEnabled: true,
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 120_000),
          resultsPublishAt: new Date(Date.now() + 180_000),
        },
        {
          _id: eventDisabledId,
          tenantId,
          name: 'Gamma',
          state: 'RESULTS_PUBLISHED',
          publicEligibilityEnabled: true,
          votingStart: new Date(Date.now() - 180_000),
          votingEnd: new Date(Date.now() - 120_000),
          resultsPublishAt: new Date(Date.now() - 60_000),
        },
      ]),
    });
    padronVersionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: eligibleVersionId, eventId: eventEligibleId },
        { _id: disabledVersionId, eventId: eventDisabledId },
        { _id: pendingVersionId, eventId: eventPendingId },
      ]),
    });
    comparisonReportModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { padronVersionId: eligibleVersionId },
        { padronVersionId: disabledVersionId },
      ]),
    });
    padronEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { padronVersionId: eligibleVersionId, enabled: true },
        { padronVersionId: disabledVersionId, enabled: false },
      ]),
    });

    const result = await service.checkPublicEligibilityAcrossEvents('abc-789');

    expect(result.carnet).toBe('ABC789');
    expect(result.events).toEqual([
      expect.objectContaining({
        eventId: String(eventEligibleId),
        name: 'Alfa',
        status: 'ELIGIBLE',
        eligible: true,
      }),
      expect.objectContaining({
        eventId: String(eventPendingId),
        name: 'Beta',
        status: 'ROLL_IN_VALIDATION',
        eligible: false,
      }),
      expect.objectContaining({
        eventId: String(eventDisabledId),
        name: 'Gamma',
        status: 'DISABLED',
        eligible: false,
      }),
    ]);
  });

  it('devuelve consulta pública transversal vacía cuando no hay eventos visibles', async () => {
    votingEventModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const result = await service.checkPublicEligibilityAcrossEvents('123.456');

    expect(result).toEqual({
      carnet: '123456',
      events: [],
    });
  });

  it('no incluye eventos CANCELLED en la consulta del landing público', async () => {
    votingEventModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    const result = await service.getPublicLanding(undefined, 10);

    const [query] = votingEventModel.find.mock.calls[0];
    expect(JSON.stringify(query)).not.toContain('CANCELLED');
    expect(result.totals).toEqual({
      upcoming: 0,
      active: 0,
      results: 0,
    });
  });

  it('filtra el landing público por carnet empadronado y habilitado', async () => {
    const tenantId = new Types.ObjectId();
    const eligibleEventId = new Types.ObjectId();
    const hiddenEventId = new Types.ObjectId();
    const eligibleVersionId = new Types.ObjectId();
    const hiddenVersionId = new Types.ObjectId();

    votingEventModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: hiddenEventId,
            tenantId,
            name: 'Oculto',
            objective: 'No empadronado',
            state: 'PUBLISHED',
            publicEligibilityEnabled: true,
            votingStart: new Date(Date.now() - 60_000),
            votingEnd: new Date(Date.now() + 60_000),
            resultsPublishAt: new Date(Date.now() + 120_000),
          },
          {
            _id: eligibleEventId,
            tenantId,
            name: 'Visible',
            objective: 'Empadronado',
            state: 'PUBLISHED',
            publicEligibilityEnabled: true,
            votingStart: new Date(Date.now() - 60_000),
            votingEnd: new Date(Date.now() + 60_000),
            resultsPublishAt: new Date(Date.now() + 120_000),
          },
        ]),
      }),
    });
    padronVersionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: eligibleVersionId, eventId: eligibleEventId },
        { _id: hiddenVersionId, eventId: hiddenEventId },
      ]),
    });
    comparisonReportModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { padronVersionId: eligibleVersionId },
        { padronVersionId: hiddenVersionId },
      ]),
    });
    padronEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ padronVersionId: eligibleVersionId }]),
    });

    const result = await service.getPublicLanding(undefined, 10, 'abc-123');

    expect(result.active).toHaveLength(1);
    expect(result.active[0]).toEqual(
      expect.objectContaining({
        id: String(eligibleEventId),
        name: 'Visible',
      }),
    );
    expect(result.totals).toEqual({
      upcoming: 0,
      active: 1,
      results: 0,
    });
    expect(padronEntryModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        carnetNorm: 'ABC123',
        padronVersionId: { $in: [eligibleVersionId, hiddenVersionId] },
      }),
      { padronVersionId: 1 },
    );
  });

  it('rechaza tenant inválido en consulta pública transversal', async () => {
    await expect(
      service.checkPublicEligibilityAcrossEvents('123456', 'tenant-invalido'),
    ).rejects.toThrow(BadRequestException);
  });

  it('devuelve consulta pública deshabilitada para eventos que no exponen padrón', async () => {
    const tenantId = new Types.ObjectId();
    const eventId = new Types.ObjectId();

    votingEventModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: eventId,
          tenantId,
          name: 'Evento Privado',
          state: 'PUBLISHED',
          publicEligibilityEnabled: false,
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60_000),
          resultsPublishAt: new Date(Date.now() + 120_000),
        },
      ]),
    });
    padronVersionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const result = await service.checkPublicEligibilityAcrossEvents('123456');

    expect(result.events).toEqual([
      expect.objectContaining({
        eventId: String(eventId),
        status: 'PUBLIC_CHECK_DISABLED',
        eligible: false,
      }),
    ]);
  });
});
