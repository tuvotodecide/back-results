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
import { PadronImportJob } from '@/modules/institutional-voting/schemas/padron-import-job.schema';
import { PadronStagingEntry } from '@/modules/institutional-voting/schemas/padron-staging-entry.schema';
import { PadronCertificate } from '@/modules/institutional-voting/schemas/padron-certificate.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { PadronCertificatePdfService } from '@/modules/institutional-voting/services/core/padron-certificate-pdf.service';
import { PadronPdfParserService } from '@/modules/institutional-voting/services/core/padron-pdf-parser.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { EnabledSession } from '@/modules/institutional-voting/schemas/enabled-session.shcema';
import { VoteWritterService } from '@/modules/institutional-voting/services/core/vote-writter.service';
import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';

describe('PadronService (unit)', () => {
  let service: PadronService;

  let padronVersionModel: any;
  let padronEntryModel: any;
  let comparisonReportModel: any;
  let padronImportJobModel: any;
  let padronStagingEntryModel: any;
  let padronCertificateModel: any;
  let enabledSessionModel: any;
  let accessService: any;
  let padronCertificatePdfService: any;
  let padronPdfParserService: any;
  let voteWritterService: any;
  let notificationsService: any;
  let issuerService: any;

  const baseEvent = {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    state: 'DRAFT',
    publicEligibilityEnabled: true,
    publishDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
    save: jest.fn().mockResolvedValue(undefined),
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
      countDocuments: jest.fn(),
    };
    comparisonReportModel = {
      exists: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };
    padronImportJobModel = {
      create: jest.fn(),
      updateMany: jest.fn(),
      updateOne: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
    };
    padronStagingEntryModel = {
      insertMany: jest.fn(),
      countDocuments: jest.fn(),
      exists: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndDelete: jest.fn(),
    };
    padronCertificateModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn(),
      findById: jest.fn(),
      deleteMany: jest.fn(),
    };
    enabledSessionModel = {
      insertOne: jest.fn(),
    },
    accessService = {
      getEventOrThrow: jest.fn(),
      assertTenantWriteAccess: jest.fn(),
      assertGlobalAdminAccess: jest.fn(),
      canFullyEditEvent: jest.fn(() => true),
      canModifyPadronDuringVoting: jest.fn(() => false),
      hasPublicationWindowExpired: jest.fn(() => false),
    };
    padronCertificatePdfService = {
      buildPdf: jest.fn(() => Buffer.from('%PDF-1.4\nmock\n', 'utf-8')),
    };
    padronPdfParserService = {
      validateSourceFile: jest.fn(),
      getSourceType: jest.fn(() => 'PDF'),
      parseDocument: jest.fn(),
    };
    voteWritterService = {
      addNewVoters: jest.fn(),
    };
    notificationsService = {
      notifyPadronAvailabilityEnabledForUser: jest.fn(),
    };
    issuerService = {
      issueCredential: jest.fn(),
      getDidsByDnis: jest.fn().mockResolvedValue([]),
    };

    padronImportJobModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        summary: {
          parsedCount: 0,
          validCount: 0,
          duplicateCount: 0,
          invalidCount: 0,
        },
      }),
    });
    padronStagingEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PadronService,
        { provide: getModelToken(PadronVersion.name), useValue: padronVersionModel },
        { provide: getModelToken(PadronEntry.name), useValue: padronEntryModel },
        { provide: getModelToken(ComparisonReport.name), useValue: comparisonReportModel },
        { provide: getModelToken(PadronImportJob.name), useValue: padronImportJobModel },
        { provide: getModelToken(PadronStagingEntry.name), useValue: padronStagingEntryModel },
        { provide: getModelToken(PadronCertificate.name), useValue: padronCertificateModel },
        { provide: getModelToken(EnabledSession.name), useValue: enabledSessionModel },
        { provide: InstitutionalVotingAccessService, useValue: accessService },
        { provide: PadronCertificatePdfService, useValue: padronCertificatePdfService },
        { provide: PadronPdfParserService, useValue: padronPdfParserService },
        { provide: VoteWritterService, useValue: voteWritterService },
        {
          provide: InstitutionalVotingNotificationsService,
          useValue: notificationsService,
        },
        { provide: IssuerService, useValue: issuerService },
      ],
    }).compile();

    service = moduleRef.get(PadronService);
  });

  it('mantiene compatibilidad con importación CSV legacy y crea versión vigente', async () => {
    const csv = ['carnet,habilitado', '123456,si', '123.456,si', '999999,no', '---,si'].join(
      '\n',
    );
    const requester = { sub: String(new Types.ObjectId()) };
    const versionId = new Types.ObjectId();
    const expectedDigest = createHash('sha256').update(csv).digest('hex');

    accessService.getEventOrThrow.mockResolvedValue(baseEvent);
    padronVersionModel.create.mockResolvedValue({
      _id: versionId,
      fileDigest: expectedDigest,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      createdBy: new Types.ObjectId(requester.sub),
      tenantId: baseEvent.tenantId,
      totals: {
        validCount: 2,
        duplicateCount: 1,
        invalidCount: 1,
      },
      isCurrent: true,
      sourceType: 'CSV_LEGACY',
    });
    padronCertificateModel.findOne.mockResolvedValue(null);
    padronEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { carnetNorm: '123456', enabled: true },
          { carnetNorm: '999999', enabled: false },
        ]),
      }),
    });
    padronCertificateModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      eventId: baseEvent._id,
      padronVersionId: versionId,
      generatedAt: new Date('2026-01-01T13:00:00.000Z'),
      generationMode: 'ON_CONFIRMATION',
      fileName: `padron-constancia-${String(versionId)}.pdf`,
      mimeType: 'application/pdf',
      fileSha256: 'sha',
      fileSize: 12,
      sourceType: 'CSV_LEGACY',
      totalCount: 2,
      enabledCount: 1,
      disabledCount: 1,
      storageKind: 'INLINE_BASE64',
    });

    const result = await service.importPadron(String(baseEvent._id), csv, requester);

    expect(accessService.assertTenantWriteAccess).toHaveBeenCalledWith(
      baseEvent.tenantId,
      requester,
    );
    expect(padronVersionModel.updateMany).toHaveBeenCalledWith(
      { eventId: baseEvent._id, isCurrent: true },
      { $set: { isCurrent: false } },
    );
    expect(padronEntryModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          padronVersionId: versionId,
          eventId: baseEvent._id,
          carnetNorm: '123456',
          enabled: true,
        }),
        expect.objectContaining({
          padronVersionId: versionId,
          eventId: baseEvent._id,
          carnetNorm: '999999',
          enabled: false,
        }),
      ],
      { ordered: false },
    );
    expect(comparisonReportModel.updateOne).toHaveBeenCalledWith(
      { padronVersionId: versionId },
      expect.objectContaining({
        $set: expect.objectContaining({
          eventId: baseEvent._id,
          padronVersionId: versionId,
        }),
      }),
      { upsert: true },
    );
    expect(result.sourceType).toBe('CSV_LEGACY');
    expect(result.fileDigest).toBe(expectedDigest);
    expect(padronCertificatePdfService.buildPdf).toHaveBeenCalled();
    expect(result.certificate).toEqual(
      expect.objectContaining({
        exists: true,
        sourceType: 'CSV_LEGACY',
      }),
    );
  });

  it('procesa PDF, crea staging y devuelve el import job resumido', async () => {
    const requester = { sub: String(new Types.ObjectId()) };
    const importJobId = new Types.ObjectId();
    const file = {
      originalname: 'padron.pdf',
      mimetype: 'application/pdf',
      size: 64,
      buffer: Buffer.from('%PDF-1.4\n123456 si\n789000 no\n', 'utf-8'),
    };

    accessService.getEventOrThrow.mockResolvedValue(baseEvent);
    padronImportJobModel.create.mockResolvedValue({
      _id: importJobId,
    });
    padronPdfParserService.parseDocument.mockResolvedValue({
      rows: [
        { ci: '123456', enabled: true, sourceRow: 1 },
        { ci: '789000', enabled: false, sourceRow: 2 },
      ],
      errors: [],
      provider: 'local-fallback',
      model: null,
      usedFallback: true,
    });
    padronImportJobModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: importJobId,
        eventId: baseEvent._id,
        tenantId: baseEvent.tenantId,
        sourceType: 'PDF',
        status: 'PARSED',
        isActiveDraft: true,
        originalFileName: file.originalname,
        originalFileMimeType: file.mimetype,
        originalFileSize: file.size,
        originalFileSha256: createHash('sha256').update(file.buffer).digest('hex'),
        parserProvider: 'local-fallback',
        parserModel: null,
        parserUsedFallback: true,
        summary: {
          parsedCount: 2,
          validCount: 2,
          duplicateCount: 0,
          invalidCount: 0,
          stagingCount: 2,
          enabledCount: 1,
          disabledCount: 1,
        },
        errors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    padronImportJobModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        summary: {
          parsedCount: 2,
          validCount: 2,
          duplicateCount: 0,
          invalidCount: 0,
        },
      }),
    });
    padronStagingEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { ciNorm: '123456', enabled: true },
        { ciNorm: '789000', enabled: false },
      ]),
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });
    issuerService.getDidsByDnis.mockResolvedValue([{ dni: '123456' }, { dni: '789000' }]);
    padronStagingEntryModel.countDocuments.mockResolvedValue(2);

    const result = await service.uploadPadronPdf(String(baseEvent._id), file, requester);

    expect(padronPdfParserService.validateSourceFile).toHaveBeenCalledWith(file);
    expect(padronPdfParserService.getSourceType).toHaveBeenCalledWith(file);
    expect(padronImportJobModel.updateMany).toHaveBeenCalledWith(
      { eventId: baseEvent._id, isActiveDraft: true },
      { $set: { isActiveDraft: false } },
    );
    expect(padronStagingEntryModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          importJobId,
          eventId: baseEvent._id,
          ciNorm: '123456',
          enabled: true,
        }),
        expect.objectContaining({
          importJobId,
          eventId: baseEvent._id,
          ciNorm: '789000',
          enabled: false,
        }),
      ],
      { ordered: false },
    );
    expect(padronImportJobModel.updateOne).toHaveBeenCalledWith(
      { _id: importJobId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'PARSED',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        importJobId: String(importJobId),
        status: 'PARSED',
      }),
    );
  });

  it('marca el import job como FAILED cuando el parser del PDF falla', async () => {
    const requester = { sub: String(new Types.ObjectId()) };
    const importJobId = new Types.ObjectId();
    const file = {
      originalname: 'padron.pdf',
      mimetype: 'application/pdf',
      size: 64,
      buffer: Buffer.from('%PDF-1.4\nobj\nendobj\n', 'utf-8'),
    };

    accessService.getEventOrThrow.mockResolvedValue(baseEvent);
    padronImportJobModel.create.mockResolvedValue({
      _id: importJobId,
    });
    padronPdfParserService.parseDocument.mockRejectedValue(new Error('Gemini unavailable'));
    padronImportJobModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: importJobId,
        eventId: baseEvent._id,
        tenantId: baseEvent.tenantId,
        sourceType: 'PDF',
        status: 'FAILED',
        isActiveDraft: true,
        originalFileName: file.originalname,
        originalFileMimeType: file.mimetype,
        originalFileSize: file.size,
        originalFileSha256: createHash('sha256').update(file.buffer).digest('hex'),
        parserProvider: 'local-fallback',
        parserModel: null,
        parserUsedFallback: true,
        summary: {
          parsedCount: 0,
          validCount: 0,
          duplicateCount: 0,
          invalidCount: 0,
          stagingCount: 0,
          enabledCount: 0,
          disabledCount: 0,
        },
        errors: [{ code: 'PARSER_ERROR', message: 'Gemini unavailable' }],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    padronStagingEntryModel.countDocuments.mockResolvedValue(0);

    const result = await service.uploadPadronPdf(String(baseEvent._id), file, requester);

    expect(padronImportJobModel.updateOne).toHaveBeenCalledWith(
      { _id: importJobId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'FAILED',
        }),
      }),
    );
    expect(result.status).toBe('FAILED');
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PARSER_ERROR',
        }),
      ]),
    );
  });

  it('procesa imagen clara con el mismo flujo y la clasifica como IMAGE', async () => {
    const requester = { sub: String(new Types.ObjectId()) };
    const importJobId = new Types.ObjectId();
    const file = {
      originalname: 'padron.png',
      mimetype: 'image/png',
      size: 128,
      buffer: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('\n123456 si\n789000 no\n', 'utf-8'),
      ]),
    };

    accessService.getEventOrThrow.mockResolvedValue(baseEvent);
    padronPdfParserService.getSourceType.mockReturnValue('IMAGE');
    padronImportJobModel.create.mockResolvedValue({
      _id: importJobId,
    });
    padronPdfParserService.parseDocument.mockResolvedValue({
      rows: [
        { ci: '123456', enabled: true, sourceRow: 1 },
        { ci: '789000', enabled: false, sourceRow: 2 },
      ],
      errors: [],
      provider: 'deterministic-text',
      model: null,
      usedFallback: false,
    });
    padronImportJobModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: importJobId,
        eventId: baseEvent._id,
        tenantId: baseEvent.tenantId,
        sourceType: 'IMAGE',
        status: 'PARSED',
        isActiveDraft: true,
        originalFileName: file.originalname,
        originalFileMimeType: file.mimetype,
        originalFileSize: file.size,
        originalFileSha256: createHash('sha256').update(file.buffer).digest('hex'),
        parserProvider: 'deterministic-text',
        parserModel: null,
        parserUsedFallback: false,
        summary: {
          parsedCount: 2,
          validCount: 2,
          duplicateCount: 0,
          invalidCount: 0,
          stagingCount: 2,
          enabledCount: 1,
          disabledCount: 1,
        },
        errors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    padronImportJobModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        summary: {
          parsedCount: 2,
          validCount: 2,
          duplicateCount: 0,
          invalidCount: 0,
        },
      }),
    });
    padronStagingEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { ciNorm: '123456', enabled: true },
        { ciNorm: '789000', enabled: false },
      ]),
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });
    issuerService.getDidsByDnis.mockResolvedValue([{ dni: '123456' }, { dni: '789000' }]);
    padronStagingEntryModel.countDocuments.mockResolvedValue(2);

    const result = await service.uploadPadronFile(String(baseEvent._id), file, requester);

    expect(padronPdfParserService.validateSourceFile).toHaveBeenCalledWith(file);
    expect(padronPdfParserService.getSourceType).toHaveBeenCalledWith(file);
    expect(padronImportJobModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'IMAGE',
        originalFileMimeType: 'image/png',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'PARSED',
      }),
    );
  });

  it('rechaza confirmar staging sin entradas válidas', async () => {
    const requester = { sub: String(new Types.ObjectId()) };
    const importJobId = new Types.ObjectId();

    accessService.getEventOrThrow.mockResolvedValue(baseEvent);
    padronImportJobModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: importJobId,
          status: 'FAILED',
          isActiveDraft: true,
        }),
      }),
    });
    padronStagingEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    await expect(
      service.confirmPadronStaging(String(baseEvent._id), requester),
    ).rejects.toThrow(BadRequestException);
  });

  it('recalcula el import job cuando el staging ya tiene filas útiles después de un fallo inicial', async () => {
    const requester = { sub: String(new Types.ObjectId()) };
    const importJobId = new Types.ObjectId();
    const createdEntry = {
      _id: new Types.ObjectId(),
      importJobId,
      eventId: baseEvent._id,
      tenantId: baseEvent.tenantId,
      ciNorm: '12345678',
      enabled: true,
      toObject: () => ({
        _id: new Types.ObjectId(),
        importJobId,
        eventId: baseEvent._id,
        tenantId: baseEvent.tenantId,
        ciNorm: '12345678',
        enabled: true,
        sourceKind: 'MANUAL',
      }),
    };

    accessService.getEventOrThrow.mockResolvedValue(baseEvent);
    padronImportJobModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: importJobId,
          eventId: baseEvent._id,
          tenantId: baseEvent.tenantId,
          status: 'FAILED',
          isActiveDraft: true,
        }),
      }),
    });
    padronStagingEntryModel.exists.mockResolvedValue(false);
    padronStagingEntryModel.create.mockResolvedValue(createdEntry);
    padronImportJobModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: importJobId,
        status: 'FAILED',
        errors: [{ code: 'PARSER_ERROR', message: 'backend parser failed' }],
        summary: {
          parsedCount: 0,
          validCount: 0,
          duplicateCount: 0,
          invalidCount: 0,
        },
      }),
    });
    padronStagingEntryModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ ciNorm: '12345678', enabled: true }]),
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });
    issuerService.getDidsByDnis.mockResolvedValue([{ dni: '12345678' }]);

    await service.addPadronStagingEntry(
      String(baseEvent._id),
      { ci: '12345678', enabled: true },
      requester,
    );

    expect(padronImportJobModel.updateOne).toHaveBeenCalledWith(
      { _id: importJobId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'PARSED_WITH_ERRORS',
          summary: expect.objectContaining({
            stagingCount: 1,
            enabledCount: 1,
            disabledCount: 0,
            missingIdentityCount: 0,
          }),
        }),
      }),
    );
  });

  it('actualiza el estado de aprobación de una versión específica del padrón', async () => {
    const requester = { sub: String(new Types.ObjectId()), role: 'ADMIN' };
    const version = {
      _id: new Types.ObjectId(),
    };
    accessService.getEventOrThrow.mockResolvedValue(baseEvent);
    padronVersionModel.findOne.mockResolvedValue(version);

    const result = await service.updateComparisonReportStatus(
      String(baseEvent._id),
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
      eventId: String(baseEvent._id),
      padronVersionId: String(version._id),
      status: 'OK',
    });
  });

  it('rechaza consultar una versión inexistente del padrón', async () => {
    const requester = { sub: String(new Types.ObjectId()), role: 'ADMIN' };
    accessService.getEventOrThrow.mockResolvedValue(baseEvent);
    padronVersionModel.findOne.mockResolvedValue(null);

    await expect(
      service.updateComparisonReportStatus(
        String(baseEvent._id),
        'FAILED',
        requester,
        String(new Types.ObjectId()),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza cambiar el comparison report si el solicitante no es administrador global', async () => {
    const requester = { sub: String(new Types.ObjectId()), role: 'GOVERNOR' };
    accessService.assertGlobalAdminAccess.mockImplementation(() => {
      throw new ForbiddenException(
        'Solo un administrador global puede aprobar o rechazar el padrón',
      );
    });

    await expect(
      service.updateComparisonReportStatus(
        String(baseEvent._id),
        'OK',
        requester,
        String(new Types.ObjectId()),
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(accessService.getEventOrThrow).not.toHaveBeenCalled();
  });

  it('rechaza carnet inválido al consultar elegibilidad', async () => {
    accessService.getEventOrThrow.mockResolvedValue(baseEvent);

    await expect(service.checkEligibility(String(baseEvent._id), '')).rejects.toThrow(
      BadRequestException,
    );
  });
});
