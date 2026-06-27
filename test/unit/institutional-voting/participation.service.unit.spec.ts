import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ParticipationService } from '@/modules/institutional-voting/services/participation/participation.service';
import { PadronVersion } from '@/modules/institutional-voting/schemas/padron-version.schema';
import { PadronEntry } from '@/modules/institutional-voting/schemas/padron-entry.schema';
import { ComparisonReport } from '@/modules/institutional-voting/schemas/comparison-report.schema';
import { Participation } from '@/modules/institutional-voting/schemas/participation.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';

describe('ParticipationService (unit)', () => {
  let service: ParticipationService;

  let padronVersionModel: {
    findOne: jest.Mock;
  };
  let padronEntryModel: {
    findOne: jest.Mock;
  };
  let comparisonReportModel: {
    exists: jest.Mock;
  };
  let participationModel: {
    findOne: jest.Mock;
    create: jest.Mock;
  };
  let accessService: {
    getEventOrThrow: jest.Mock;
  };

  const activeEvent = () => ({
    _id: new Types.ObjectId(),
    state: 'PUBLISHED',
    votingStart: new Date(Date.now() - 60_000),
    votingEnd: new Date(Date.now() + 60_000),
  });

  beforeEach(async () => {
    padronVersionModel = {
      findOne: jest.fn(),
    };
    padronEntryModel = {
      findOne: jest.fn(),
    };
    comparisonReportModel = {
      exists: jest.fn(),
    };
    participationModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };
    accessService = {
      getEventOrThrow: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ParticipationService,
        { provide: getModelToken(PadronVersion.name), useValue: padronVersionModel },
        { provide: getModelToken(PadronEntry.name), useValue: padronEntryModel },
        {
          provide: getModelToken(ComparisonReport.name),
          useValue: comparisonReportModel,
        },
        { provide: getModelToken(Participation.name), useValue: participationModel },
        { provide: InstitutionalVotingAccessService, useValue: accessService },
      ],
    }).compile();

    service = moduleRef.get(ParticipationService);
  });

  it('devuelve respuesta idempotente cuando ya existe una participación con la misma clave', async () => {
    const event = activeEvent();
    const existing = {
      _id: new Types.ObjectId(),
      participatedAt: new Date('2026-01-01T12:00:00.000Z'),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    participationModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(existing),
    });

    const result = await service.createParticipation(
      String(event._id),
      { carnet: '123.456' },
      'idem-001',
    );

    expect(result).toEqual({
      statusCode: 200,
      body: {
        id: String(existing._id),
        participated: true,
        participatedAt: existing.participatedAt,
      },
    });
  });

  it('registra participación cuando el votante está habilitado y dentro de ventana', async () => {
    const event = activeEvent();
    const created = {
      _id: new Types.ObjectId(),
      participatedAt: new Date('2026-01-01T12:00:00.000Z'),
    };

    jest
      .spyOn(service as any, 'resolveParticipationStatus')
      .mockResolvedValue({ status: 'CAN_VOTE', canVote: true, alreadyVoted: false });
    accessService.getEventOrThrow.mockResolvedValue(event);
    participationModel.create.mockResolvedValue(created);

    const result = await service.createParticipation(String(event._id), {
      carnet: 'abc-789',
    });

    expect(participationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: event._id,
        carnetNorm: 'ABC789',
      }),
    );
    expect(result).toEqual({
      statusCode: 201,
      body: {
        id: String(created._id),
        participated: true,
        participatedAt: created.participatedAt,
      },
    });
  });

  it('rechaza un segundo intento real de participación', async () => {
    const event = activeEvent();
    jest
      .spyOn(service as any, 'resolveParticipationStatus')
      .mockResolvedValue({
        status: 'ALREADY_VOTED',
        canVote: false,
        alreadyVoted: true,
      });
    accessService.getEventOrThrow.mockResolvedValue(event);

    await expect(
      service.createParticipation(String(event._id), { carnet: '123456' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rechaza participar cuando el estado operativo no permite votar', async () => {
    const event = activeEvent();
    jest
      .spyOn(service as any, 'resolveParticipationStatus')
      .mockResolvedValue({
        status: 'ROLL_IN_VALIDATION',
        canVote: false,
        alreadyVoted: false,
      });
    accessService.getEventOrThrow.mockResolvedValue(event);

    await expect(
      service.createParticipation(String(event._id), { carnet: '123456' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rechaza carnet inválido al consultar estado de participación', async () => {
    await expect(service.checkParticipationStatus('evt-1', '')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('consulta participación pública con respuesta mínima cuando el CI ya votó', async () => {
    const event = {
      _id: new Types.ObjectId(),
      state: 'RESULTS_PUBLISHED',
      votingStart: new Date('2026-01-01T10:00:00.000Z'),
      votingEnd: new Date('2026-01-01T12:00:00.000Z'),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    participationModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });

    const result = await service.checkPublicParticipation(String(event._id), '123.456');

    expect(participationModel.findOne).toHaveBeenCalledWith(
      { eventId: event._id, carnetNorm: '123456' },
      { _id: 1 },
    );
    expect(result).toEqual({
      eventId: String(event._id),
      participated: true,
    });
    expect(result).not.toHaveProperty('carnet');
    expect(result).not.toHaveProperty('normalizedCarnet');
    expect(result).not.toHaveProperty('eligible');
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('participatedAt');
    expect(result).not.toHaveProperty('vote');
    expect(result).not.toHaveProperty('option');
    expect(result).not.toHaveProperty('candidate');
    expect(result).not.toHaveProperty('ballot');
    expect(result).not.toHaveProperty('proof');
    expect(result).not.toHaveProperty('hash');
  });

  it('consulta participación pública como false sin depender de ventana ni habilitación', async () => {
    const event = {
      _id: new Types.ObjectId(),
      state: 'CLOSED',
      votingStart: new Date('2026-01-01T10:00:00.000Z'),
      votingEnd: new Date('2026-01-01T12:00:00.000Z'),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    participationModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const result = await service.checkPublicParticipation(String(event._id), 'ABC-789');

    expect(padronVersionModel.findOne).not.toHaveBeenCalled();
    expect(padronEntryModel.findOne).not.toHaveBeenCalled();
    expect(comparisonReportModel.exists).not.toHaveBeenCalled();
    expect(participationModel.findOne).toHaveBeenCalledWith(
      { eventId: event._id, carnetNorm: 'ABC789' },
      { _id: 1 },
    );
    expect(result).toEqual({
      eventId: String(event._id),
      participated: false,
    });
  });

  it('rechaza carnet inválido al consultar participación pública', async () => {
    await expect(service.checkPublicParticipation('evt-1', '')).rejects.toThrow(
      BadRequestException,
    );
    expect(accessService.getEventOrThrow).not.toHaveBeenCalled();
  });

  it('informa que no se puede votar cuando el evento no está publicado', async () => {
    accessService.getEventOrThrow.mockResolvedValue({
      _id: new Types.ObjectId(),
      state: 'DRAFT',
    });

    const result = await service.checkParticipationStatus('evt-1', '123456');

    expect(result).toEqual({
      status: 'EVENT_NOT_PUBLISHED',
      canVote: false,
      alreadyVoted: false,
    });
  });

  it('informa bloqueo cuando la votación está fuera de la ventana permitida', async () => {
    accessService.getEventOrThrow.mockResolvedValue({
      _id: new Types.ObjectId(),
      state: 'PUBLISHED',
      votingStart: new Date(Date.now() + 60_000),
      votingEnd: new Date(Date.now() + 120_000),
    });

    const result = await service.checkParticipationStatus('evt-1', '123456');

    expect(result).toEqual({
      status: 'OUTSIDE_VOTING_WINDOW',
      canVote: false,
      alreadyVoted: false,
    });
  });

  it('informa bloqueo cuando el padrón aún no está aprobado operativamente', async () => {
    const event = activeEvent();
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });
    comparisonReportModel.exists.mockResolvedValue(false);

    const result = await service.checkParticipationStatus(
      String(event._id),
      '123456',
    );

    expect(result).toEqual({
      status: 'ROLL_IN_VALIDATION',
      canVote: false,
      alreadyVoted: false,
    });
  });

  it('informa bloqueo cuando el votante no pertenece al padrón vigente', async () => {
    const event = activeEvent();
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    padronEntryModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const result = await service.checkParticipationStatus(
      String(event._id),
      '123456',
    );

    expect(result).toEqual({
      status: 'NOT_IN_ROLL',
      canVote: false,
      alreadyVoted: false,
    });
  });

  it('informa bloqueo cuando el votante está deshabilitado', async () => {
    const event = activeEvent();
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    padronEntryModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ enabled: false }),
    });

    const result = await service.checkParticipationStatus(
      String(event._id),
      '123456',
    );

    expect(result).toEqual({
      status: 'VOTER_DISABLED',
      canVote: false,
      alreadyVoted: false,
    });
  });

  it('informa cuando el votante ya participó', async () => {
    const event = activeEvent();
    const existing = {
      participatedAt: new Date('2026-01-01T15:00:00.000Z'),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    padronEntryModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ enabled: true }),
    });
    participationModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(existing),
    });

    const result = await service.checkParticipationStatus(
      String(event._id),
      '123456',
    );

    expect(result).toEqual({
      status: 'ALREADY_VOTED',
      canVote: false,
      alreadyVoted: true,
      participatedAt: existing.participatedAt,
    });
  });

  it('informa que el votante puede votar cuando cumple todas las restricciones', async () => {
    const event = activeEvent();
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });
    comparisonReportModel.exists.mockResolvedValue(true);
    padronEntryModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ enabled: true }),
    });
    participationModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const result = await service.checkParticipationStatus(
      String(event._id),
      '123456',
    );

    expect(result).toEqual({
      status: 'CAN_VOTE',
      canVote: true,
      alreadyVoted: false,
    });
  });
});
