import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { BallotService } from '@/modules/ballot/services/ballot.service';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { ElectoralTableService } from '@/modules/geographic/services/electoral-table.service';
import { PoliticalPartyService } from '@/modules/political/services/political-party.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

const mockBallotModel = () => ({
  findOne: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  exec: jest.fn(),
});

describe('BallotService (unit)', () => {
  let service: BallotService;

  const locationSvc = {
    findOne: jest.fn(),
    findOneWithHierarchy: jest.fn(),
  };

  const tableSvc = {
    countTotal: jest.fn().mockResolvedValue(100),
    countByLocation: jest.fn().mockResolvedValue(10),
  };

  const partySvc = {
    validatePartyIds: jest.fn().mockResolvedValue(true),
  };

  const electionCfgSvc = {
    getActiveConfig: jest
      .fn()
      .mockResolvedValue({ id: '68a627c7dba4a531da8a1224' }),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BallotService,
        { provide: getModelToken(Ballot.name), useFactory: mockBallotModel },
        { provide: ElectoralLocationService, useValue: locationSvc },
        { provide: ElectoralTableService, useValue: tableSvc },
        { provide: PoliticalPartyService, useValue: partySvc },
        { provide: ElectionConfigService, useValue: electionCfgSvc },
      ],
    }).compile();

    service = moduleRef.get(BallotService);

    jest.clearAllMocks();
  });

  type TestBallotData = {
    tableCode: string;
    tableNumber: string;
    locationId: string;
    image: string;
    votes: {
      parties?: any;
      deputies?: any; 
    };
  };

  const baseData = (): TestBallotData => ({
    tableCode: '1234',
    tableNumber: '5',
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

  it('#1 rechaza suma incorrecta de votos (presidentes)', async () => {
    const data = baseData();
    data.votes.parties.partyVotes = [
      { partyId: 'libre', votes: 60 },
      { partyId: 'pdc', votes: 30 },
    ]; // suma 90 vs validVotes 100
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    partySvc.validatePartyIds.mockResolvedValue(true);

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      BadRequestException,
    );

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /no coincide/i,
    );
  });

  // TEST #2: validVotes negativo
  it('#2 rechaza validVotes negativos', async () => {
    const data = baseData();
    data.votes.parties.validVotes = -10;
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    partySvc.validatePartyIds.mockResolvedValue(true);

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /Votos válidos inválidos/i,
    );
  });

  // TEST #3: nullVotes / blankVotes negativos
  it('#3 rechaza nullVotes o blankVotes negativos', async () => {
    const data = baseData();
    data.votes.parties.nullVotes = -5;
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /Votos nulos inválidos/i,
    );

    const data2 = baseData();
    data2.votes.parties.blankVotes = -3;
    locationSvc.findOne.mockResolvedValue({ _id: data2.locationId });

    await expect((service as any).validateBallotData(data2)).rejects.toThrow(
      /Votos en blanco inválidos/i,
    );
  });

  // TEST #4: recinto no existe
  it('#4 rechaza si el recinto electoral no existe', async () => {
    const data = baseData();
    locationSvc.findOne.mockRejectedValue(new NotFoundException());

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /recinto electoral.*no existe/i,
    );
  });

  // TEST #5: partidos inválidos/inactivos
  it('#5 rechaza si los partidos no existen o están inactivos', async () => {
    const data = baseData();
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    partySvc.validatePartyIds.mockResolvedValue(false);

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /IDs de partido inválidos o inactivos/i,
    );
  });

  // TEST #6: categoría presidencial (parties) inválida
  it('#6 valida categoría "presidentes" independiente', async () => {
    const data = baseData();
    data.votes.parties.partyVotes = [
      { partyId: 'libre', votes: 50 },
      { partyId: 'pdc', votes: 30 },
    ]; // suma 80 vs 100
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    partySvc.validatePartyIds.mockResolvedValue(true);

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /presidentes/i,
    );
  });

  // TEST #7: categoría diputados inválida
  it('#7 valida la categoría "diputados" independiente', async () => {
    const data = baseData();
    // presidents OK
    data.votes.deputies = {
      validVotes: 50,
      nullVotes: 0,
      blankVotes: 0,
      partyVotes: [
        { partyId: 'libre', votes: 20 },
        { partyId: 'pdc', votes: 20 }, // suma 40 vs 50
      ],
    };
    locationSvc.findOne.mockResolvedValue({ _id: data.locationId });
    partySvc.validatePartyIds.mockResolvedValue(true);

    await expect((service as any).validateBallotData(data)).rejects.toThrow(
      /diputados/i,
    );
  });

  // TEST #8: Happy Path (no lanza)
  it('#8 acepta un acta completamente válida', async () => {
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
    partySvc.validatePartyIds.mockResolvedValue(true);
    await expect(
      (service as any).validateBallotData(data),
    ).resolves.toBeUndefined();
  });

  // TEST #9: Parser OpenSea → BallotDataFromIpfs
  it('#9 extrae correctamente metadata OpenSea', () => {
    const meta = {
      image: 'ipfs://QmImagen',
      data: {
        tableCode: '1234',
        tableNumber: '7',
        locationId: '65432',
        votes: {
          parties: {
            validVotes: 100,
            nullVotes: 1,
            blankVotes: 2,
            partyVotes: [{ partyId: 'libre', votes: 100 }],
          },
        },
      },
    };
    const out = (service as any).extractBallotData(meta);
    expect(out.tableCode).toBe('1234');
    expect(out.tableNumber).toBe('7');
    expect(out.locationId).toBe('65432');
    expect(out.image).toBe('ipfs://QmImagen');
    expect(out.votes.parties.validVotes).toBe(100);
  });

  // TEST #10: falta "data"
  it('#10 rechaza si falta campo data en metadata', () => {
    const meta = { image: 'ipfs://QmImagen' };
    expect(() => (service as any).extractBallotData(meta)).toThrow(
      /no se encontro campo data/i,
    );
  });

  // TEST #11: falta "image"
  it('#11 rechaza si falta campo image en metadata', () => {
    const meta = {
      data: { tableCode: 'X', tableNumber: '1', locationId: '1' },
    };
    expect(() => (service as any).extractBallotData(meta)).toThrow(
      /no se encontro campo image/i,
    );
  });

  // TEST #12: getMaxVersionForTable → 0 si no hay actas
  it('#12 retorna 0 si no hay versiones previas', async () => {
    const model = (service as any).ballotModel;
    model.exec.mockResolvedValue(null);
    const max = await service.getMaxVersionForTable(
      'ABC',
      '68a627c7dba4a531da8a1224' as any,
    );
    expect(max).toBe(0);
  });

  // TEST #13: getMaxVersionForTable → versión más alta
  it('#13 retorna la versión más alta existente', async () => {
    const model = (service as any).ballotModel;
    model.exec.mockResolvedValue({ version: 3 });
    const max = await service.getMaxVersionForTable(
      'ABC',
      '68a627c7dba4a531da8a1224' as any,
    );
    expect(max).toBe(3);
  });
});
