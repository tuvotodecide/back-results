import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthService {},
}));

import { EmitVoteService } from '@/modules/institutional-voting/services/participation/emit-vote.service';
import { ParticipationService } from '@/modules/institutional-voting/services/participation/participation.service';

const resolved = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value), exec: jest.fn().mockResolvedValue(value) });

describe('MX-07 mobile vote focal unit coverage', () => {
  const eventId = new Types.ObjectId().toString();
  const nullifier = 'vote-nullifier-controlled';
  let emit: EmitVoteService;
  let writer: { castVote: jest.Mock };
  let zk: { zkRequestCallback: jest.Mock };
  let options: { findById: jest.Mock };
  let history: { create: jest.Mock };
  let voteReader: { isDniInMerkleTree: jest.Mock };
  let issuer: { getDidsByDnis: jest.Mock; issueCredential: jest.Mock };

  const proof = (scopes: unknown[] = [
    { id: 1, vp: { verifiableCredential: { credentialSubject: { eventId } } } },
    { id: 2, vp: { verifiableCredential: { credentialSubject: { nullifier } } } },
  ]) => ({ body: { scope: scopes } });

  beforeEach(() => {
    writer = { castVote: jest.fn().mockResolvedValue({ receipt: { status: 'success' }, event: 'Voted' }) };
    zk = { zkRequestCallback: jest.fn().mockResolvedValue(proof()) };
    options = { findById: jest.fn().mockReturnValue(resolved({ name: 'Frente Azul' })) };
    history = { create: jest.fn().mockResolvedValue(undefined) };
    voteReader = { isDniInMerkleTree: jest.fn() };
    issuer = { getDidsByDnis: jest.fn(), issueCredential: jest.fn() };
    emit = new EmitVoteService(
      { findOne: jest.fn() } as never,
      options as never,
      zk as never,
      writer as never,
      history as never,
      voteReader as never,
      issuer as never,
    );
  });

  it('[MX-07][VOT-ACC-P0-002][UNITARIA] resuelve cada bloqueo sin habilitar emisión', async () => {
    const models = {
      version: { findOne: jest.fn().mockReturnValue(resolved(null)) }, entry: { findOne: jest.fn().mockReturnValue(resolved(null)) }, report: { exists: jest.fn() }, participation: { findOne: jest.fn().mockReturnValue(resolved(null)) },
    };
    const access = { getEventOrThrow: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(eventId), state: 'PUBLISHED', votingStart: new Date(Date.now() - 1_000), votingEnd: new Date(Date.now() + 1_000) }) };
    const service = new ParticipationService(models.version as never, models.entry as never, models.report as never, models.participation as never, access as never);
    await expect(service.checkParticipationStatus(eventId, 'ABC-789')).resolves.toMatchObject({ status: 'PADRON_NOT_AVAILABLE', canVote: false });
    models.version.findOne.mockReturnValue(resolved({ _id: new Types.ObjectId() }));
    models.report.exists.mockResolvedValue(false);
    await expect(service.checkParticipationStatus(eventId, 'ABC-789')).resolves.toMatchObject({ status: 'ROLL_IN_VALIDATION', canVote: false });
    models.report.exists.mockResolvedValue(true);
    models.entry.findOne.mockReturnValue(resolved(null));
    await expect(service.checkParticipationStatus(eventId, 'ABC-789')).resolves.toMatchObject({ status: 'NOT_IN_ROLL', canVote: false });
    models.entry.findOne.mockReturnValue(resolved({ enabled: false }));
    await expect(service.checkParticipationStatus(eventId, 'ABC-789')).resolves.toMatchObject({ status: 'VOTER_DISABLED', canVote: false });
    access.getEventOrThrow.mockResolvedValueOnce({ _id: new Types.ObjectId(eventId), state: 'DRAFT' });
    await expect(service.checkParticipationStatus(eventId, 'ABC-789')).resolves.toMatchObject({ status: 'EVENT_NOT_PUBLISHED', canVote: false });
  });

  it('[MX-07][VOT-SEL-P0-002][UNITARIA] traduce blank a BLANK antes del writer', async () => {
    await emit.emitVote('blank', 'controlled-proof');
    expect(writer.castVote).toHaveBeenCalledWith(eventId, 'BLANK', nullifier);
    expect(options.findById).not.toHaveBeenCalled();
  });

  it('[MX-07][VOT-PRE-P0-003][UNITARIA] extrae evento y nullifier únicamente de una proof válida', async () => {
    await emit.emitVote('blank', 'controlled-proof');
    expect(zk.zkRequestCallback).toHaveBeenCalledWith('vote', 'controlled-proof');
    expect(writer.castVote).toHaveBeenCalledWith(eventId, 'BLANK', nullifier);
    zk.zkRequestCallback.mockResolvedValueOnce(proof([{ id: 1, vp: { verifiableCredential: { credentialSubject: { eventId } } } }]));
    await expect(emit.emitVote('blank', 'incomplete-proof')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('[MX-07][VOT-PRE-P0-004][UNITARIA] resuelve la opción real solo después de validar la proof', async () => {
    await emit.emitVote('option-id', 'controlled-proof');
    expect(options.findById).toHaveBeenCalledWith('option-id');
    expect(writer.castVote).toHaveBeenCalledWith(eventId, 'Frente Azul', nullifier);
    options.findById.mockReturnValueOnce(resolved(null));
    await expect(emit.emitVote('missing', 'controlled-proof')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('[MX-07][VOT-CHN-P0-001][UNITARIA] entrega al writer opción, voto y nullifier sin DNI', async () => {
    await emit.emitVote('option-id', 'controlled-proof');
    const [writtenEventId, optionName, writtenNullifier] = writer.castVote.mock.calls[0];
    expect(writtenEventId).toBe(eventId);
    expect(optionName).toBe('Frente Azul');
    expect(writtenNullifier).toBe(nullifier);
    expect(JSON.stringify(writer.castVote.mock.calls[0])).not.toContain('carnet');
  });

  it('[MX-07][VOT-CHN-P0-002][UNITARIA] no declara confirmación cuando el writer rechaza evidencia revertida', async () => {
    writer.castVote.mockRejectedValueOnce(new Error('Transaction 0xtx reverted'));
    await expect(emit.emitVote('blank', 'controlled-proof')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(writer.castVote).toHaveBeenCalledTimes(1);
  });

  it('[MX-07][VOT-CHN-P0-003][UNITARIA] convierte nullifier usado y opción inexistente en errores controlados', async () => {
    writer.castVote.mockRejectedValueOnce(new Error('Nullifier already used'));
    await expect(emit.emitVote('blank', 'controlled-proof')).rejects.toThrow('This vote has already been cast');
    options.findById.mockReturnValueOnce(resolved(null));
    await expect(emit.emitVote('missing', 'controlled-proof')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('[MX-07][VOT-ERR-P0-001][UNITARIA] rechaza la segunda emisión por nullifier sin un segundo resultado', async () => {
    writer.castVote.mockRejectedValueOnce(new Error('Nullifier already used'));
    await expect(emit.emitVote('blank', 'controlled-proof')).rejects.toThrow('This vote has already been cast');
    expect(writer.castVote).toHaveBeenCalledTimes(1);
  });

  it('[MX-07][VOT-SEC-P0-001][UNITARIA] no usa carnet como clave de la opción emitida', async () => {
    await emit.emitVote('option-id', 'controlled-proof');
    expect(writer.castVote).toHaveBeenCalledWith(eventId, 'Frente Azul', nullifier);
    expect(options.findById).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(writer.castVote.mock.calls)).not.toContain('ABC789');
  });

  it('[MX-07][VOT-SEC-P0-002][UNITARIA] sanitiza fallos de proof y escritura sin exponer material sensible', async () => {
    writer.castVote.mockRejectedValueOnce(new Error('writer rejected proof=full-proof nullifier=vote-nullifier-controlled'));

    let caught: unknown;
    try {
      await emit.emitVote('blank', 'full-proof');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InternalServerErrorException);
    expect((caught as Error).message).not.toContain('full-proof');
    expect((caught as Error).message).not.toContain(nullifier);
  });
});
