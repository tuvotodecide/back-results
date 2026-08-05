jest.mock('@/core/guards/zk-auth.guard', () => ({ ZkAuthGuard: class ZkAuthGuard {} }));
jest.mock('@/modules/institutional-voting/services/institutional-voting.service', () => ({
  InstitutionalVotingService: class InstitutionalVotingService {},
}));

import { BadRequestException, CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { InstitutionalVotingAdminController } from '@/modules/institutional-voting/controllers/institutional-voting-admin.controller';
import { InstitutionalVotingPublicController } from '@/modules/institutional-voting/controllers/institutional-voting-public.controller';
import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';
import { TvdCapacityService } from '@/modules/tvd/services/tvd-capacity.service';

const authenticatedAdmin = {
  userId: 'admin-1',
  sub: 'admin-1',
  role: 'ADMIN',
  tenantId: 'tenant-1',
  active: true,
};

const jwtAuthGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: typeof authenticatedAdmin }>();
    request.user = authenticatedAdmin;
    return true;
  }),
} satisfies CanActivate;

describe('MX-05 Backend Results — aceptación focal de padrón', () => {
  let app: INestApplication | undefined;
  const voting = {
    getPadronSummary: jest.fn(),
    listCurrentPadronVoters: jest.fn(),
    listPadronStaging: jest.fn(),
    uploadPadronFile: jest.fn(),
    getPadronImport: jest.fn(),
    confirmPadronStaging: jest.fn(),
    importPadron: jest.fn(),
    downloadPadronCsv: jest.fn(),
    checkEligibility: jest.fn(),
    checkPublicEligibilityAcrossEvents: jest.fn(),
  } satisfies Partial<InstitutionalVotingService>;

  const admin = { Authorization: 'Bearer focal-admin-token' };
  const httpServer = () => {
    if (!app) throw new Error('Nest acceptance app unavailable');
    return app.getHttpServer();
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [InstitutionalVotingAdminController, InstitutionalVotingPublicController],
      providers: [
        { provide: InstitutionalVotingService, useValue: voting },
        { provide: TvdCapacityService, useValue: {} },
      ],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(jwtAuthGuard);
    const moduleRef = await moduleBuilder.compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(jwtAuthGuard);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jwtAuthGuard.canActivate.mockImplementation((context: ExecutionContext) => {
      const request = context.switchToHttp().getRequest<{ user?: typeof authenticatedAdmin }>();
      request.user = authenticatedAdmin;
      return true;
    });
    voting.getPadronSummary.mockResolvedValue({ eventId: 'event-1', currentVersion: null, activeDraft: null });
    voting.listCurrentPadronVoters.mockResolvedValue({ data: [{ carnet: '123456', enabled: true }], total: 1, page: 1, limit: 50 });
    voting.listPadronStaging.mockResolvedValue({ importJob: { importJobId: 'job-1', status: 'PARSED' }, data: [{ ci: '123456', enabled: true }, { ci: '999999', enabled: false }], total: 2, page: 1, limit: 50 });
    voting.uploadPadronFile.mockResolvedValue({ importJobId: 'job-1', status: 'PARSED', summary: { stagingCount: 1 }, errors: [] });
    voting.getPadronImport.mockResolvedValue({ importJobId: 'job-1', status: 'PARSED', summary: { stagingCount: 1 }, errors: [] });
    voting.confirmPadronStaging.mockResolvedValue({ state: 'CONFIRMED', padronVersionId: 'version-1', totals: { validCount: 1 }, certificate: { exists: true } });
    voting.importPadron.mockResolvedValue({ padronVersionId: 'version-legacy', totals: { validCount: 1, duplicateCount: 0, invalidCount: 0 } });
    voting.downloadPadronCsv.mockResolvedValue({ fileName: 'padron-version-1.csv', csvContent: '\uFEFFcarnet,habilitado\n123456,si\n', padronVersionId: 'version-1' });
    voting.checkEligibility.mockResolvedValue({ status: 'ELIGIBLE', normalizedCarnet: '123456', referenceVersion: 'version-1' });
    voting.checkPublicEligibilityAcrossEvents.mockResolvedValue({ carnet: '123456', events: [{ eventId: 'event-1', status: 'ELIGIBLE', eligible: true }] });
  });

  it('[MX-05][PAD-ACC-P0-001][ACEPTACION] protege el resumen administrativo y entrega el estado real del padrón autorizado', async () => {
    jwtAuthGuard.canActivate.mockImplementationOnce(() => {
      throw new UnauthorizedException();
    });
    await request(httpServer()).get('/api/v1/voting/events/event-1/padron/summary').expect(401);
    expect(voting.getPadronSummary).not.toHaveBeenCalled();

    const response = await request(httpServer()).get('/api/v1/voting/events/event-1/padron/summary').set(admin).expect(200);
    expect(response.body).toMatchObject({ eventId: 'event-1', currentVersion: null, activeDraft: null });
    expect(voting.getPadronSummary).toHaveBeenCalledWith('event-1', expect.objectContaining({ tenantId: 'tenant-1' }));
    expect(jwtAuthGuard.canActivate).toHaveBeenCalledTimes(2);
  });

  it('[MX-05][PAD-LST-P0-001][ACEPTACION] lista solo los electores vigentes del evento autorizado con paginación', async () => {
    const response = await request(httpServer()).get('/api/v1/voting/events/event-1/padron/voters?page=1&limit=50').set(admin).expect(200);
    expect(response.body).toMatchObject({ total: 1, data: [{ carnet: '123456', enabled: true }] });
    expect(voting.listCurrentPadronVoters).toHaveBeenCalledWith('event-1', expect.any(Object), 1, 50);
  });

  it('[MX-05][PAD-LST-P1-002][ACEPTACION] entrega staging ordenable, totales y el import activo', async () => {
    const response = await request(httpServer()).get('/api/v1/voting/events/event-1/padron/staging?page=1&limit=50').set(admin).expect(200);
    expect(response.body).toMatchObject({ importJob: { importJobId: 'job-1', status: 'PARSED' }, total: 2, data: [{ ci: '123456' }, { ci: '999999' }] });
    expect(response.body.data.map((row: { ci: string }) => row.ci)).toEqual(['123456', '999999']);
    expect(voting.listPadronStaging).toHaveBeenCalledWith('event-1', expect.any(Object), 1, 50);
  });

  it('[MX-05][PAD-UPL-P0-001][ACEPTACION] rechaza multipart sin archivo y acepta PDF permitido en el endpoint de análisis', async () => {
    await request(httpServer()).post('/api/v1/voting/events/event-1/padron/imports').set(admin).expect(400);
    voting.uploadPadronFile.mockRejectedValueOnce(new BadRequestException('Formato de archivo no permitido'));
    await request(httpServer()).post('/api/v1/voting/events/event-1/padron/imports').set(admin).attach('file', Buffer.from('texto plano'), 'padron.txt').expect(400);
    await request(httpServer()).post('/api/v1/voting/events/event-1/padron/imports').set(admin).attach('file', Buffer.from('%PDF-1.4\n123456 si\n'), 'padron.pdf').expect(201);
    expect(voting.uploadPadronFile).toHaveBeenNthCalledWith(1, 'event-1', expect.objectContaining({ originalname: 'padron.txt', mimetype: 'text/plain' }), expect.any(Object));
    expect(voting.uploadPadronFile).toHaveBeenNthCalledWith(2, 'event-1', expect.objectContaining({ originalname: 'padron.pdf', mimetype: 'application/pdf' }), expect.any(Object));
  });

  it('[MX-05][PAD-PRC-P0-001][ACEPTACION] devuelve resumen, registros y observaciones consumibles por la pantalla', async () => {
    voting.uploadPadronFile.mockResolvedValueOnce({ importJobId: 'job-1', status: 'PARSED_WITH_ERRORS', summary: { parsedCount: 2, stagingCount: 1 }, errors: [{ code: 'INVALID_CI', rowIndex: 2, message: 'CI inválido', rawValue: '---' }] });
    const response = await request(httpServer()).post('/api/v1/voting/events/event-1/padron/imports').set(admin).attach('file', Buffer.from('%PDF-1.4\n123456 si\n'), 'padron.pdf').expect(201);
    expect(response.body).toMatchObject({ status: 'PARSED_WITH_ERRORS', summary: { parsedCount: 2 }, errors: [expect.objectContaining({ code: 'INVALID_CI', rowIndex: 2 })] });
  });

  it('[MX-05][PAD-PRC-P0-003][ACEPTACION] consulta el estado, errores y resumen del import job', async () => {
    voting.getPadronImport.mockResolvedValueOnce({ importJobId: 'job-1', status: 'FAILED', summary: { stagingCount: 0 }, errors: [{ code: 'PARSER_ERROR', message: 'ilegible' }] });
    const response = await request(httpServer()).get('/api/v1/voting/events/event-1/padron/imports/job-1').set(admin).expect(200);
    expect(response.body).toMatchObject({ status: 'FAILED', summary: { stagingCount: 0 }, errors: [expect.objectContaining({ code: 'PARSER_ERROR' })] });
  });

  it('[MX-05][PAD-VAL-P0-001][ACEPTACION] expone código, fila, mensaje y valor de cada error de importación', async () => {
    voting.getPadronImport.mockResolvedValueOnce({ importJobId: 'job-1', status: 'PARSED_WITH_ERRORS', summary: { validCount: 1, invalidCount: 1 }, errors: [{ code: 'INVALID_CI', rowIndex: 3, message: 'CI inválido', rawValue: '@@@' }] });
    const response = await request(httpServer()).get('/api/v1/voting/events/event-1/padron/imports/job-1').set(admin).expect(200);
    expect(response.body.errors).toEqual([expect.objectContaining({ code: 'INVALID_CI', rowIndex: 3, message: 'CI inválido', rawValue: '@@@' })]);
  });

  it('[MX-05][PAD-CFM-P0-001][ACEPTACION] confirma staging y retorna versión, totales y constancia disponibles', async () => {
    const response = await request(httpServer()).post('/api/v1/voting/events/event-1/padron/staging/confirm').set(admin).send({}).expect(201);
    expect(response.body).toMatchObject({ state: 'CONFIRMED', padronVersionId: 'version-1', totals: { validCount: 1 }, certificate: { exists: true } });
    expect(voting.confirmPadronStaging).toHaveBeenCalledWith('event-1', expect.any(Object));
  });

  it('[MX-05][PAD-RPL-P1-001][ACEPTACION] entrega el último staging vinculado al import job activo', async () => {
    voting.uploadPadronFile.mockResolvedValueOnce({ importJobId: 'job-new', status: 'PARSED', summary: { stagingCount: 1 }, errors: [] });
    const response = await request(httpServer()).post('/api/v1/voting/events/event-1/padron/imports').set(admin).attach('file', Buffer.from('%PDF-1.4\n999999 no\n'), 'padron-reemplazo.pdf').expect(201);
    expect(response.body).toMatchObject({ importJobId: 'job-new', status: 'PARSED', summary: { stagingCount: 1 } });
    expect(voting.uploadPadronFile).toHaveBeenCalledWith('event-1', expect.objectContaining({ originalname: 'padron-reemplazo.pdf' }), expect.any(Object));
  });

  it('[MX-05][PAD-CSV-P1-001][ACEPTACION] conserva los totales legacy en la respuesta multipart CSV', async () => {
    const response = await request(httpServer()).post('/api/v1/voting/events/event-1/padron/import').set(admin).attach('file', Buffer.from('carnet,habilitado\n123456,si\n'), 'padron.csv').expect(201);
    expect(response.body).toMatchObject({ padronVersionId: 'version-legacy', totals: { validCount: 1, duplicateCount: 0, invalidCount: 0 } });
    expect(voting.importPadron).toHaveBeenCalledWith('event-1', 'carnet,habilitado\n123456,si\n', expect.any(Object));
  });

  it('[MX-05][PAD-DWN-P1-001][ACEPTACION] descarga CSV con carnet normalizado y estado de habilitación', async () => {
    const response = await request(httpServer()).get('/api/v1/voting/events/event-1/padron/download').set(admin).expect(200);
    expect(response.headers['content-disposition']).toContain('padron-version-1.csv');
    expect(response.text).toBe('\uFEFFcarnet,habilitado\n123456,si\n');
    expect(voting.downloadPadronCsv).toHaveBeenCalledWith('event-1', expect.any(Object), undefined);
  });

  it('[MX-05][PAD-ELG-P0-001][ACEPTACION] responde habilitación individual sin nombre ni datos personales adicionales', async () => {
    const response = await request(httpServer()).get('/api/v1/voting/events/event-1/eligibility?carnet=123.456').expect(200);
    expect(response.body).toEqual({ status: 'ELIGIBLE', normalizedCarnet: '123456', referenceVersion: 'version-1' });
    expect(voting.checkEligibility).toHaveBeenCalledWith('event-1', '123.456');
  });

  it('[MX-05][PAD-ELG-P0-002][ACEPTACION] entrega eventos visibles y carnet normalizado para la consulta pública', async () => {
    const response = await request(httpServer()).get('/api/v1/voting/events/public/eligibility-by-carnet?carnet=123.456').expect(200);
    expect(response.body).toEqual({ carnet: '123456', events: [{ eventId: 'event-1', status: 'ELIGIBLE', eligible: true }] });
    expect(voting.checkPublicEligibilityAcrossEvents).toHaveBeenCalledWith('123.456', undefined);
  });

  it('[MX-05][PAD-SEC-P0-001][ACEPTACION] no expone datos personales en la respuesta de elegibilidad pública', async () => {
    const response = await request(httpServer()).get('/api/v1/voting/events/public/eligibility-by-carnet?carnet=123456').expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/name|email|phone|address/i);
    expect(response.body.events[0]).toEqual({ eventId: 'event-1', status: 'ELIGIBLE', eligible: true });
  });
});
