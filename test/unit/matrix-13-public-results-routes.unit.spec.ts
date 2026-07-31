jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: class ZkAuthGuard {},
}));

import { ResultsController } from '@/modules/results/controllers/results.controller';
import { BallotController } from '@/modules/ballot/controllers/ballot.controller';
import { AttestationController } from '@/modules/attestation/controllers/attestation.controller';

describe('MX-13 public results, ballots and attestation routes (unit)', () => {
  it('[PUB-CAT-P1-003][PUB-TER-P0-001][PUB-UPD-P1-002] pasa filtros publicos y TTL delegado a resultados por ubicacion', async () => {
    const resultsService = {
      getResultsByLocation: jest.fn().mockResolvedValue({ totalVotes: 12 }),
      getCountedBallots: jest.fn(),
    };
    const controller = new ResultsController(resultsService as never);

    await controller.getResultsByLocation({
      electionId: 'election-1',
      electionType: 'municipal',
      department: 'La Paz',
      province: 'Murillo',
      municipality: 'La Paz',
      electoralSeat: 'Centro',
      electoralLocation: 'Recinto A',
    });

    await controller.getLiveByLocation({
      electionId: 'election-1',
      electionType: 'municipal',
      department: 'La Paz',
    });

    expect(resultsService.getResultsByLocation).toHaveBeenNthCalledWith(1, {
      electionId: 'election-1',
      electionType: 'municipal',
      department: 'La Paz',
      province: 'Murillo',
      municipality: 'La Paz',
      electoralSeat: 'Centro',
      electoralLocation: 'Recinto A',
    });
    expect(resultsService.getResultsByLocation).toHaveBeenNthCalledWith(2, {
      electionId: 'election-1',
      electionType: 'municipal',
      department: 'La Paz',
      mode: 'live',
    });
  });

  it('[PUB-MES-P0-002][PUB-CNS-P0-002][PUB-SEC-P0-002] consulta ballots live/final con eleccion modo paginacion y alcance territorial', async () => {
    const resultsService = {
      getResultsByLocation: jest.fn(),
      getCountedBallots: jest.fn().mockResolvedValue({ data: [] }),
    };
    const controller = new ResultsController(resultsService as never);

    await controller.getLiveCountedBallots(
      { electionId: 'election-1', electionType: 'presidential', department: 'La Paz' },
      2,
      25,
    );
    await controller.getFinalCountedBallots(
      { electionId: 'election-1', electionType: 'presidential', municipality: 'La Paz' },
      undefined,
      undefined,
    );

    expect(resultsService.getCountedBallots).toHaveBeenNthCalledWith(1, {
      electionId: 'election-1',
      electionType: 'presidential',
      department: 'La Paz',
      mode: 'live',
      page: 2,
      limit: 25,
    });
    expect(resultsService.getCountedBallots).toHaveBeenNthCalledWith(2, {
      electionId: 'election-1',
      electionType: 'presidential',
      municipality: 'La Paz',
      mode: 'final',
      page: 1,
      limit: 20,
    });
  });

  it('[PUB-ACT-P0-003][PUB-SEC-P0-002] consulta acta por mesa o imagen conservando contexto de eleccion y alcance', () => {
    const ballotService = {
      findOne: jest.fn().mockReturnValue({ id: 'ballot-1' }),
      findByTableCode: jest.fn().mockReturnValue({ tableCode: 'M-001' }),
      findByNearestLocation: jest.fn(),
    };
    const controller = new BallotController(ballotService as never);
    const req = {
      userDepartmentId: 'dep-lp',
      userMunicipalityId: 'mun-lp',
      userRole: 'MAYOR',
    };

    controller.findByTableCode('M-001', 'election-1', req);
    controller.findOne('64f000000000000000000001', req);

    expect(ballotService.findByTableCode).toHaveBeenCalledWith(
      'M-001',
      'election-1',
      'dep-lp',
      'mun-lp',
      'MAYOR',
    );
    expect(ballotService.findOne).toHaveBeenCalledWith(
      '64f000000000000000000001',
      'dep-lp',
      'mun-lp',
      'MAYOR',
    );
  });

  it('[PUB-CAS-P0-004][PUB-FIL-P1-001][PUB-SEC-P0-002] expone casos most-supported y audit-match con filtros publicos validos', async () => {
    const attestationService = {
      getMostSupportedVersion: jest.fn().mockResolvedValue({ ballotId: 'ballot-1' }),
      listCases: jest.fn().mockResolvedValue({ data: [] }),
      getAuditMatchReport: jest.fn().mockResolvedValue({ match: true }),
    };
    const controller = new AttestationController(attestationService as never);
    const req = {
      userDepartmentId: 'dep-lp',
      userMunicipalityId: 'mun-lp',
      userRole: 'GOVERNOR',
    };

    await controller.getMostSupportedVersion('M-001', 'election-1', req);
    await controller.listCases(1, 10, 'VERIFYING,PENDING,CONSENSUAL,CLOSED', 'La Paz', 'Murillo', 'La Paz', 'election-1', req);
    await controller.getAuditMatchReport('M-001', 'election-1', 'attested', 'municipal');

    expect(attestationService.getMostSupportedVersion).toHaveBeenCalledWith(
      'M-001',
      'election-1',
      'dep-lp',
      'mun-lp',
      'GOVERNOR',
    );
    expect(attestationService.listCases).toHaveBeenCalledWith(
      1,
      10,
      'VERIFYING,PENDING,CONSENSUAL,CLOSED',
      'La Paz',
      'Murillo',
      'La Paz',
      'election-1',
      'dep-lp',
      'mun-lp',
      'GOVERNOR',
    );
    expect(attestationService.getAuditMatchReport).toHaveBeenCalledWith(
      'M-001',
      'election-1',
      'attested',
      'municipal',
    );
  });
});
