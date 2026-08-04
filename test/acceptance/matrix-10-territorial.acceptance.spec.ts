import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';
import { DepartmentController } from '@/modules/geographic/controllers/department.controller';
import { DepartmentService } from '@/modules/geographic/services/department.service';

describe('MX-10 | territorial aceptación focal', () => {
  let app: INestApplication | undefined;
  const departmentService = { findAll: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() } satisfies Partial<DepartmentService>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DepartmentController],
      providers: [{ provide: DepartmentService, useValue: departmentService }],
    })
      // Department GET is public but declares TerritorialScopeGuard; it is
      // incidental to this public contract test. AdminOnlyGuard protects the
      // administrative mutation route tested with an in-process override.
      .overrideGuard(TerritorialScopeGuard).useValue({ canActivate: () => true })
      .overrideGuard(AdminOnlyGuard).useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('[MX-10][TER-LST-P1-001][ACEPTACION] responde el contrato HTTP de departamentos con búsqueda, página y límite', async () => {
    departmentService.findAll.mockResolvedValue({ data: [{ _id: 'dep-1', name: 'La Paz', active: true }], pagination: { page: 2, limit: 5, total: 1, pages: 1 } });

    const response = await request(app!.getHttpServer())
      .get('/api/v1/geographic/departments?search=La&page=2&limit=5')
      .expect(200);

    expect(departmentService.findAll).toHaveBeenCalledWith(expect.objectContaining({ search: 'La', page: 2, limit: 5 }));
    expect(response.body).toMatchObject({ data: [{ name: 'La Paz', active: true }], pagination: { page: 2, limit: 5 } });
  });

  it('[MX-10][TER-NEW-P0-001][ACEPTACION] crea y actualiza el departamento con la respuesta HTTP administrativa', async () => {
    departmentService.create.mockResolvedValue({ _id: 'dep-1', name: 'La Paz', active: true });
    departmentService.update.mockResolvedValue({ _id: 'dep-1', name: 'La Paz Norte', active: false });

    await request(app!.getHttpServer())
      .post('/api/v1/geographic/departments')
      .send({ name: 'La Paz', active: true })
      .expect(201)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({ name: 'La Paz', active: true }),
        );
      });
    await request(app!.getHttpServer())
      .patch('/api/v1/geographic/departments/650000000000000000000001')
      .send({ name: 'La Paz Norte', active: false })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({ name: 'La Paz Norte', active: false }),
        );
      });

    expect(departmentService.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'La Paz', active: true }));
    expect(departmentService.update).toHaveBeenCalledWith('650000000000000000000001', expect.objectContaining({ name: 'La Paz Norte', active: false }));
  });
});
