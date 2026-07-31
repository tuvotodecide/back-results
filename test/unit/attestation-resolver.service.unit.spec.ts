import { Types } from 'mongoose';
import { AttestationResolverService } from '@/modules/attestation/services/attestation-resolver.service';

const execResolved = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
const leanExecResolved = <T>(value: T) => ({
  lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
});

describe('AttestationResolverService (unit)', () => {
  let attModel: any;
  let ballotModel: any;
  let caseModel: any;
  let electoralTableModel: any;
  let electionConfigService: any;
  let oracleResolver: any;
  let configService: any;
  let locks: any;
  let runs: any;

  function buildService(useBlockchain = false) {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'USE_BLOCKCHAIN_RESOLVER') return useBlockchain ? 'true' : 'false';
        if (key === 'LOCK_OWNER') return 'test-owner';
        return undefined;
      }),
    };

    return new AttestationResolverService(
      attModel,
      ballotModel,
      caseModel,
      electoralTableModel,
      electionConfigService,
      oracleResolver,
      configService,
      locks,
      runs,
    );
  }

  beforeEach(() => {
    attModel = {
      aggregate: jest.fn(),
      find: jest.fn(),
    };
    ballotModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    caseModel = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    electoralTableModel = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    electionConfigService = {
      getActiveConfigs: jest.fn(),
    };
    oracleResolver = {
      getAttestEnd: jest.fn(),
      getAttestationInfo: jest.fn(),
      mapContractStatusToString: jest.fn(),
      resolveAttestations: jest.fn(),
    };
    locks = {
      tryAcquire: jest.fn(),
      peek: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };
    runs = { save: jest.fn().mockResolvedValue(undefined) };
  });

  it('[ADM-CAS-P1-003] no resuelve casos cuando no hay elecciones activas', async () => {
    electionConfigService.getActiveConfigs.mockResolvedValue([]);
    const service = buildService(false);

    await service.resolvePending();

    expect(attModel.aggregate).not.toHaveBeenCalled();
    expect(oracleResolver.resolveAttestations).not.toHaveBeenCalled();
  });

  it('[ADM-CAS-P1-003][TRA-P1-004] cierra caso off-chain con acta apoyada por jurado y fechas de resolucion', async () => {
    const electionId = new Types.ObjectId('64f000000000000000000001');
    const ballotId = new Types.ObjectId('64f000000000000000000002');
    electionConfigService.getActiveConfigs.mockResolvedValue([
      {
        id: electionId.toString(),
        name: 'Eleccion activa',
        votingEndDate: new Date(Date.now() - 60_000).toISOString(),
        resultsStartDate: new Date(Date.now() - 30_000).toISOString(),
      },
    ]);
    attModel.aggregate.mockReturnValue(
      execResolved([{ tableCode: 'A-1' }]),
    );
    caseModel.findOne.mockReturnValue(execResolved(null));
    ballotModel.find.mockReturnValue(
      execResolved([{ _id: ballotId, electionId, tableCode: 'A-1' }]),
    );
    attModel.find.mockReturnValue(
      leanExecResolved([{ ballotId, support: true, isJury: true }]),
    );

    const service = buildService(false);
    await service.resolvePending();

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId, tableCode: 'A-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'CLOSED',
          winningBallotId: ballotId,
          summary: expect.objectContaining({
            reason: 'Unanimidad (≥1 jurado o ≥3 usuarios)',
            source: 'off-chain',
          }),
        }),
      }),
      { upsert: true },
    );
    expect(ballotModel.updateOne).toHaveBeenCalledWith(
      { _id: ballotId },
      { $set: { valuable: true } },
    );
  });

  it('[REC-PAR-P0-006] respeta lock on-chain y no repite operacion contractual si no lo adquiere', async () => {
    const electionId = new Types.ObjectId('64f000000000000000000011');
    electionConfigService.getActiveConfigs.mockResolvedValue([
      {
        id: electionId.toString(),
        name: 'Eleccion on-chain',
        votingEndDate: new Date(Date.now() - 60_000).toISOString(),
        resultsStartDate: new Date(Date.now() - 30_000).toISOString(),
      },
    ]);
    attModel.aggregate.mockReturnValue(
      execResolved([{ electionId, tableCode: 'B-1' }]),
    );
    caseModel.findOne.mockReturnValue(execResolved(null));
    locks.tryAcquire.mockResolvedValue(false);
    locks.peek.mockResolvedValue({ owner: 'other', expiresAt: new Date() });

    const service = buildService(true);
    await service.resolvePending();

    expect(locks.tryAcquire).toHaveBeenCalledWith(
      `resolve:${electionId.toString()}`,
      'test-owner',
      expect.any(Number),
    );
    expect(oracleResolver.resolveAttestations).not.toHaveBeenCalled();
  });

  it('[ADM-CAS-P1-003][ACT-SND-P0-001] resuelve on-chain con lock adquirido y libera la operacion controlada', async () => {
    const electionId = new Types.ObjectId('64f000000000000000000021');
    electionConfigService.getActiveConfigs.mockResolvedValue([
      {
        id: electionId.toString(),
        name: 'Eleccion on-chain',
        votingEndDate: new Date(Date.now() - 60_000).toISOString(),
        resultsStartDate: new Date(Date.now() - 30_000).toISOString(),
      },
    ]);
    attModel.aggregate
      .mockReturnValueOnce(execResolved([{ electionId, tableCode: 'C-1' }]))
      .mockReturnValueOnce(execResolved([{ electionId, tableCode: 'C-1' }]))
      .mockReturnValueOnce(execResolved([]));
    caseModel.findOne.mockReturnValue(execResolved(null));
    locks.tryAcquire.mockResolvedValue(true);
    oracleResolver.getAttestEnd.mockResolvedValue(0);
    oracleResolver.getAttestationInfo
      .mockResolvedValueOnce({ status: 0, finalResult: 0n })
      .mockResolvedValueOnce({ status: 3, finalResult: 0n });
    oracleResolver.mapContractStatusToString
      .mockReturnValueOnce('OPEN')
      .mockReturnValueOnce('CLOSED');
    oracleResolver.resolveAttestations.mockResolvedValue({ success: true });

    const service = buildService(true);
    await service.resolvePending();

    expect(locks.tryAcquire).toHaveBeenCalled();
    expect(oracleResolver.resolveAttestations).toHaveBeenCalledWith([
      { tableCode: 'C-1', electionId: electionId.toString() },
    ]);
    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId, tableCode: 'C-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'CLOSED',
          summary: expect.objectContaining({ source: 'on-chain' }),
        }),
      }),
      { upsert: true },
    );
    expect(runs.save).toHaveBeenCalledWith(electionId.toString(), {
      lastError: null,
    });
    expect(locks.release).toHaveBeenCalledWith(
      `resolve:${electionId.toString()}`,
      'test-owner',
    );
  });

  it('[SEC-FIL-P0-003][REC-PAR-P0-006] guarda error de oracle sin filtrar secretos y libera lock', async () => {
    const electionId = new Types.ObjectId('64f000000000000000000031');
    electionConfigService.getActiveConfigs.mockResolvedValue([
      {
        id: electionId.toString(),
        name: 'Eleccion on-chain',
        votingEndDate: new Date(Date.now() - 60_000).toISOString(),
        resultsStartDate: new Date(Date.now() - 30_000).toISOString(),
      },
    ]);
    attModel.aggregate
      .mockReturnValueOnce(execResolved([{ electionId, tableCode: 'D-1' }]))
      .mockReturnValueOnce(execResolved([{ electionId, tableCode: 'D-1' }]));
    caseModel.findOne.mockReturnValue(execResolved(null));
    locks.tryAcquire.mockResolvedValue(true);
    oracleResolver.getAttestEnd.mockResolvedValue(0);
    oracleResolver.getAttestationInfo.mockResolvedValue({
      status: 0,
      finalResult: 0n,
    });
    oracleResolver.mapContractStatusToString.mockReturnValue('OPEN');
    oracleResolver.resolveAttestations.mockResolvedValue({
      success: false,
      error: 'oracle failed',
    });

    const service = buildService(true);
    await service.resolvePending();

    expect(oracleResolver.resolveAttestations).toHaveBeenCalledWith([
      { tableCode: 'D-1', electionId: electionId.toString() },
    ]);
    expect(runs.save).toHaveBeenCalledWith(electionId.toString(), {
      lastError: 'oracle failed',
    });
    expect(locks.release).toHaveBeenCalledWith(
      `resolve:${electionId.toString()}`,
      'test-owner',
    );
  });

  it('[REC-DUP-P0-004] no reprocesa caso cerrado ni duplica transicion', async () => {
    const electionId = new Types.ObjectId('64f000000000000000000041');
    electionConfigService.getActiveConfigs.mockResolvedValue([
      {
        id: electionId.toString(),
        name: 'Eleccion on-chain',
        votingEndDate: new Date(Date.now() - 60_000).toISOString(),
        resultsStartDate: new Date(Date.now() - 30_000).toISOString(),
      },
    ]);
    attModel.aggregate.mockReturnValue(
      execResolved([{ electionId, tableCode: 'E-1' }]),
    );
    caseModel.findOne.mockReturnValue(execResolved({ status: 'CLOSED' }));

    const service = buildService(true);
    await service.resolvePending();

    expect(locks.tryAcquire).not.toHaveBeenCalled();
    expect(oracleResolver.resolveAttestations).not.toHaveBeenCalled();
  });
});
