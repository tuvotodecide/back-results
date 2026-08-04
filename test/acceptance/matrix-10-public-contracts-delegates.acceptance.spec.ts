import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { AuthService } from '@/modules/auth/services/auth.service';
import { ContractsController } from '@/modules/contracts/controllers/contracts.controller';
import { DelegatesController } from '@/modules/contracts/controllers/delegates.controller';
import { ContractsService } from '@/modules/contracts/services/contracts.service';
import { DelegatesService } from '@/modules/contracts/services/delegates.service';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';

describe('MX-10 | contratos y delegados públicos', () => {
  let app: INestApplication;

  const contractsServiceMock = {
    findPublicActiveContracts: jest.fn(),
  } satisfies Partial<ContractsService>;
  const delegatesServiceMock = {
    isAuthorizedForContract: jest.fn(),
    getAuthorizedContracts: jest.fn(),
  } satisfies Partial<DelegatesService>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractsController, DelegatesController],
      providers: [
        { provide: ContractsService, useValue: contractsServiceMock },
        { provide: DelegatesService, useValue: delegatesServiceMock },
        { provide: ElectoralLocationService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: getModelToken(RoledUser.name), useValue: {} },
      ],
    })
      // ContractsController declares this guard on administrative routes. None of
      // the public routes under test uses it, so an inert local override avoids
      // constructing its JwtService dependency while preserving route metadata.
      .overrideGuard(AccessApproverGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminOnlyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('[MX-10][CON-PUB-P1-005][ACEPTACION] expone por HTTP solamente contratos activos de la elección solicitada', async () => {
    contractsServiceMock.findPublicActiveContracts.mockResolvedValue([
      {
        contractId: 'contract-1',
        clientRole: 'MAYOR',
        election: { electionId: 'election-1', electionName: 'Municipal', electionType: 'municipal' },
        territory: { type: 'municipality', municipalityName: 'La Paz' },
        active: true,
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/contracts/public-active?electionId=election-1&electionType=municipal')
      .expect(200);

    expect(contractsServiceMock.findPublicActiveContracts).toHaveBeenCalledWith({
      electionId: 'election-1',
      electionType: 'municipal',
    });
    expect(response.body).toEqual({
      data: [
        expect.objectContaining({
          contractId: 'contract-1',
          clientRole: 'MAYOR',
          active: true,
          territory: expect.objectContaining({ municipalityName: 'La Paz' }),
        }),
      ],
      total: 1,
    });
  });

  it('[MX-10][SEC-DAT-P0-002][ACEPTACION] no entrega datos personales en el contrato público HTTP', async () => {
    contractsServiceMock.findPublicActiveContracts.mockResolvedValue([
      {
        contractId: 'contract-1',
        clientRole: 'GOVERNOR',
        election: { electionId: 'election-1', electionName: 'Departamental' },
        territory: { type: 'department', departmentName: 'La Paz' },
        active: true,
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/contracts/public-active')
      .expect(200);

    expect(response.body.data[0]).not.toHaveProperty('client');
    expect(response.body.data[0]).not.toHaveProperty('delegates');
    expect(response.body.data[0]).not.toHaveProperty('email');
    expect(response.body.data[0]).toMatchObject({
      contractId: 'contract-1',
      clientRole: 'GOVERNOR',
      election: { electionId: 'election-1' },
      territory: { departmentName: 'La Paz' },
    });
  });

  it('[MX-10][DEL-AUT-P0-007][ACEPTACION] responde la autorización expuesta sin filtrar datos personales adicionales', async () => {
    delegatesServiceMock.isAuthorizedForContract.mockResolvedValue(true);

    const response = await request(app.getHttpServer())
      .get('/api/v1/delegates/check-authorization?dni=1234567&contractId=contract-1')
      .expect(200);

    expect(delegatesServiceMock.isAuthorizedForContract).toHaveBeenCalledWith(
      '1234567',
      'contract-1',
    );
    expect(response.body).toEqual({ isAuthorized: true, contractId: 'contract-1' });
    expect(response.body).not.toHaveProperty('name');
    expect(response.body).not.toHaveProperty('phone');
    expect(response.body).not.toHaveProperty('email');
  });
});
