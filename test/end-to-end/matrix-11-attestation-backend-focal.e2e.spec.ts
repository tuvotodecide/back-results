const mockZkCanActivate = jest.fn();

jest.mock('../../src/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: mockZkCanActivate,
  })),
}));

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BallotController } from '@/modules/ballot/controllers/ballot.controller';
import { BallotService } from '@/modules/ballot/services/ballot.service';
import { VotingPeriodGuard } from '@/modules/elections/guards/voting-period.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';

const ballots = {
  findByTableCode: jest.fn(),
  findOne: jest.fn(),
} satisfies Partial<BallotService>;

let mockJwtUser = {
  role: 'GOVERNOR',
  sub: 'user-authorized',
  votingDepartmentId: 'department-allowed',
  contractId: 'contract-allowed',
};

const mockJwtCanActivate = jest.fn((context) => {
  const request = context.switchToHttp().getRequest();
  request.user = mockJwtUser;
  return true;
});

describe('MX-11 | focal E2E | alcance territorial de evidencia', () => {
  let app: INestApplication;

  beforeAll(async () => {
    mockZkCanActivate.mockResolvedValue(true);
    const moduleBuilder = Test.createTestingModule({
      controllers: [BallotController],
      providers: [{ provide: BallotService, useValue: ballots }],
    });
    const moduleRef = await moduleBuilder
      .overrideGuard(VotingPeriodGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(ZkAuthGuard)
      .useValue({ canActivate: mockZkCanActivate })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: mockJwtCanActivate })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });
  beforeEach(() => jest.clearAllMocks());

  it('[MX-11][ACC-BE-P1-004][E2E] usuario autorizado recibe evidencia permitida de su territorio', async () => {
    mockJwtUser = {
      role: 'GOVERNOR',
      sub: 'user-authorized',
      votingDepartmentId: 'department-allowed',
      contractId: 'contract-allowed',
    };
    ballots.findOne.mockResolvedValue({
      _id: '64b000000000000000000001',
      tableCode: 'T-1',
      image: 'ipfs://allowed-evidence',
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/ballots/64b000000000000000000001');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      _id: '64b000000000000000000001',
      tableCode: 'T-1',
      image: 'ipfs://allowed-evidence',
    });
    expect(ballots.findOne).toHaveBeenCalledWith(
      '64b000000000000000000001',
      'department-allowed',
      undefined,
      'GOVERNOR',
    );
  });

  it('[MX-11][ACC-BE-P1-004][E2E] usuario de territorio ajeno recibe rechazo sin filtrar evidencia sensible', async () => {
    mockJwtUser = {
      role: 'GOVERNOR',
      sub: 'user-foreign',
      votingDepartmentId: 'department-allowed',
      contractId: 'contract-foreign',
    };
    const response = await request(app.getHttpServer())
      .get('/api/v1/ballots/64b000000000000000000001?departmentId=department-foreign');

    expect(response.status).toBe(403);
    expect(ballots.findOne).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toMatch(
      /allowed-evidence|private-url|metadata-sensitive|authorization/i,
    );
  });
});
