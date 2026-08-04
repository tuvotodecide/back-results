jest.mock('../../src/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: class ZkAuthGuardMock {},
}));

import { AttestationController } from '@/modules/attestation/controllers/attestation.controller';
import { AttestationService } from '@/modules/attestation/services/attestation.service';
import { BallotController } from '@/modules/ballot/controllers/ballot.controller';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { BallotService } from '@/modules/ballot/services/ballot.service';
import {
  WorksheetCompareStatus,
} from '@/modules/worksheet/dto/worksheet.dto';
import { Worksheet, WorksheetStatus } from '@/modules/worksheet/schemas/worksheet.schema';
import { WorksheetController } from '@/modules/worksheet/controllers/worksheet.controller';
import { WorksheetService } from '@/modules/worksheet/services/worksheet.service';
import { Types } from 'mongoose';

const ballotFixture = (overrides: Partial<Ballot> = {}): Ballot =>
  ({
    tableNumber: '1',
    tableCode: 'T-1',
    electionId: new Types.ObjectId(),
    electoralLocationId: new Types.ObjectId(),
    location: {
      department: 'La Paz',
      province: 'Murillo',
      municipality: 'Achocalla',
      electoralSeat: 'Seat 1',
      electoralLocationName: 'Recinto 1',
      district: 'D-1',
      zone: 'Z-1',
      circunscripcion: { number: 1, type: 'Uninominal', name: 'C-1' },
    },
    votes: {
      parties: {
        validVotes: 1,
        nullVotes: 0,
        blankVotes: 0,
        partyVotes: [{ partyId: 'party-1', votes: 1 }],
      },
    },
    ipfsUri: 'ipfs://cid',
    image: 'ipfs://image',
    status: 'processed',
    valuable: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as unknown as Ballot;

type FindByTableCodeResult = Awaited<
  ReturnType<BallotService['findByTableCode']>
>;
type FindByTableCodeItem = FindByTableCodeResult[number];

const findByTableCodeItemFixture = (
  overrides: Partial<Ballot> = {},
): FindByTableCodeItem =>
  ({
    ...ballotFixture(overrides),
    __v: 0,
  }) as unknown as FindByTableCodeItem;

const worksheetFixture = (overrides: Partial<Worksheet> = {}) =>
  ({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    dni: '123',
    electionId: new Types.ObjectId(),
    tableCode: 'T-1',
    ipfsUri: 'ipfs://worksheet',
    status: WorksheetStatus.UPLOADED,
    retryCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as unknown as Worksheet;

const casesFixture: Awaited<ReturnType<AttestationService['listCases']>> = {
  data: [],
  total: 0,
  page: 1,
  limit: 10,
  totalPages: 0,
};

const ballots: jest.Mocked<
  Pick<
    BallotService,
    | 'createFromIpfs'
    | 'previousValidate'
    | 'findByTableCode'
    | 'findByNearestLocation'
    | 'findVersionsByTableCode'
    | 'findOne'
  >
> = {
  createFromIpfs: jest.fn(),
  previousValidate: jest.fn(),
  findByTableCode: jest.fn(),
  findByNearestLocation: jest.fn(),
  findVersionsByTableCode: jest.fn(),
  findOne: jest.fn(),
};

const worksheets: jest.Mocked<
  Pick<WorksheetService, 'getStatusByTable' | 'compareAgainstWorksheet'>
> = {
  getStatusByTable: jest.fn(),
  compareAgainstWorksheet: jest.fn(),
};

const attestations: jest.Mocked<
  Pick<
    AttestationService,
    'listCases' | 'getCaseDetail' | 'findByBallot' | 'getAuditMatchReport' | 'findAll'
  >
> = {
  listCases: jest.fn(),
  getCaseDetail: jest.fn(),
  findByBallot: jest.fn(),
  getAuditMatchReport: jest.fn(),
  findAll: jest.fn(),
};

describe('MX-11 | focal UNITARIA | controllers reales con colaboradores simulados', () => {
  const ballotController = new BallotController(
    ballots as unknown as BallotService,
  );
  const worksheetController = new WorksheetController(
    worksheets as unknown as WorksheetService,
  );
  const attestationController = new AttestationController(
    attestations as unknown as AttestationService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('[MX-11][ATE-SEL-P0-002][UNITARIA] reenvía mesa elección y alcance territorial al servicio de actas', async () => {
    ballots.findByTableCode.mockResolvedValue([findByTableCodeItemFixture()]);
    const result = await ballotController.findByTableCode('T-1', 'e-1', {
      userDepartmentId: 'd-1', userRole: 'GOVERNOR',
    });
    expect(result).toEqual([expect.objectContaining({ tableCode: 'T-1' })]);
    expect(ballots.findByTableCode).toHaveBeenCalledWith('T-1', 'e-1', 'd-1', undefined, 'GOVERNOR');
  });

  it('[MX-11][ATE-SEL-P1-003][UNITARIA] entrega la validación territorial de partidos al flujo productivo de acta', async () => {
    ballots.previousValidate.mockResolvedValue(true);
    const result = await ballotController.validateBallotData({ ipfsUri: 'https://ipfs.io/ipfs/Qmtest', electionId: 'e-1' } as never);
    expect(result).toBe(true);
    expect(ballots.previousValidate).toHaveBeenCalledWith(expect.objectContaining({ electionId: 'e-1' }));
  });

  it('[MX-11][ACT-FRM-P0-001][UNITARIA] delega la estructura de votos a la validación real de acta', async () => {
    ballots.previousValidate.mockResolvedValue(true);
    await ballotController.validateBallotData({ ipfsUri: 'https://ipfs.io/ipfs/Qmvotes', electionId: 'e-1' } as never);
    expect(ballots.previousValidate).toHaveBeenCalledTimes(1);
  });

  it('[MX-11][ACT-FRM-P0-002][UNITARIA] conserva el rechazo de suma inválida entregado por BallotService', async () => {
    const error = new Error('La suma de votos por partido no coincide');
    ballots.previousValidate.mockRejectedValue(error);
    await expect(ballotController.validateBallotData({ ipfsUri: 'https://ipfs.io/ipfs/Qmsum', electionId: 'e-1' } as never)).rejects.toBe(error);
  });

  it('[MX-11][ACT-FRM-P0-003][UNITARIA] conserva hasObservation y observationText en el comando de creación', async () => {
    ballots.createFromIpfs.mockResolvedValue(
      ballotFixture({ hasObservation: true, observationText: 'sello ilegible' }),
    );
    const result = await ballotController.createFromIpfs({ ipfsUri: 'https://ipfs.io/ipfs/Qmobs', electionId: 'e-1', hasObservation: true, observationText: 'sello ilegible' } as never);
    expect(result).toEqual(expect.objectContaining({ hasObservation: true, observationText: 'sello ilegible' }));
    expect(ballots.createFromIpfs).toHaveBeenCalledWith(expect.objectContaining({ hasObservation: true, observationText: 'sello ilegible' }));
  });

  it('[MX-11][ACT-FRM-P1-004][UNITARIA] reenvía DNI mesa elección y votos al comparador de hoja', async () => {
    worksheets.compareAgainstWorksheet.mockResolvedValue({
      status: WorksheetCompareStatus.MATCH,
      differences: [],
    });
    const result = await worksheetController.compare({ dni: '123', electionId: 'e-1', tableCode: 'T-1', votes: {} } as never);
    expect(result).toEqual({ status: WorksheetCompareStatus.MATCH, differences: [] });
    expect(worksheets.compareAgainstWorksheet).toHaveBeenCalledWith(expect.objectContaining({ dni: '123', tableCode: 'T-1' }));
  });

  it('[MX-11][EVD-IPF-P0-004][UNITARIA] conserva el error seguro de metadata inválida', async () => {
    const error = new Error('Error al obtener datos de IPFS');
    ballots.createFromIpfs.mockRejectedValue(error);
    await expect(ballotController.createFromIpfs({ ipfsUri: 'https://ipfs.io/ipfs/Qmbad', electionId: 'e-1' } as never)).rejects.toBe(error);
  });

  it('[MX-11][ADM-CAS-P1-003][UNITARIA] delega estado y ubicación para listar casos', async () => {
    attestations.listCases.mockResolvedValue(casesFixture);
    const result = await attestationController.listCases(1, 10, 'PENDING', 'La Paz', undefined, 'Achocalla', 'e-1');
    expect(result).toEqual(expect.objectContaining({ data: [] }));
    expect(attestations.listCases).toHaveBeenCalledWith(1, 10, 'PENDING', 'La Paz', undefined, 'Achocalla', 'e-1', undefined, undefined, undefined);
  });

  it('[MX-11][REC-DUP-P0-003][UNITARIA] expone el estado de una hoja sin crear una segunda', async () => {
    worksheets.getStatusByTable.mockResolvedValue(
      worksheetFixture({ status: WorksheetStatus.UPLOADED }),
    );
    const result = await worksheetController.getStatusByTable('123', 'T-1', 'e-1');
    expect(result).toEqual(expect.objectContaining({ status: WorksheetStatus.UPLOADED, tableCode: 'T-1' }));
    expect(worksheets.getStatusByTable).toHaveBeenCalledWith('123', 'e-1', 'T-1');
  });

  it('[MX-11][REC-DUP-P0-004][UNITARIA] conserva el conflicto de atestiguamiento duplicado', async () => {
    const error = new Error('El usuario ya atestiguó este ballot');
    attestations.findByBallot.mockRejectedValue(error);
    await expect(attestationController.findByBallot('b-1')).rejects.toBe(error);
  });

  it('[MX-11][REC-DUP-P0-005][UNITARIA] reenvía la validación previa de votos equivalentes', async () => {
    ballots.previousValidate.mockResolvedValue(true);
    await ballotController.validateBallotData({ ipfsUri: 'https://ipfs.io/ipfs/Qmduplicate', electionId: 'e-1' } as never);
    expect(ballots.previousValidate).toHaveBeenCalledWith(expect.objectContaining({ ipfsUri: 'https://ipfs.io/ipfs/Qmduplicate' }));
  });

  it('[MX-11][SEC-ACC-P0-001][UNITARIA] no sustituye el alcance territorial recibido por filtros locales', async () => {
    ballots.findOne.mockResolvedValue(ballotFixture());
    await ballotController.findOne('b-1', { userMunicipalityId: 'm-1', userRole: 'MAYOR' });
    expect(ballots.findOne).toHaveBeenCalledWith('b-1', undefined, 'm-1', 'MAYOR');
  });

  it('[MX-11][SEC-FIL-P0-003][UNITARIA] propaga solo la respuesta sanitizada producida por el servicio', async () => {
    ballots.createFromIpfs.mockResolvedValue(ballotFixture());
    const result = await ballotController.createFromIpfs({ ipfsUri: 'https://ipfs.io/ipfs/Qmsecure', electionId: 'e-1' } as never);
    expect(result).toEqual(expect.objectContaining({ ipfsUri: 'ipfs://cid', image: 'ipfs://image' }));
  });

  it('[MX-11][TRA-P1-004][UNITARIA] conserva timestamps devueltos por el registro de acta', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    ballots.createFromIpfs.mockResolvedValue(
      ballotFixture({ createdAt, updatedAt: createdAt }),
    );
    const result = await ballotController.createFromIpfs({ ipfsUri: 'https://ipfs.io/ipfs/Qmtime', electionId: 'e-1' } as never);
    expect(result).toEqual(expect.objectContaining({ createdAt, updatedAt: createdAt }));
  });
});
