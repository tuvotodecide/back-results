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
import { PresentialSession } from '@/modules/institutional-voting/schemas/presential-session.schema';
import { EventResultsSnapshot } from '@/modules/institutional-voting/schemas/event-results-snapshot.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { VoteReaderService } from '@/modules/institutional-voting/services/core/vote-reader.service';

describe('VotingEventsService (unit)', () => {
  let service: VotingEventsService;

  let votingEventModel: any;
  let eventRoleModel: any;
  let votingOptionModel: any;
  let padronVersionModel: any;
  let padronEntryModel: any;
  let comparisonReportModel: any;
  let participationModel: any;
  let presentialSessionModel: any;
  let resultsSnapshotModel: any;
  let accessService: any;
  let notificationsService: any;
  let voteReaderService: any;

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
      parseAndValidateDates: jest.fn(),
      computePublishDeadline: jest.fn((votingStart: Date) => new Date(votingStart.getTime() - 24 * 60 * 60 * 1000)),
      canFullyEditEvent: jest.fn(() => true),
      canModifyPadronDuringVoting: jest.fn(() => false),
      hasPublicationWindowExpired: jest.fn(() => false),
      normalizeName: jest.fn((value: string) => value.trim().toLowerCase()),
    };
    notificationsService = {
      notifyConvocationIfEligible: jest.fn(),
      notifyOfficialPublicationConfirmed: jest.fn(),
      notifyNewsToCurrentPadron: jest.fn(),
      notifyScheduleUpdatedToCurrentPadron: jest.fn(),
    };
    voteReaderService = {
      getResults: jest.fn(),
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
    comparisonReportModel.exists.mockResolvedValue(true);
    notificationsService.notifyOfficialPublicationConfirmed.mockResolvedValue({ sent: 2 });

    const result = await service.publishEvent(String(event._id), { sub: 'admin-1' });

    expect(event.save).toHaveBeenCalled();
    expect(notificationsService.notifyConvocationIfEligible).not.toHaveBeenCalled();
    expect(notificationsService.notifyOfficialPublicationConfirmed).toHaveBeenCalledWith(event);
    expect(result.state).toBe('OFFICIALLY_PUBLISHED');
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
      state: 'READY_FOR_REVIEW',
      presentialKioskEnabled: false,
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
      state: 'DRAFT',
      presentialKioskEnabled: false,
    });
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
