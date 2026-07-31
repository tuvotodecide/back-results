import { Test } from '@nestjs/testing';
import { ResultsController } from '@/modules/results/controllers/results.controller';
import { ResultsService } from '@/modules/results/services/results.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';


describe('ResultsController (unit)', () => {
  let ctl: ResultsController;
  const svc = {
    getQuickCount: jest.fn(),
    getResultsByLocation: jest.fn(),
    getHeatMapData: jest.fn(),
    getResultsByCircunscripcion: jest.fn(),
    getRegistrationProgress: jest.fn(),
    getSystemStatistics: jest.fn(),
  };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ResultsController],
      providers: [
        { provide: ResultsService, useValue: svc },
        {
          provide: ElectionConfigService,
          useValue: {
            getActiveConfigs: jest.fn().mockResolvedValue([]),
            getActiveConfig: jest.fn(),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
      ],
    }).compile();
    ctl = mod.get(ResultsController);
    jest.clearAllMocks();
  });

  it('[RES-SUM-P0-002][RES-UPD-P1-002] live by-location pasa mode live al servicio', async () => {
    svc.getResultsByLocation.mockResolvedValue({ ok: true });
    await ctl.getLiveByLocation({ electionType: 'presidential' } as any);
    expect(svc.getResultsByLocation).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'live' }),
    );
  });

  it('[RES-SUM-P0-001][RES-TER-P0-001] by-location conserva modo final por defecto', async () => {
    svc.getResultsByLocation.mockResolvedValue({ ok: true });
    await ctl.getResultsByLocation({ electionType: 'presidential' } as any);
    expect(svc.getResultsByLocation).toHaveBeenCalledWith(
      expect.objectContaining({ electionType: 'presidential' }),
    );
  });

  it('[RES-TER-P1-003][RES-SUM-P0-002] live heat-map pasa mode live al servicio', async () => {
    svc.getHeatMapData.mockResolvedValue({ ok: true });
    await ctl.getLiveHeatMap('presidential', 'department', 'La Paz', 'id');
    expect(svc.getHeatMapData).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'live' }),
    );
  });

  it('[RES-SUM-P0-002][RES-ACC-P0-001] live quick-count llama service en modo preliminar', async () => {
    svc.getQuickCount.mockResolvedValue({ ok: true });
    await ctl.getLiveQuickCount('id');
    expect(svc.getQuickCount).toHaveBeenCalledWith('id', 'live', undefined);
  });
});
