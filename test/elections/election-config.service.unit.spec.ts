import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { ElectionConfig } from '@/modules/elections/schemas/election-config.schema';

const mkModel = () => ({
  updateMany: jest.fn().mockResolvedValue({}),
  findOne: jest.fn().mockReturnThis(),
  find: jest.fn().mockReturnThis(),
  findById: jest.fn().mockReturnThis(),
  findByIdAndUpdate: jest.fn().mockReturnThis(),
  findByIdAndDelete: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  exec: jest.fn(),
  save: jest.fn(),
});

describe('ElectionConfigService (unit)', () => {
  let svc: ElectionConfigService;
  const model = mkModel();

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        ElectionConfigService,
        { provide: getModelToken(ElectionConfig.name), useValue: model },
      ],
    }).compile();

    svc = mod.get(ElectionConfigService);
    jest.clearAllMocks();
  });

  it('ELEC-SVC-001 create desactiva del mismo type y timezone=America/La_Paz', async () => {
    const dto: any = {
      name: 'Gen-2025',
      votingStartDate: new Date().toISOString(),
      votingEndDate: new Date(Date.now() + 60_000).toISOString(),
      resultsStartDate: new Date(Date.now() + 120_000).toISOString(),
      type: 'presidential',
      allowDataModification: false,
    };

    // mock del "new this.electionConfigModel(dto).save()"
    const saved: any = {
      _id: '65f0f0f0f0f0f0f0f0f0f0f0',
      ...dto,
      timezone: 'America/La_Paz',
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
    };
    (model as any).save = jest.fn().mockResolvedValue(saved);
    // hack para interceptar new Model(...)
    (svc as any).electionConfigModel = Object.assign(function (data: any) {
      return { ...data, save: (model as any).save };
    }, model);

    (model.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

    const out = await svc.create(dto);
    expect(model.updateMany).toHaveBeenCalledWith(
      { type: 'presidential' },
      { isActive: false },
    );
    expect(out.timezone).toBe('America/La_Paz');
    expect(out.isActive).toBe(true);
  });

  it('ELEC-SVC-002 create lanza 409 por 11000', async () => {
    (model as any).save = jest.fn().mockRejectedValue({ code: 11000 });
    (svc as any).electionConfigModel = Object.assign(function (data: any) {
      return { ...data, save: (model as any).save };
    }, model);
    const dto: any = {
      name: 'dup',
      votingStartDate: new Date().toISOString(),
      votingEndDate: new Date(Date.now() + 60_000).toISOString(),
      resultsStartDate: new Date(Date.now() + 120_000).toISOString(),
    };
    await expect(svc.create(dto)).rejects.toThrow(ConflictException);
  });

  it('ELEC-SVC-003 update activa ⇒ desactiva otras del mismo type', async () => {
    const existing: any = {
      _id: 'x',
      type: 'presidential',
      votingStartDate: new Date(),
      votingEndDate: new Date(Date.now() + 1),
      resultsStartDate: new Date(Date.now() + 2),
    };
    (model.findById as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue(existing),
    });
    (model.updateMany as jest.Mock).mockResolvedValue({});
    (model.findByIdAndUpdate as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue(existing),
    });

    await svc.update('x', { isActive: true, type: 'presidential' } as any);
    expect(model.updateMany).toHaveBeenCalledWith(
      { type: 'presidential' },
      { isActive: false },
    );
  });

  it('ELEC-SVC-004 update valida fechas (resultsStart < votingEnd) ⇒ 400', async () => {
    const base: any = {
      _id: 'x',
      votingStartDate: new Date(),
      votingEndDate: new Date(Date.now() + 10_000),
      resultsStartDate: new Date(Date.now() + 20_000),
    };
    (model.findById as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue(base),
    });

    await expect(
      svc.update('x', {
        resultsStartDate: new Date(Date.now() + 5_000).toISOString(), // menor que votingEnd
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('ELEC-SVC-005 getActiveConfig retorna la más reciente', async () => {
    const doc: any = {
      _id: '1',
      name: 'A',
      votingStartDate: new Date(),
      votingEndDate: new Date(Date.now() + 1),
      resultsStartDate: new Date(Date.now() + 2),
      isActive: true,
      allowDataModification: false,
      timezone: 'America/La_Paz',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (model.findOne as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });
    const out = await svc.getActiveConfig();
    expect(out?.id).toBe('1');
  });

  it('ELEC-SVC-006 getElectionStatus sin config devuelve flags en false', async () => {
    (model.findOne as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    const status = await svc.getElectionStatus();
    expect(status.hasActiveConfig).toBe(false);
    expect(status.isVotingPeriod).toBe(false);
    expect(status.isResultsPeriod).toBe(false);
    expect(typeof status.currentTimeBolivia).toBe('string');
  });
});
