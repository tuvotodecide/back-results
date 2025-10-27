import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BallotService } from '@/modules/ballot/services/ballot.service';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { ElectoralTableService } from '@/modules/geographic/services/electoral-table.service';
import { PoliticalPartyService } from '@/modules/political/services/political-party.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

const chainFind = () => ({
  find: jest.fn().mockReturnThis(),
  findOne: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  countDocuments: jest.fn().mockResolvedValue(0),
  exec: jest.fn(),
  populate: jest.fn().mockReturnThis(),
});

const aggChain = () => ({
  aggregate: jest.fn().mockReturnValue({
    allowDiskUse: jest.fn().mockReturnValue({ exec: jest.fn() }),
  }),
});

const mkBallotModel = () => ({
  ...chainFind(),
  ...aggChain(),
  createIndexes: jest.fn().mockResolvedValue(undefined),
});

const mkTableModel = () => ({
  ...chainFind(),
  ...aggChain(),
  createIndexes: jest.fn().mockResolvedValue(undefined),
});

describe('BallotService (unit)', () => {
  let service: BallotService;

  const ballotModel = mkBallotModel();
  const tableModel = mkTableModel();

  const locationSvc = {
    findOne: jest.fn(),
    findOneWithHierarchy: jest.fn(),
    findNearestLocation: jest.fn(),
  };

  const tableSvc = {
    countTotal: jest.fn().mockResolvedValue(100),
    countByLocation: jest.fn().mockResolvedValue(10),
    findByTableCode: jest.fn(),
  };

  const partySvc = {
    validatePartyIds: jest.fn().mockResolvedValue(true),
  };

  const electionConfig = {
    getActiveConfigs: jest
      .fn()
      .mockResolvedValue([{ id: '68a627c7dba4a531da8a1224' }]),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BallotService,
        { provide: getModelToken(Ballot.name), useValue: ballotModel },
        { provide: getModelToken(ElectoralTable.name), useValue: tableModel },
        { provide: ElectoralLocationService, useValue: locationSvc },
        { provide: ElectoralTableService, useValue: tableSvc },
        { provide: PoliticalPartyService, useValue: partySvc },
        { provide: ElectionConfigService, useValue: electionConfig },
      ],
    }).compile();

    service = moduleRef.get(BallotService);
    jest.clearAllMocks();
  });

  const baseData = (): any => ({
    tableCode: '1234567',
    tableNumber: '4',
    locationId: '5071',
    image: 'ipfs://Qm...',
    votes: {
      parties: {
        validVotes: 100,
        nullVotes: 0,
        blankVotes: 0,
        partyVotes: [
          { partyId: 'libre', votes: 60 },
          { partyId: 'pdc', votes: 40 },
        ],
      },
    },
  });

  it('Suma inválida (presidentes)', async () => {
    const data = baseData();
    data.votes.parties.partyVotes = [
      { partyId: 'libre', votes: 60 },
      { partyId: 'pdc', votes: 30 },
    ];
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    tableSvc.findByTableCode.mockResolvedValue({
      electoralLocationId: data.locationId,
    });
    partySvc.validatePartyIds.mockResolvedValue(true);

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /no coincide/i,
    );
  });

  it('Votos validos negativos', async () => {
    const data = baseData();
    data.votes.parties.validVotes = -1;
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    tableSvc.findByTableCode.mockResolvedValue({
      electoralLocationId: data.locationId,
    });
    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /Votos válidos inválidos/i,
    );
  });

  it('null negativos', async () => {
    const d1 = baseData();
    d1.votes.parties.nullVotes = -1;
    const d2 = baseData();
    d2.votes.parties.blankVotes = -1;
    locationSvc.findOne.mockResolvedValue({ _id: d1.locationId });
    tableSvc.findByTableCode.mockResolvedValue({
      electoralLocationId: d1.locationId,
    });
    await expect((service as any).validateBallotData(d1)).rejects.toThrow(
      /Votos nulos inválidos/i,
    );

    locationSvc.findOne.mockResolvedValue({ _id: d2.locationId });
    tableSvc.findByTableCode.mockResolvedValue({
      electoralLocationId: d2.locationId,
    });
    await expect((service as any).validateBallotData(d2)).rejects.toThrow(
      /Votos en blanco inválidos/i,
    );
  });

  it('Recinto no existe', async () => {
    const data = baseData();
    locationSvc.findOne.mockRejectedValue(new NotFoundException());
    tableSvc.findByTableCode.mockResolvedValue({
      electoralLocationId: data.locationId,
    });
    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /recinto electoral/i,
    );
  });

  it('Partidos inválidos', async () => {
    const data = baseData();
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    tableSvc.findByTableCode.mockResolvedValue({
      electoralLocationId: data.locationId,
    });
    partySvc.validatePartyIds.mockResolvedValue(false);
    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /IDs de partido inválidos o inactivos/i,
    );
  });

  it('Categorías independientes', async () => {
    const data = baseData();
    data.votes.deputies = {
      validVotes: 50,
      nullVotes: 0,
      blankVotes: 0,
      partyVotes: [
        { partyId: 'libre', votes: 20 },
        { partyId: 'pdc', votes: 20 },
      ],
    };
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    tableSvc.findByTableCode.mockResolvedValue({
      electoralLocationId: data.locationId,
    });
    partySvc.validatePartyIds.mockResolvedValue(true);
    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /diputados/i,
    );
  });

  it('Validación ok', async () => {
    const data = baseData();
    data.votes.deputies = {
      validVotes: 50,
      nullVotes: 2,
      blankVotes: 3,
      partyVotes: [
        { partyId: 'libre', votes: 30 },
        { partyId: 'pdc', votes: 20 },
      ],
    };
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    tableSvc.findByTableCode.mockResolvedValue({
      electoralLocationId: data.locationId,
    });
    partySvc.validatePartyIds.mockResolvedValue(true);
    await expect(
      (service as any).validateBallotData(data),
    ).resolves.toBeUndefined();
  });

  it('parsea link', () => {
    const meta = {
      image: 'ipfs://img',
      data: {
        tableCode: 'T',
        tableNumber: '1',
        locationId: 'L',
        votes: {
          parties: {
            validVotes: 100,
            nullVotes: 0,
            blankVotes: 0,
            partyVotes: [{ partyId: 'libre', votes: 100 }],
          },
        },
      },
    };
    const out = (service as any).extractBallotData(meta);
    expect(out.tableCode).toBe('T');
    expect(out.votes.parties.validVotes).toBe(100);
  });

  it('extractBallotData falta data o image', () => {
    expect(() => (service as any).extractBallotData({ image: 'x' })).toThrow(
      /no se encontro campo data/i,
    );
    expect(() => (service as any).extractBallotData({ data: {} })).toThrow(
      /no se encontro campo image/i,
    );
  });

  it('getMaxVersionForTable sin actas = 0', async () => {
    (ballotModel.findOne as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    const max = await service.getMaxVersionForTable(
      'ABC',
      '68a627c7dba4a531da8a1224' as any,
    );
    expect(max).toBe(0);
  });

  it('getMaxVersionForTable retorna versión', async () => {
    (ballotModel.findOne as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ version: 3 }),
    });
    const max = await service.getMaxVersionForTable(
      'ABC',
      '68a6...1224' as any,
    );
    expect(max).toBe(3);
  });

  it('resolveElectionId múltiples activas sin id ⇒ 400', async () => {
    (service as any).electionConfigService.getActiveConfigs = jest
      .fn()
      .mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(
      (service as any).resolveElectionId(undefined, true),
    ).rejects.toThrow(/Hay varias elecciones activas; envíe electionId/i);
  });

  it('resolveElectionId sin activas (require) ⇒ 404', async () => {
    (service as any).electionConfigService.getActiveConfigs = jest
      .fn()
      .mockResolvedValue([]);
    await expect(
      (service as any).resolveElectionId(undefined, true),
    ).rejects.toThrow(/No hay configuración electoral activa/i);
  });

  it('extractCidFromUri formatos', () => {
    const f = (service as any).extractCidFromUri.bind(service);
    expect(
      f(
        'https://ipfs.io/ipfs/QmAbc1234567890123456789012345678901234567890123456789',
      ),
    ).toMatch(/^Qm/);
    expect(f('https://gateway.pinata.cloud/ipfs/bafybeigdyr...xyz')).toMatch(
      /^bafy/,
    );
    expect(() => f('https://example.com/nope')).toThrow(BadRequestException);
  });

  it('previousValidate OK', async () => {
    const meta = {
      image: 'ipfs://img',
      data: {
        tableCode: 'T',
        tableNumber: '1',
        locationId: 'L',
        votes: {
          parties: {
            validVotes: 100,
            nullVotes: 0,
            blankVotes: 0,
            partyVotes: [{ partyId: 'libre', votes: 100 }],
          },
        },
      },
    };
    jest
      .spyOn<any, any>(service as any, 'fetchFromIpfs')
      .mockResolvedValue(meta as any);
    jest
      .spyOn<any, any>(service as any, 'resolveElectionId')
      .mockResolvedValue('68a627c7dba4a531da8a1224' as any);
    jest
      .spyOn<any, any>(service as any, 'validateBallotData')
      .mockResolvedValue(undefined);
    await expect(
      service.previousValidate({ ipfsUri: 'ipfs://x' } as any),
    ).resolves.toBe(true);
  });

  it('createFromIpfs calcula versión y guarda', async () => {
    const meta = {
      image: 'ipfs://img',
      data: {
        tableCode: 'T',
        tableNumber: '1',
        locationId: 'L',
        votes: {
          parties: {
            validVotes: 1,
            nullVotes: 0,
            blankVotes: 0,
            partyVotes: [{ partyId: 'libre', votes: 1 }],
          },
        },
      },
    };
    jest
      .spyOn<any, any>(service as any, 'fetchFromIpfs')
      .mockResolvedValue(meta as any);
    jest
      .spyOn<any, any>(service as any, 'resolveElectionId')
      .mockResolvedValue('68a6...1224' as any);
    jest
      .spyOn<any, any>(service as any, 'validateBallotData')
      .mockResolvedValue(undefined);
    jest
      .spyOn<any, any>(service as any, 'getLocationDetails')
      .mockResolvedValue({
        department: 'La Paz',
        province: 'Murillo',
        municipality: 'La Paz',
        electoralSeat: 'X',
        electoralLocationName: 'Y',
        district: '1',
        zone: 'Z',
        circunscripcion: { number: 1, type: 'U', name: 'C1' },
      });
    jest
      .spyOn<any, any>(service as any, 'getMaxVersionForTable')
      .mockResolvedValue(2);
    jest
      .spyOn<any, any>(service as any, 'extractCidFromUri')
      .mockReturnValue('QmCid');

    const save = jest.fn().mockResolvedValue({ _id: 'B1' });
    (service as any).ballotModel = function (data: any) {
      return { ...data, save };
    };

    const out: any = await service.createFromIpfs({
      ipfsUri: 'ipfs://Qm',
      electionId: '68a6...1224',
    } as any);
    expect(save).toHaveBeenCalled();
    expect(out._id).toBe('B1');
  });

  it('getStats calcula completionPercentage', async () => {
    (tableSvc.countTotal as jest.Mock).mockResolvedValue(200);
    (ballotModel.countDocuments as any)
      .mockResolvedValueOnce(150)
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(0);

    const stats = await service.getStats();
    expect(stats.processedTables).toBe(170);
    expect(stats.completionPercentage).toBeCloseTo(85, 0);
  });
});
