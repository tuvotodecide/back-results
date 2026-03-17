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
import { ComparisonReport } from '@/modules/institutional-voting/schemas/comparison-report.schema';
import { Participation } from '@/modules/institutional-voting/schemas/participation.schema';
import { EventResultsSnapshot } from '@/modules/institutional-voting/schemas/event-results-snapshot.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { PadronUsersService } from '@/modules/institutional-voting/services/core/padron-users.service';
import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';

describe('VotingEventsService (unit)', () => {
  let service: VotingEventsService;

  let votingEventModel: any;
  let eventRoleModel: any;
  let votingOptionModel: any;
  let padronVersionModel: any;
  let padronEntryModel: any;
  let comparisonReportModel: any;
  let participationModel: any;
  let resultsSnapshotModel: any;
  let accessService: any;
  let notificationsService: any;
  let padronUsersService: any;
  let issuerService: any;

  beforeEach(async () => {
    votingEventModel = {
      create: jest.fn(),
      find: jest.fn(),
      deleteOne: jest.fn(),
    };
    eventRoleModel = {
      countDocuments: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      deleteMany: jest.fn(),
      deleteOne: jest.fn(),
    };
    votingOptionModel = {
      countDocuments: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
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
    comparisonReportModel = {
      exists: jest.fn(),
      find: jest.fn(),
      deleteMany: jest.fn(),
    };
    participationModel = {
      deleteMany: jest.fn(),
    };
    resultsSnapshotModel = {
      deleteMany: jest.fn(),
    };
    accessService = {
      getEventOrThrow: jest.fn(),
      getTenantOrThrow: jest.fn(),
      assertTenantWriteAccess: jest.fn(),
      parseAndValidateDates: jest.fn(),
      normalizeName: jest.fn((value: string) => value.trim().toLowerCase()),
    };
    notificationsService = {
      notifyConvocationIfEligible: jest.fn(),
    };
    padronUsersService = {
      getPadronUsersFromEvent: jest.fn(),
    };
    issuerService = {
      issueCredential: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VotingEventsService,
        { provide: getModelToken(VotingEvent.name), useValue: votingEventModel },
        { provide: getModelToken(EventRole.name), useValue: eventRoleModel },
        { provide: getModelToken(VotingOption.name), useValue: votingOptionModel },
        { provide: getModelToken(PadronVersion.name), useValue: padronVersionModel },
        { provide: getModelToken(PadronEntry.name), useValue: padronEntryModel },
        {
          provide: getModelToken(ComparisonReport.name),
          useValue: comparisonReportModel,
        },
        { provide: getModelToken(Participation.name), useValue: participationModel },
        {
          provide: getModelToken(EventResultsSnapshot.name),
          useValue: resultsSnapshotModel,
        },
        { provide: InstitutionalVotingAccessService, useValue: accessService },
        {
          provide: InstitutionalVotingNotificationsService,
          useValue: notificationsService,
        },
        { provide: PadronUsersService, useValue: padronUsersService },
        { provide: IssuerService, useValue: issuerService },
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
  });

  it('rechaza publicar si faltan precondiciones críticas', async () => {
    const findOneLean = jest.fn().mockResolvedValue(null);
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      save: jest.fn(),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.countDocuments.mockResolvedValue(0);
    votingOptionModel.countDocuments.mockResolvedValue(0);
    padronVersionModel.findOne.mockReturnValue({ lean: findOneLean });

    await expect(
      service.publishEvent(String(event._id), { sub: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);

    try {
      await service.publishEvent(String(event._id), { sub: 'admin-1' });
    } catch (error: any) {
      expect(error.getResponse()).toEqual({
        message: 'Faltan precondiciones para publicar',
        pending: ['cargos', 'opciones', 'padron', 'horarios'],
      });
    }
  });

  it('publica el evento sin reenviar convocatoria si ya fue notificada', async () => {
    const currentPadron = {
      _id: new Types.ObjectId(),
      totals: { invalidCount: 0 },
    };
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      convocationNotifiedAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.countDocuments.mockResolvedValue(1);
    votingOptionModel.countDocuments.mockResolvedValue(1);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentPadron),
    });
    comparisonReportModel.exists.mockResolvedValue(true);

    const result = await service.publishEvent(String(event._id), { sub: 'admin-1' });

    expect(event.save).toHaveBeenCalled();
    expect(notificationsService.notifyConvocationIfEligible).not.toHaveBeenCalled();
    expect(issuerService.issueCredential).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: String(event._id),
      state: 'PUBLISHED',
    });
  });

  it('publica y emite credenciales/notificación cuando hay usuarios elegibles', async () => {
    const currentPadron = {
      _id: new Types.ObjectId(),
      totals: { invalidCount: 0 },
    };
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      name: 'Eleccion 2026',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const convokedUsers = [{ dni: '123456' }, { dni: 'ABC789' }];
    const issued = {
      '123456': { credentialData: 'cred-1' },
      ABC789: { credentialData: 'cred-2' },
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.countDocuments.mockResolvedValue(1);
    votingOptionModel.countDocuments.mockResolvedValue(1);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentPadron),
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    padronUsersService.getPadronUsersFromEvent.mockResolvedValue(convokedUsers);
    issuerService.issueCredential.mockResolvedValue(issued);
    notificationsService.notifyConvocationIfEligible.mockResolvedValue({ sent: 2 });

    const result = await service.publishEvent(String(event._id), { sub: 'admin-1' });

    expect(padronUsersService.getPadronUsersFromEvent).toHaveBeenCalledWith(event);
    expect(issuerService.issueCredential).toHaveBeenCalledWith(
      ['123456', 'ABC789'],
      event,
    );
    expect(notificationsService.notifyConvocationIfEligible).toHaveBeenCalledWith(
      event,
      issued,
    );
    expect(result.state).toBe('PUBLISHED');
  });

  it('publica sin emitir credenciales si no hay usuarios vinculados al padrón', async () => {
    const currentPadron = {
      _id: new Types.ObjectId(),
      totals: { invalidCount: 0 },
    };
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'DRAFT',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined),
    };

    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.countDocuments.mockResolvedValue(1);
    votingOptionModel.countDocuments.mockResolvedValue(1);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentPadron),
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    padronUsersService.getPadronUsersFromEvent.mockResolvedValue([]);

    const result = await service.publishEvent(String(event._id), { sub: 'admin-1' });

    expect(issuerService.issueCredential).not.toHaveBeenCalled();
    expect(notificationsService.notifyConvocationIfEligible).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: String(event._id),
      state: 'PUBLISHED',
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
      state: 'DRAFT',
    });
  });

  it('bloquea actualizar roles cuando el evento ya no está en borrador', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
    };
    accessService.getEventOrThrow.mockResolvedValue(event);

    await expect(
      service.updateRole(
        String(event._id),
        String(new Types.ObjectId()),
        { name: 'Secretario' },
        { sub: 'admin-1' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('permite crear cargos aun con el evento publicado', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
    };
    const createdRole = {
      _id: new Types.ObjectId(),
      eventId: event._id,
      name: 'Secretario',
      maxWinners: 1,
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    eventRoleModel.create.mockResolvedValue(createdRole);

    const result = await service.createRole(
      String(event._id),
      { name: 'Secretario', maxWinners: 1 },
      { sub: 'admin-1' },
    );

    expect(eventRoleModel.create).toHaveBeenCalledWith({
      eventId: event._id,
      name: 'Secretario',
      normalizedName: 'secretario',
      maxWinners: 1,
    });
    expect(result).toEqual({
      id: String(createdRole._id),
      eventId: String(createdRole.eventId),
      name: createdRole.name,
      maxWinners: createdRole.maxWinners,
    });
  });

  it('permite desactivar una opción aun con el evento publicado', async () => {
    const event = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      state: 'PUBLISHED',
    };
    const optionId = new Types.ObjectId();
    accessService.getEventOrThrow.mockResolvedValue(event);
    votingOptionModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: optionId,
        active: false,
      }),
    });

    const result = await service.deactivateOption(
      String(event._id),
      String(optionId),
      { sub: 'admin-1' },
    );

    expect(result).toEqual({
      id: String(optionId),
      active: false,
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
