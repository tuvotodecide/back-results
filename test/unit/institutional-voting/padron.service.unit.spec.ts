import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { PadronService } from '@/modules/institutional-voting/services/padron/padron.service';
import { PadronVersion } from '@/modules/institutional-voting/schemas/padron-version.schema';
import { PadronEntry } from '@/modules/institutional-voting/schemas/padron-entry.schema';
import { ComparisonReport } from '@/modules/institutional-voting/schemas/comparison-report.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';

describe('PadronService (unit)', () => {
  let service: PadronService;

  let padronVersionModel: {
    updateMany: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let padronEntryModel: {
    insertMany: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let comparisonReportModel: {
    create: jest.Mock;
    exists: jest.Mock;
    updateOne: jest.Mock;
  };
  let accessService: {
    getEventOrThrow: jest.Mock;
    assertTenantWriteAccess: jest.Mock;
    assertGlobalAdminAccess: jest.Mock;
  };

  const event = {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    publicEligibilityEnabled: true,
  };

  beforeEach(async () => {
    padronVersionModel = {
      updateMany: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    padronEntryModel = {
      insertMany: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    comparisonReportModel = {
      create: jest.fn(),
      exists: jest.fn(),
      updateOne: jest.fn(),
    };
    accessService = {
      getEventOrThrow: jest.fn(),
      assertTenantWriteAccess: jest.fn(),
      assertGlobalAdminAccess: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PadronService,
        { provide: getModelToken(PadronVersion.name), useValue: padronVersionModel },
        { provide: getModelToken(PadronEntry.name), useValue: padronEntryModel },
        {
          provide: getModelToken(ComparisonReport.name),
          useValue: comparisonReportModel,
        },
        { provide: InstitutionalVotingAccessService, useValue: accessService },
      ],
    }).compile();

    service = moduleRef.get(PadronService);
  });

  it('importa padrón, genera versión vigente y crea validación pendiente', async () => {
    const csv = ['carnet,habilitado', '123456,si', '123.456,si', '999999,no', '---,si'].join(
      '\n',
    );
    const requester = { sub: String(new Types.ObjectId()) };
    const versionId = new Types.ObjectId();
    const expectedDigest = createHash('sha256').update(csv).digest('hex');

    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.create.mockResolvedValue({
      _id: versionId,
      fileDigest: expectedDigest,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      createdBy: new Types.ObjectId(requester.sub),
      tenantId: event.tenantId,
      totals: {
        validCount: 2,
        duplicateCount: 1,
        invalidCount: 1,
      },
      isCurrent: true,
    });

    const result = await service.importPadron(String(event._id), csv, requester);

    expect(accessService.assertTenantWriteAccess).toHaveBeenCalledWith(
      event.tenantId,
      requester,
    );
    expect(padronVersionModel.updateMany).toHaveBeenCalledWith(
      { eventId: event._id, isCurrent: true },
      { $set: { isCurrent: false } },
    );
    expect(padronEntryModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          padronVersionId: versionId,
          eventId: event._id,
          carnetNorm: '123456',
          enabled: true,
        }),
        expect.objectContaining({
          padronVersionId: versionId,
          eventId: event._id,
          carnetNorm: '999999',
          enabled: false,
        }),
      ],
      { ordered: false },
    );
    expect(comparisonReportModel.create).toHaveBeenCalledWith({
      eventId: event._id,
      padronVersionId: versionId,
      status: 'PENDING',
    });
    expect(result.fileDigest).toBe(expectedDigest);
    expect(result.totals).toEqual({
      validCount: 2,
      duplicateCount: 1,
      invalidCount: 1,
    });
  });

  it('rechaza importar padrón sin usuario identificado', async () => {
    accessService.getEventOrThrow.mockResolvedValue(event);

    await expect(
      service.importPadron(String(event._id), 'carnet\n123456\n', {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('indica no habilitado cuando no existe padrón vigente', async () => {
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const result = await service.checkEligibility(String(event._id), '123.456');

    expect(result).toEqual({
      status: 'NOT_ELIGIBLE',
      normalizedCarnet: '123456',
      referenceVersion: null,
    });
  });

  it('bloquea la consulta pública cuando el evento no la habilita', async () => {
    accessService.getEventOrThrow.mockResolvedValue({
      ...event,
      publicEligibilityEnabled: false,
    });

    const result = await service.checkPublicEligibility(String(event._id), '123456');

    expect(result).toEqual({
      status: 'PUBLIC_CHECK_DISABLED',
      referenceVersion: null,
    });
  });

  it('informa padrón en validación cuando no existe versión vigente pública', async () => {
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const result = await service.checkPublicEligibility(String(event._id), '123456');

    expect(result).toEqual({
      status: 'ROLL_IN_VALIDATION',
      referenceVersion: null,
    });
  });

  it('informa padrón en validación cuando la validación operativa no está aprobada', async () => {
    const currentVersion = { _id: new Types.ObjectId() };
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentVersion),
    });
    comparisonReportModel.exists.mockResolvedValue(false);

    const result = await service.checkPublicEligibility(String(event._id), '123456');

    expect(result).toEqual({
      status: 'ROLL_IN_VALIDATION',
      referenceVersion: String(currentVersion._id),
    });
  });

  it('responde habilitado, inhabilitado o no habilitado según el padrón vigente', async () => {
    const currentVersion = { _id: new Types.ObjectId() };
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(currentVersion),
    });
    comparisonReportModel.exists.mockResolvedValue(true);

    padronEntryModel.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ enabled: true }),
    });
    const eligible = await service.checkPublicEligibility(String(event._id), '123456');

    padronEntryModel.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ enabled: false }),
    });
    const disabled = await service.checkPublicEligibility(String(event._id), '123456');

    padronEntryModel.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue(null),
    });
    const notEligible = await service.checkPublicEligibility(
      String(event._id),
      '123456',
    );

    expect(eligible).toEqual({
      status: 'ELIGIBLE',
      referenceVersion: String(currentVersion._id),
    });
    expect(disabled).toEqual({
      status: 'DISABLED',
      referenceVersion: String(currentVersion._id),
    });
    expect(notEligible).toEqual({
      status: 'NOT_ELIGIBLE',
      referenceVersion: String(currentVersion._id),
    });
  });

  it('actualiza el estado de aprobación de una versión específica del padrón', async () => {
    const requester = { sub: String(new Types.ObjectId()), role: 'ADMIN' };
    const version = {
      _id: new Types.ObjectId(),
    };
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockResolvedValue(version);

    const result = await service.updateComparisonReportStatus(
      String(event._id),
      'OK',
      requester,
      String(version._id),
    );

    expect(accessService.assertGlobalAdminAccess).toHaveBeenCalledWith(
      requester,
      'aprobar o rechazar el padrón',
    );
    expect(comparisonReportModel.updateOne).toHaveBeenCalledWith(
      { padronVersionId: version._id },
      { $set: { status: 'OK' } },
      { upsert: true },
    );
    expect(result).toEqual({
      eventId: String(event._id),
      padronVersionId: String(version._id),
      status: 'OK',
    });
  });

  it('rechaza consultar una versión inexistente del padrón', async () => {
    const requester = { sub: String(new Types.ObjectId()), role: 'ADMIN' };
    accessService.getEventOrThrow.mockResolvedValue(event);
    padronVersionModel.findOne.mockResolvedValue(null);

    await expect(
      service.updateComparisonReportStatus(
        String(event._id),
        'FAILED',
        requester,
        String(new Types.ObjectId()),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza cambiar el comparison report si el solicitante no es administrador global', async () => {
    const requester = { sub: String(new Types.ObjectId()), role: 'GOVERNOR' };
    accessService.assertGlobalAdminAccess.mockImplementation(() => {
      throw new ForbiddenException('Solo un administrador global puede aprobar o rechazar el padrón');
    });

    await expect(
      service.updateComparisonReportStatus(
        String(event._id),
        'OK',
        requester,
        String(new Types.ObjectId()),
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(accessService.getEventOrThrow).not.toHaveBeenCalled();
  });

  it('rechaza carnet inválido al consultar elegibilidad', async () => {
    accessService.getEventOrThrow.mockResolvedValue(event);

    await expect(service.checkEligibility(String(event._id), '')).rejects.toThrow(
      BadRequestException,
    );
  });
});
