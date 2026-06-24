import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ClientReportsService } from '@/modules/contracts/services/client-reports.service';

const chainLean = <T>(value: T) => ({
  lean: jest.fn().mockResolvedValue(value),
});

const chainLeanExec = <T>(value: T) => ({
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('ClientReportsService (unit)', () => {
  let contractModel: any;
  let delegateModel: any;
  let attestationModel: any;
  let ballotModel: any;
  let ballotComparisonModel: any;
  let service: ClientReportsService;

  const contractId = new Types.ObjectId();
  const electionId = new Types.ObjectId();
  const delegateUserId = new Types.ObjectId();
  const ballotId = new Types.ObjectId();
  const contract = {
    _id: contractId,
    clientRole: 'GOVERNOR',
    departmentName: 'La Paz',
    municipalityName: null,
  };
  const delegates = [
    {
      _id: new Types.ObjectId(),
      dni: '123456',
      name: 'Delegada La Paz',
      phone: '70000001',
      email: 'delegada@example.com',
      userId: delegateUserId,
    },
  ];
  const rows = [
    {
      dni: '123456',
      userId: delegateUserId,
      ballotId,
      tableCode: 'LP-001',
      tableNumber: '1',
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      support: true,
      location: {
        department: 'La Paz',
        municipality: 'Achocalla',
        electoralLocationName: 'Unidad Educativa Central',
      },
    },
    {
      dni: '123456',
      userId: delegateUserId,
      ballotId,
      tableCode: 'LP-002',
      tableNumber: '2',
      createdAt: new Date('2026-01-01T10:05:00.000Z'),
      support: false,
      location: {
        department: 'La Paz',
        municipality: 'Achocalla',
        electoralLocationName: 'Unidad Educativa Central',
      },
    },
  ];

  beforeEach(() => {
    contractModel = { findById: jest.fn() };
    delegateModel = { find: jest.fn(), countDocuments: jest.fn() };
    attestationModel = { aggregate: jest.fn() };
    ballotModel = {};
    ballotComparisonModel = { find: jest.fn() };
    service = new ClientReportsService(
      contractModel,
      delegateModel,
      attestationModel,
      ballotModel,
      ballotComparisonModel,
    );
  });

  it('delegate-activity agrupa por delegado, recinto y mesa con totales actuales', async () => {
    contractModel.findById.mockReturnValue(chainLean(contract));
    delegateModel.find.mockReturnValue(chainLean(delegates));
    attestationModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(rows),
    });

    const byDelegate = await service.getDelegateActivityReport({
      contractId: contractId.toString(),
      electionId: electionId.toString(),
      groupBy: 'delegate',
    });
    expect(byDelegate).toEqual(
      expect.objectContaining({
        groupBy: 'delegate',
        totalDelegates: 1,
        activeDelegates: 1,
      }),
    );
    expect(byDelegate.data[0]).toEqual(
      expect.objectContaining({
        dni: '123456',
        totalAttestations: 2,
        support: 1,
        against: 1,
        tablesCount: 2,
        locationsCount: 1,
      }),
    );

    const byLocation = await service.getDelegateActivityReport({
      contractId: contractId.toString(),
      electionId: electionId.toString(),
      groupBy: 'location',
    });
    expect(byLocation).toEqual(
      expect.objectContaining({
        groupBy: 'location',
        totalLocations: 1,
      }),
    );
    expect(byLocation.data[0]).toEqual(
      expect.objectContaining({
        location: 'Unidad Educativa Central',
        totalAttestations: 2,
        delegatesCount: 1,
        tablesCount: 2,
      }),
    );

    const byTable = await service.getDelegateActivityReport({
      contractId: contractId.toString(),
      electionId: electionId.toString(),
      groupBy: 'table',
    });
    expect(byTable).toEqual(
      expect.objectContaining({
        groupBy: 'table',
        totalTables: 2,
      }),
    );
    expect(byTable.data.map((item: any) => item.tableCode).sort()).toEqual([
      'LP-001',
      'LP-002',
    ]);
  });

  it('delegate-activity documenta empty state con contrato vigente sin actividad', async () => {
    contractModel.findById.mockReturnValue(chainLean(contract));
    delegateModel.find.mockReturnValue(chainLean(delegates));
    attestationModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });

    const report = await service.getDelegateActivityReport({
      contractId: contractId.toString(),
      electionId: electionId.toString(),
    });

    expect(report).toEqual(
      expect.objectContaining({
        groupBy: 'delegate',
        totalDelegates: 1,
        activeDelegates: 0,
      }),
    );
    expect(report.data[0]).toEqual(
      expect.objectContaining({
        dni: '123456',
        totalAttestations: 0,
        tablesCount: 0,
        locationsCount: 0,
      }),
    );
  });

  it('executive-summary calcula metricas con y sin actividad', async () => {
    contractModel.findById.mockReturnValue(chainLean(contract));
    delegateModel.countDocuments.mockResolvedValue(1);
    delegateModel.find.mockReturnValue(chainLean(delegates));
    attestationModel.aggregate.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(rows),
    });

    const summary = await service.getExecutiveSummary({
      contractId: contractId.toString(),
      electionId: electionId.toString(),
    });

    expect(summary.summary).toEqual(
      expect.objectContaining({
        totalDelegatesAuthorized: 1,
        activeDelegates: 1,
        participationRate: '100.00%',
        totalAttestations: 2,
        uniqueTablesAttested: 2,
        uniqueLocationsAttested: 1,
        avgAttestationsPerDelegate: '2.00',
      }),
    );

    attestationModel.aggregate.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue([]),
    });

    const empty = await service.getExecutiveSummary({
      contractId: contractId.toString(),
      electionId: electionId.toString(),
    });

    expect(empty.summary).toEqual(
      expect.objectContaining({
        activeDelegates: 0,
        participationRate: '0.00%',
        totalAttestations: 0,
        avgAttestationsPerDelegate: '0',
      }),
    );
  });

  it('audit-match resume MATCH, MISMATCH y PENDING con filtros actuales', async () => {
    const secondBallotId = new Types.ObjectId();
    const pendingBallotId = new Types.ObjectId();
    contractModel.findById.mockReturnValue(chainLean(contract));
    delegateModel.find.mockReturnValue(chainLean(delegates));
    attestationModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          ...rows[0],
          ballotId,
          version: 1,
          delegateName: 'Delegada La Paz',
          delegateDni: '123456',
        },
        {
          ...rows[1],
          ballotId: secondBallotId,
          tableCode: 'LP-002',
          version: 1,
          delegateName: 'Delegada La Paz',
          delegateDni: '123456',
        },
        {
          ...rows[1],
          ballotId: pendingBallotId,
          tableCode: 'LP-003',
          version: 1,
          delegateName: 'Delegada La Paz',
          delegateDni: '123456',
        },
      ]),
    });
    ballotComparisonModel.find.mockReturnValue(
      chainLeanExec([
        { ballotId, status: 'MATCH', comparedAt: new Date(), mismatches: [] },
        {
          ballotId: secondBallotId,
          status: 'MISMATCH',
          comparedAt: new Date(),
          mismatches: [{ field: 'votes' }],
        },
      ]),
    );

    const report = await service.getAuditMatchReport({
      contractId: contractId.toString(),
      electionId: electionId.toString(),
      department: 'La Paz',
    });

    expect(report).toEqual(
      expect.objectContaining({
        observados: 1,
        sinObservaciones: 1,
        pendientes: 1,
        total: 3,
      }),
    );
    expect(report.details.map((item: any) => item.auditoria).sort()).toEqual([
      'No coincide',
      'Pendiente',
      'Sin Obs',
    ]);
  });

  it('lanza NotFoundException cuando el contrato de reporte no existe', async () => {
    contractModel.findById.mockReturnValue(chainLean(null));

    await expect(
      service.getExecutiveSummary({
        contractId: contractId.toString(),
        electionId: electionId.toString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
