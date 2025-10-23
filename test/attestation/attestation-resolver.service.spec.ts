// test/attestation/attestation-resolver.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';

import { AttestationResolverService } from '@/modules/attestation/services/attestation-resolver.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

// Tokens de modelos (no necesitamos las clases reales, solo los tokens)
const ATTESTATION = 'Attestation';
const BALLOT = 'Ballot';
const CASE = 'AttestationCase';
const TABLE = 'ElectoralTable';

// Helper: simula find().lean().exec() o find().exec()
const chain = (data: any) => ({
  lean: () => ({ exec: jest.fn().mockResolvedValue(data) }),
  exec: jest.fn().mockResolvedValue(data),
});

describe('AttestationResolverService (unit) – reglas de consenso', () => {
  const eId = new Types.ObjectId();
  const table = 'ABC123';
  const b1 = new Types.ObjectId();
  const b2 = new Types.ObjectId();
  const b3 = new Types.ObjectId();

  let svc: AttestationResolverService;

  // Mocks de modelos
  const attModel = { aggregate: jest.fn(), find: jest.fn() };
  const ballotModel = {
    find: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  const caseModel = {
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  const tableModel = { updateOne: jest.fn().mockResolvedValue({}) };

  const electionCfg = {
    getElectionStatus: jest
      .fn()
      .mockResolvedValue({ hasActiveConfig: true, isVotingPeriod: false }),
    getActiveConfig: jest.fn().mockResolvedValue({ id: eId }),
  };

  const users = (n: number, ballotId: Types.ObjectId) =>
    Array.from({ length: n }, () => ({
      ballotId,
      isJury: false,
      support: true,
    }));
  const juries = (n: number, ballotId: Types.ObjectId) =>
    Array.from({ length: n }, () => ({
      ballotId,
      isJury: true,
      support: true,
    }));

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        AttestationResolverService,
        { provide: getModelToken(ATTESTATION), useValue: attModel },
        { provide: getModelToken(BALLOT), useValue: ballotModel },
        { provide: getModelToken(CASE), useValue: caseModel },
        { provide: getModelToken(TABLE), useValue: tableModel },
        { provide: ElectionConfigService, useValue: electionCfg },
      ],
    }).compile();

    svc = mod.get(AttestationResolverService);
  });

  // ==== ESCENARIO 1: UNA SOLA ACTA ====

  // #18 CLOSED con 1 jurado (acta única)
  it('#18 CLOSED con 1 jurado (acta única)', async () => {
    ballotModel.find.mockReturnValue(chain([{ _id: b1, electionId: eId, tableCode: table }]));
    attModel.find.mockReturnValue(chain(juries(1, b1)));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'CLOSED', winningBallotId: b1 }),
      }),
      { upsert: true },
    );
    expect(ballotModel.updateMany).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      { $set: { valuable: false } },
    );
    expect(ballotModel.updateOne).toHaveBeenCalledWith(
      { _id: b1 },
      { $set: { valuable: true } },
    );
    expect(tableModel.updateOne).toHaveBeenCalledWith(
      { tableCode: table },
      { $set: { [`observedByElection.${eId.toString()}`]: false } },
      { upsert: false },
    );
  });

  // #19 CLOSED con 3+ usuarios y 0 jurados (acta única)
  it('#19 CLOSED con ≥3 usuarios y 0 jurados (acta única)', async () => {
    ballotModel.find.mockReturnValue(chain([{ _id: b1, electionId: eId, tableCode: table }]));
    attModel.find.mockReturnValue(chain(users(3, b1)));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'CLOSED', winningBallotId: b1 }),
      }),
      { upsert: true },
    );
  });

  // #20 PENDING con 1–2 usuarios y 0 jurados (acta única)
  it('#20 PENDING con 1–2 usuarios y 0 jurados (acta única)', async () => {
    ballotModel.find.mockReturnValue(chain([{ _id: b1, electionId: eId, tableCode: table }]));
    attModel.find.mockReturnValue(chain(users(2, b1)));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'PENDING', winningBallotId: b1 }),
      }),
      { upsert: true },
    );
    expect(ballotModel.updateOne).toHaveBeenCalledWith(
      { _id: b1 },
      { $set: { valuable: true } },
    );
  });

  // #21 VERIFYING con 0 apoyos (acta única)
  it('#21 VERIFYING con 0 apoyos (acta única)', async () => {
    ballotModel.find.mockReturnValue(chain([{ _id: b1, electionId: eId, tableCode: table }]));
    attModel.find.mockReturnValue(chain([])); // no supporters

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'VERIFYING', winningBallotId: null }),
      }),
      { upsert: true },
    );
    expect(ballotModel.updateOne).not.toHaveBeenCalledWith(
      { _id: b1 },
      { $set: { valuable: true } },
    );
    expect(tableModel.updateOne).toHaveBeenCalledWith(
      { tableCode: table },
      { $set: { [`observedByElection.${eId.toString()}`]: true } },
      { upsert: false },
    );
  });

  // #22 VERIFYING con solo oposiciones (equivale a 0 supports)
  it('#22 VERIFYING si todos rechazan (solo oposiciones)', async () => {
    // El resolver hace find({ support:true }), así que si todos son support:false,
    // find() devuelve [] y cae en VERIFYING (mismo caso que #21).
    ballotModel.find.mockReturnValue(chain([{ _id: b1, electionId: eId, tableCode: table }]));
    attModel.find.mockReturnValue(chain([])); // simulación de "todos false"

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'VERIFYING', winningBallotId: null }),
      }),
      { upsert: true },
    );
  });

  // ==== ESCENARIO 2: MÚLTIPLES ACTAS ====

  // #23 VERIFYING por empate en jurados (2 actas, 1 jurado cada una)
  it('#23 VERIFYING por empate en jurados', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...juries(1, b1),
      ...juries(1, b2),
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'VERIFYING', winningBallotId: null }),
      }),
      { upsert: true },
    );
  });

  // #24 VERIFYING cuando mayoría usuarios y mayoría jurados difieren
  it('#24 VERIFYING por conflicto usuarios vs jurados', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(5, b1), // mayoría usuarios a b1
      ...juries(2, b2), // mayoría jurados a b2
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'VERIFYING', winningBallotId: null }),
      }),
      { upsert: true },
    );
  });

  // #25 CONSENSUAL cuando usuarios y jurados coinciden
  it('#25 CONSENSUAL cuando usuarios y jurados coinciden', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(5, b1),
      ...users(2, b2),
      ...juries(2, b1),
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'CONSENSUAL', winningBallotId: b1 }),
      }),
      { upsert: true },
    );
  });

  // #26 CONSENSUAL mayoría usuarios, 0 jurados (≥3)
  it('#26 CONSENSUAL con mayoría usuarios y 0 jurados', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(5, b1),
      ...users(2, b2),
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'CONSENSUAL', winningBallotId: b1 }),
      }),
      { upsert: true },
    );
  });

  // #27 VERIFYING empate usuarios y 0 jurados
  it('#27 VERIFYING empate usuarios y 0 jurados', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(3, b1),
      ...users(3, b2),
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'VERIFYING', winningBallotId: null }),
      }),
      { upsert: true },
    );
  });

  // #28 CONSENSUAL empate de usuarios, jurados deciden entre empatadas
  it('#28 CONSENSUAL: empate usuarios; jurados a una de las empatadas', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(3, b1),
      ...users(3, b2),
      ...juries(2, b1), // jurados favorecen b1 (una de las empatadas)
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'CONSENSUAL', winningBallotId: b1 }),
      }),
      { upsert: true },
    );
  });

  // #29 VERIFYING empate usuarios, jurados favorecen fuera del empate
  it('#29 VERIFYING: empate usuarios; jurados favorecen otro ballot', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
      { _id: b3, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(3, b1),
      ...users(3, b2),
      ...juries(2, b3), // jurados fuera del empate de usuarios
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'VERIFYING', winningBallotId: null }),
      }),
      { upsert: true },
    );
  });

  // #30 CONSENSUAL mayoría en usuarios Y jurados para la misma
  it('#30 CONSENSUAL mayoría usuarios y jurados en la misma acta', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
      { _id: b3, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(5, b1),
      ...users(2, b2),
      ...users(1, b3),
      ...juries(2, b1),
      ...juries(1, b3),
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'CONSENSUAL', winningBallotId: b1 }),
      }),
      { upsert: true },
    );
  });

  // #31 VERIFYING mayoría usuarios para A y mayoría jurados para B
  it('#31 VERIFYING mayoría usuarios vs mayoría jurados', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(6, b1),
      ...users(2, b2),
      ...juries(3, b2),
      ...juries(1, b1),
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'VERIFYING', winningBallotId: null }),
      }),
      { upsert: true },
    );
  });

  // #32 PENDING única con apoyos (pocos) entre múltiples actas
  it('#32 PENDING si solo una tiene 1–2 usuarios y las demás 0', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
      { _id: b3, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(2, b1), // la única con apoyos
      // b2 y b3 sin apoyos
    ]));

    await (svc as any).resolveCase(eId, table);

    expect(caseModel.updateOne).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'PENDING', winningBallotId: b1 }),
      }),
      { upsert: true },
    );
  });

  // ==== ESCENARIO 3: EFECTOS SECUNDARIOS ====

  // #33 Solo ganadora valuable=true y llamadas en orden (updateMany -> updateOne)
  it('#33 Solo ganadora valuable=true y orden de updates', async () => {
    ballotModel.find.mockReturnValue(chain([
      { _id: b1, electionId: eId, tableCode: table },
      { _id: b2, electionId: eId, tableCode: table },
      { _id: b3, electionId: eId, tableCode: table },
    ]));
    attModel.find.mockReturnValue(chain([
      ...users(4, b2), // ganadora por usuarios (sin jurados)
    ]));

    await (svc as any).resolveCase(eId, table);

    // updateMany primero…
    const idxMany = ballotModel.updateMany.mock.invocationCallOrder[0];
    const idxOne = ballotModel.updateOne.mock.invocationCallOrder[0];
    expect(idxMany).toBeLessThan(idxOne);

    // … y ganadora marcada en true
    expect(ballotModel.updateMany).toHaveBeenCalledWith(
      { electionId: eId, tableCode: table },
      { $set: { valuable: false } },
    );
    expect(ballotModel.updateOne).toHaveBeenCalledWith(
      { _id: b2 },
      { $set: { valuable: true } },
    );
  });

  // #34 observedByElection=true si VERIFYING
  it('#34 observedByElection=true si status=VERIFYING', async () => {
    ballotModel.find.mockReturnValue(chain([{ _id: b1, electionId: eId, tableCode: table }]));
    attModel.find.mockReturnValue(chain([])); // sin apoyos -> VERIFYING

    await (svc as any).resolveCase(eId, table);

    expect(tableModel.updateOne).toHaveBeenCalledWith(
      { tableCode: table },
      { $set: { [`observedByElection.${eId.toString()}`]: true } },
      { upsert: false },
    );
  });

  // #35 observedByElection=false si CONSENSUAL/CLOSED
  it('#35 observedByElection=false si status!=VERIFYING', async () => {
    ballotModel.find.mockReturnValue(chain([{ _id: b1, electionId: eId, tableCode: table }]));
    attModel.find.mockReturnValue(chain(juries(1, b1))); // CLOSED

    await (svc as any).resolveCase(eId, table);

    expect(tableModel.updateOne).toHaveBeenCalledWith(
      { tableCode: table },
      { $set: { [`observedByElection.${eId.toString()}`]: false } },
      { upsert: false },
    );
  });
});
