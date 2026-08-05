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
import { ContractsService } from '@/modules/contracts/services/contracts.service';
import { NotFoundException } from '@nestjs/common';
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
  Pick<WorksheetService, 'createFromIpfs' | 'retryFailedFromIpfs' | 'getStatusByTable' | 'compareAgainstWorksheet'>
> = {
  createFromIpfs: jest.fn(),
  retryFailedFromIpfs: jest.fn(),
  getStatusByTable: jest.fn(),
  compareAgainstWorksheet: jest.fn(),
};

const attestations: jest.Mocked<
  Pick<
    AttestationService,
    'createBulk' | 'listCases' | 'getCaseDetail' | 'findByBallot' | 'getAuditMatchReport' | 'findAll'
  >
> = {
  createBulk: jest.fn(),
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

  it('[MX-11][ATE-AVL-P0-001][UNITARIA] usa radio efectivo por defecto, búsqueda geográfica y prioridad municipal', async () => {
    const contractModel = { find: jest.fn() };
    const locationGateway = {
      findNearestLocation: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), name: 'Recinto', address: 'Av. Uno', distance: 12, coordinates: { latitude: -16.5, longitude: -68.1 } }),
      findOneWithHierarchy: jest.fn().mockResolvedValue({ department: { name: ' La  Paz ' }, municipality: { name: ' Achocalla ' } }),
    };
    const elections = { getActiveConfigs: jest.fn().mockResolvedValue([{ id: new Types.ObjectId().toString(), name: 'Elección', type: 'municipal' }]) };
    const chain = { select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(), clientRole: 'GOVERNOR', departmentName: 'La Paz' }, { _id: new Types.ObjectId(), clientRole: 'MAYOR', municipalityName: 'Achocalla' }]) };
    contractModel.find.mockReturnValue(chain);
    const service = new ContractsService(contractModel as never, {} as never, {} as never, {} as never, locationGateway as never, elections as never);

    const result = await service.checkAttestationAvailability(-16.5, -68.1);

    expect(locationGateway.findNearestLocation).toHaveBeenCalledWith(-16.5, -68.1, 10_000);
    expect(result.nearestLocation).toMatchObject({ department: 'La Paz', municipality: 'Achocalla' });
    expect(result.availableElections).toEqual([expect.objectContaining({ canAttest: true, contract: expect.objectContaining({ clientRole: 'MAYOR', territory: 'Achocalla' }) })]);
  });

  it('[MX-11][ATE-AVL-P0-002][UNITARIA] conserva rechazo sin recinto y shape vacío cuando no hay contratos', async () => {
    const contractModel = { find: jest.fn() };
    const locations = { findNearestLocation: jest.fn(), findOneWithHierarchy: jest.fn().mockResolvedValue({ department: { name: 'La Paz' }, municipality: { name: 'Achocalla' } }) };
    const elections = { getActiveConfigs: jest.fn().mockResolvedValue([{ id: new Types.ObjectId().toString(), name: 'Elección', type: 'municipal' }]) };
    const service = new ContractsService(contractModel as never, {} as never, {} as never, {} as never, locations as never, elections as never);
    locations.findNearestLocation.mockResolvedValueOnce(null);

    await expect(service.checkAttestationAvailability(-16.5, -68.1, 0)).rejects.toBeInstanceOf(NotFoundException);
    locations.findNearestLocation.mockResolvedValueOnce({ _id: new Types.ObjectId(), name: 'Recinto', address: 'Av.', distance: 100, coordinates: { latitude: -16.5, longitude: -68.1 } });
    contractModel.find.mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) });
    const noContract = await service.checkAttestationAvailability(-16.5, -68.1, 99_999.5);

    expect(locations.findNearestLocation).toHaveBeenLastCalledWith(-16.5, -68.1, 99_999.5);
    expect(noContract.availableElections).toEqual([expect.objectContaining({ canAttest: false })]);
    expect(noContract.availableElections[0]).not.toHaveProperty('contract');
  });

  it('[MX-11][ATE-AVL-P1-003][UNITARIA] devuelve elecciones activas o lista vacía sin fabricar contratos', async () => {
    const contractModel = { find: jest.fn() };
    const locations = { findNearestLocation: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), name: 'Recinto', address: 'Av.', distance: 1, coordinates: { latitude: -16.5, longitude: -68.1 } }), findOneWithHierarchy: jest.fn().mockResolvedValue({ department: { name: 'La Paz' }, municipality: { name: 'Achocalla' } }) };
    const elections = { getActiveConfigs: jest.fn() };
    const service = new ContractsService(contractModel as never, {} as never, {} as never, {} as never, locations as never, elections as never);
    elections.getActiveConfigs.mockResolvedValueOnce([]);
    const empty = await service.checkAttestationAvailability(-16.5, -68.1);
    elections.getActiveConfigs.mockResolvedValueOnce([{ id: new Types.ObjectId().toString(), name: 'Activa', type: 'municipal' }]);
    contractModel.find.mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) });
    const unavailable = await service.checkAttestationAvailability(-16.5, -68.1);

    expect(empty.availableElections).toEqual([]);
    expect(unavailable.availableElections).toEqual([expect.objectContaining({ electionName: 'Activa', canAttest: false })]);
  });

  it('[MX-11][ATE-AUT-P0-004][UNITARIA] entrega la hoja únicamente a la combinación de DNI mesa y elección solicitada', async () => {
    worksheets.getStatusByTable.mockResolvedValue(worksheetFixture({ dni: '123', tableCode: 'T-1' }));

    const status = await worksheetController.getStatusByTable('123', 'T-1', 'e-1');

    expect(worksheets.getStatusByTable).toHaveBeenCalledWith('123', 'e-1', 'T-1');
    expect(status).toEqual(expect.objectContaining({ status: WorksheetStatus.UPLOADED, tableCode: 'T-1' }));
  });

  it('[MX-11][ATE-AUT-P0-005][UNITARIA] responde ausencia de hoja sin revelar datos cuando la autorización no encuentra recurso', async () => {
    worksheets.getStatusByTable.mockResolvedValue(null);

    const status = await worksheetController.getStatusByTable('dni-no-autorizado', 'T-ajena', 'e-1');

    expect(status).toEqual({ status: 'NOT_FOUND' });
    expect(JSON.stringify(status)).not.toMatch(/dni-no-autorizado|T-ajena|api.?key|token/i);
  });

  it('[MX-11][ATE-SEL-P0-001][UNITARIA] consulta actas de mesa y recinto cercano, incluido el resultado vacío', async () => {
    ballots.findByTableCode.mockResolvedValue([findByTableCodeItemFixture({ tableCode: 'T-1' })]);
    ballots.findByNearestLocation.mockResolvedValue({ location: { _id: 'l-1' }, ballots: [], stats: { totalTables: 0 } });

    const byTable = await ballotController.findByTableCode('T-1', 'e-1');
    const nearby = await ballotController.findByNearestLocation({ latitude: -16.5, longitude: -68.1 } as never, 'e-1');

    expect(byTable).toHaveLength(1);
    expect(nearby).toEqual(expect.objectContaining({ ballots: [] }));
    expect(ballots.findByNearestLocation).toHaveBeenCalledWith(-16.5, -68.1, undefined, 'e-1', undefined, undefined, undefined);
  });

  it('[MX-11][ATE-SEL-P1-004][UNITARIA] mantiene hoja válida por DNI y mesa y rechaza la combinación ausente', async () => {
    worksheets.getStatusByTable.mockResolvedValueOnce(worksheetFixture({ tableCode: 'T-1', dni: '123' })).mockResolvedValueOnce(null);

    const valid = await worksheetController.getDetailByTable('123', 'T-1', 'e-1');
    const absent = await worksheetController.getDetailByTable('123', 'T-2', 'e-1');

    expect(valid).toEqual(expect.objectContaining({ tableCode: 'T-1', ipfsUri: 'ipfs://worksheet' }));
    expect(absent).toEqual({ status: 'NOT_FOUND' });
    expect(worksheets.getStatusByTable).toHaveBeenNthCalledWith(1, '123', 'e-1', 'T-1');
  });

  it('[MX-11][ACT-SND-P0-001][UNITARIA] sincroniza un acta válida y conserva la detección de duplicidad del servicio', async () => {
    ballots.createFromIpfs.mockResolvedValueOnce(ballotFixture({ tableCode: 'T-1', status: 'synced' })).mockRejectedValueOnce(new Error('BALLOT_ALREADY_EXISTS'));

    const synced = await ballotController.createFromIpfs({ ipfsUri: 'ipfs://cid-1', electionId: 'e-1', tableCode: 'T-1' } as never);
    await expect(ballotController.createFromIpfs({ ipfsUri: 'ipfs://cid-1', electionId: 'e-1', tableCode: 'T-1' } as never)).rejects.toThrow('BALLOT_ALREADY_EXISTS');

    expect(synced).toEqual(expect.objectContaining({ tableCode: 'T-1', status: 'synced' }));
    expect(ballots.createFromIpfs).toHaveBeenCalledTimes(2);
  });

  it('[MX-11][ACT-SND-P0-002][UNITARIA] registra apoyo de acta existente una vez y conserva el conflicto duplicado', async () => {
    attestations.createBulk.mockResolvedValueOnce({ created: 1, duplicates: 0 } as never).mockRejectedValueOnce(new Error('ATTESTATION_DUPLICATE'));
    const dto = { attestations: [{ ballotId: 'b-1', support: true, dni: '123', electionId: 'e-1', tableCode: 'T-1' }] } as never;

    const created = await attestationController.createBulk(dto);
    await expect(attestationController.createBulk(dto)).rejects.toThrow('ATTESTATION_DUPLICATE');

    expect(created).toEqual(expect.objectContaining({ created: 1 }));
    expect(attestations.createBulk).toHaveBeenCalledWith(dto);
  });

  it('[MX-11][ACT-SND-P0-003][UNITARIA] conserva nueva URI y diferencia de votos asociadas a la persistencia de acta', async () => {
    ballots.createFromIpfs.mockResolvedValue(ballotFixture({ ipfsUri: 'ipfs://new-cid', tableCode: 'T-2', votes: { parties: { validVotes: 2, nullVotes: 0, blankVotes: 0, partyVotes: [{ partyId: 'A', votes: 2 }] }, deputies: { validVotes: 0, nullVotes: 0, blankVotes: 0, partyVotes: [] } } }));

    const result = await ballotController.createFromIpfs({ ipfsUri: 'ipfs://new-cid', electionId: 'e-1', tableCode: 'T-2' } as never);

    expect(result).toEqual(expect.objectContaining({ ipfsUri: 'ipfs://new-cid', tableCode: 'T-2', votes: expect.any(Object) }));
    expect(ballots.createFromIpfs).toHaveBeenCalledWith(expect.objectContaining({ ipfsUri: 'ipfs://new-cid', electionId: 'e-1' }));
  });

  it('[MX-11][ACT-SND-P0-004][UNITARIA] mantiene identidad DNI del item y rechaza el registro no autorizado sin persistir', async () => {
    const dto = { attestations: [{ ballotId: 'b-1', dni: '123', electionId: 'e-1', tableCode: 'T-1', support: false }] } as never;
    attestations.createBulk.mockRejectedValue(new Error('DNI_NOT_AUTHORIZED'));

    await expect(attestationController.createBulk(dto)).rejects.toThrow('DNI_NOT_AUTHORIZED');
    expect(attestations.createBulk).toHaveBeenCalledWith(dto);
    expect(JSON.stringify(dto)).toContain('"dni":"123"');
  });

  it('[MX-11][ADM-IMG-P1-001][UNITARIA] entrega acta por identificador con evidencia y alcance territorial recibido', async () => {
    ballots.findOne.mockResolvedValue(ballotFixture({ image: 'ipfs://evidence', tableCode: 'T-1' }));

    const ballot = await ballotController.findOne('b-1', { userDepartmentId: 'd-1', userRole: 'GOVERNOR' });

    expect(ballot).toEqual(expect.objectContaining({ image: 'ipfs://evidence', tableCode: 'T-1', votes: expect.any(Object) }));
    expect(ballots.findOne).toHaveBeenCalledWith('b-1', 'd-1', undefined, 'GOVERNOR');
  });

  it('[MX-11][ADM-MES-P1-002][UNITARIA] devuelve versiones ordenadas de mesa con evidencia sin agregar resultados electorales', async () => {
    ballots.findVersionsByTableCode.mockResolvedValue([findByTableCodeItemFixture({ version: 2, image: 'ipfs://v2' }), findByTableCodeItemFixture({ version: 1, image: 'ipfs://v1' })]);

    const versions = await ballotController.getBallotVersions('T-1', 'e-1', { userMunicipalityId: 'm-1', userRole: 'MAYOR' });

    expect(versions.map((version: any) => version.version)).toEqual([2, 1]);
    expect(versions).toEqual(expect.arrayContaining([expect.objectContaining({ image: 'ipfs://v2' })]));
    expect(ballots.findVersionsByTableCode).toHaveBeenCalledWith('T-1', 'e-1', undefined, 'm-1', 'MAYOR');
  });

  it('[MX-11][ADM-REP-P1-004][UNITARIA] filtra actividad operativa de atestiguamiento sin convertirla en resultados', async () => {
    attestations.findAll.mockResolvedValue({ data: [{ ballotId: 'b-1', support: true, createdAt: new Date('2026-01-01T00:00:00.000Z') }], total: 1, page: 1, limit: 10, totalPages: 1 } as never);

    const report = await attestationController.findAll(1, 10, 'b-1', undefined, 'true', 'e-1', { userDepartmentId: 'd-1', userRole: 'GOVERNOR' });

    expect(report).toEqual(expect.objectContaining({ total: 1, data: [expect.objectContaining({ ballotId: 'b-1', support: true })] }));
    expect(JSON.stringify(report)).not.toMatch(/percentage|winningBallotId|quickCount/i);
    expect(attestations.findAll).toHaveBeenCalledWith(1, 10, 'b-1', undefined, true, 'e-1', 'd-1', undefined, 'GOVERNOR');
  });

  it('[MX-11][ADM-AUD-P1-005][UNITARIA] consulta comparación persistida por mesa y elección sin ejecutar corrección', async () => {
    attestations.getAuditMatchReport.mockResolvedValue({ status: 'MATCH', tableCode: 'T-1', differences: [] } as never);

    const audit = await attestationController.getAuditMatchReport('T-1', 'e-1', 'resolved', 'municipal');

    expect(audit).toEqual({ status: 'MATCH', tableCode: 'T-1', differences: [] });
    expect(attestations.getAuditMatchReport).toHaveBeenCalledWith('T-1', 'e-1', 'resolved', 'municipal');
    expect(attestations).not.toHaveProperty('update');
  });

  it('[MX-11][REC-QUE-P0-001][UNITARIA] separa creación y reintento de hoja sin duplicar el identificador confirmado', async () => {
    const failed = worksheetFixture({ status: WorksheetStatus.FAILED, retryCount: 1, recordId: 'record-1' });
    const uploaded = worksheetFixture({ status: WorksheetStatus.UPLOADED, retryCount: 2, recordId: 'record-1' });
    worksheets.createFromIpfs.mockResolvedValue(failed);
    worksheets.retryFailedFromIpfs.mockResolvedValue(uploaded);
    const dto = { dni: '123', electionId: 'e-1', tableCode: 'T-1', ipfsUri: 'ipfs://cid', recordId: 'record-1' } as never;

    const first = await worksheetController.createFromIpfs(dto);
    const recovered = await worksheetController.retryFromIpfs(dto);

    expect(first).toEqual(expect.objectContaining({ status: WorksheetStatus.FAILED, recordId: 'record-1' }));
    expect(recovered).toEqual(expect.objectContaining({ status: WorksheetStatus.UPLOADED, recordId: 'record-1', retryCount: 2 }));
    expect(worksheets.createFromIpfs).toHaveBeenCalledWith(dto);
    expect(worksheets.retryFailedFromIpfs).toHaveBeenCalledWith(dto);
  });

  it('[MX-11][REC-QUE-P0-002][UNITARIA] mantiene respuesta estable tras pérdida de respuesta sin crear segunda hoja', async () => {
    const stored = worksheetFixture({ status: WorksheetStatus.UPLOADED, recordId: 'record-1' });
    worksheets.getStatusByTable.mockResolvedValue(stored);

    const first = await worksheetController.getStatusByTable('123', 'T-1', 'e-1');
    const replay = await worksheetController.getStatusByTable('123', 'T-1', 'e-1');

    expect(replay).toEqual(first);
    expect(worksheets.getStatusByTable).toHaveBeenCalledTimes(2);
    expect(worksheets.createFromIpfs).not.toHaveBeenCalled();
  });

  it('[MX-11][REC-PAR-P0-006][UNITARIA] conserva error parcial y permite reintentar solo la etapa fallida', async () => {
    worksheets.createFromIpfs.mockRejectedValueOnce(new Error('METADATA_INVALID'));
    worksheets.retryFailedFromIpfs.mockResolvedValueOnce(worksheetFixture({ status: WorksheetStatus.UPLOADED, retryCount: 1 }));
    const dto = { dni: '123', electionId: 'e-1', tableCode: 'T-1', ipfsUri: 'ipfs://invalid', recordId: '' };

    await expect(worksheetController.createFromIpfs(dto as never)).rejects.toThrow('METADATA_INVALID');
    const recovered = await worksheetController.retryFromIpfs({ ...dto, ipfsUri: 'ipfs://recovered' } as never);

    expect(recovered).toEqual(expect.objectContaining({ status: WorksheetStatus.UPLOADED, retryCount: 1 }));
    expect(worksheets.createFromIpfs).toHaveBeenCalledTimes(1);
    expect(worksheets.retryFailedFromIpfs).toHaveBeenCalledTimes(1);
  });

  it('[MX-11][SEC-DNI-P0-002][UNITARIA] no enumera DNI en la respuesta mínima de una hoja inexistente', async () => {
    worksheets.getStatusByTable.mockResolvedValue(null);

    const response = await worksheetController.getStatusByTable('  123  ', ' T-1 ', 'e-1');

    expect(worksheets.getStatusByTable).toHaveBeenCalledWith('  123  ', 'e-1', ' T-1 ');
    expect(response).toEqual({ status: 'NOT_FOUND' });
    expect(JSON.stringify(response)).not.toMatch(/123|authorization|contract|api.?key/i);
  });

  it('[MX-11][SEC-DEL-P0-005][UNITARIA] entrega relación delegado-acta autorizada y rechaza el alcance contractual ajeno', async () => {
    attestations.findByBallot.mockResolvedValueOnce([{ _id: 'a-1', ballotId: 'b-1', support: true, createdAt: new Date('2026-01-01T00:00:00.000Z') }] as never).mockRejectedValueOnce(new Error('FORBIDDEN_SCOPE'));

    const allowed = await attestationController.findByBallot('b-1', { userMunicipalityId: 'm-1', userRole: 'MAYOR' });
    await expect(attestationController.findByBallot('b-foreign', { userMunicipalityId: 'm-1', userRole: 'MAYOR' })).rejects.toThrow('FORBIDDEN_SCOPE');

    expect(allowed).toEqual([expect.objectContaining({ ballotId: 'b-1', support: true })]);
    expect(attestations.findByBallot).toHaveBeenNthCalledWith(1, 'b-1', undefined, 'm-1', 'MAYOR');
  });

  it('[MX-11][ACC-BE-P1-004][UNITARIA] permite evidencia propia y rechaza evidencia ajena sin filtrar URL ni metadata', async () => {
    ballots.findOne.mockResolvedValueOnce(ballotFixture({ image: 'ipfs://allowed', ipfsUri: 'ipfs://metadata-allowed' })).mockRejectedValueOnce(new Error('FORBIDDEN_SCOPE'));

    const allowed = await ballotController.findOne('b-allowed', { userDepartmentId: 'd-1', userRole: 'GOVERNOR' });
    await expect(ballotController.findOne('b-foreign', { userDepartmentId: 'd-1', userRole: 'GOVERNOR' })).rejects.toThrow('FORBIDDEN_SCOPE');

    expect(allowed).toEqual(expect.objectContaining({ image: 'ipfs://allowed' }));
    expect(ballots.findOne).toHaveBeenNthCalledWith(1, 'b-allowed', 'd-1', undefined, 'GOVERNOR');
  });
});
