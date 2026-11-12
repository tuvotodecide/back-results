import { Types } from 'mongoose';

jest.mock('@/api/account', () => ({
  executeCoinbaseOp: jest.fn(),
}));

jest.mock('@/api/vote', () => ({
  VoteContractCalls: {
    deleteInstitution: jest.fn((_chain: string, id: string) => ({ fn: 'deleteInstitution', id })),
    createInstitution: jest.fn((_chain: string, id: string, admin: string) => ({
      fn: 'createInstitution',
      id,
      admin,
    })),
  },
  VoteContractReads: {
    getInstitutionAdmin: jest.fn(),
  },
}));

import { executeCoinbaseOp } from '@/api/account';
import { VoteContractReads } from '@/api/vote';
import { InstitutionalWalletMigrationService } from '@/modules/institutional-wallet-migration/services/institutional-wallet-migration.service';

const OLD_WALLET = '0x1111111111111111111111111111111111111111';
const NEW_WALLET = '0x2222222222222222222222222222222222222222';
const OTHER_WALLET = '0x3333333333333333333333333333333333333333';
const SECONDARY_WALLET = '0x4444444444444444444444444444444444444444';
const STABLE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CUTOFF = '2026-11-01T00:00:00.000Z';

const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });

const executeCoinbaseOpMock = executeCoinbaseOp as jest.Mock;
const getInstitutionAdminMock = VoteContractReads.getInstitutionAdmin as jest.Mock;

function buildService(overrides: { cutoff?: string } = {}) {
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    endSession: jest.fn(),
  };
  const migrationModel: any = {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    find: jest.fn(),
    db: { startSession: jest.fn().mockResolvedValue(session) },
  };
  const tenantModel: any = { findById: jest.fn() };
  const assignmentModel: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const applicationModel: any = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
  const walletsService: any = { resolveByDni: jest.fn() };
  const auditService: any = { record: jest.fn().mockResolvedValue({}) };
  const historyService: any = { create: jest.fn().mockResolvedValue({}) };
  const config: Record<string, string> = {
    'app.blockchain.chain': 'base-sepolia',
    'app.blockchain.privateKey': '0xabc',
    'app.institutionalWalletMigration.cutoff': overrides.cutoff ?? CUTOFF,
  };
  const configService: any = { get: jest.fn((key: string) => config[key]) };

  const service = new InstitutionalWalletMigrationService(
    migrationModel,
    tenantModel,
    assignmentModel,
    applicationModel,
    walletsService,
    auditService,
    historyService,
    configService,
  );
  return {
    service,
    migrationModel,
    tenantModel,
    assignmentModel,
    applicationModel,
    walletsService,
    auditService,
    historyService,
  };
}

function buildMigration(overrides: Record<string, any> = {}) {
  return {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    stableInstitutionId: STABLE_ID,
    assignmentId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    status: 'READY',
    previousAdminWallet: OLD_WALLET,
    newAdminWallet: NEW_WALLET,
    staleAuthorizedAddresses: [OLD_WALLET],
    txHash: null,
    attempts: 1,
    ...overrides,
  };
}

describe('InstitutionalWalletMigrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleSignIn', () => {
    it('no hace nada si la migración no está habilitada', async () => {
      const { service, assignmentModel } = buildService({ cutoff: '' });

      await expect(service.handleSignIn({ _id: new Types.ObjectId(), dni: '123456' })).resolves.toEqual([]);
      expect(assignmentModel.find).not.toHaveBeenCalled();
    });

    it('en el primer login de la admin principal crea la migración y resuelve la billetera nueva por CI', async () => {
      const ctx = buildService();
      const userId = new Types.ObjectId();
      const tenantId = new Types.ObjectId();
      const assignment = {
        _id: new Types.ObjectId(),
        tenantId,
        userId,
        accountAddress: OLD_WALLET,
        institutionalRole: 'PRIMARY',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      const created = buildMigration({
        tenantId,
        userId,
        assignmentId: assignment._id,
        status: 'AWAITING_WALLET',
        newAdminWallet: null,
        staleAuthorizedAddresses: [OLD_WALLET, SECONDARY_WALLET],
      });
      const ready = { ...created, status: 'READY', newAdminWallet: NEW_WALLET };

      ctx.assignmentModel.find
        .mockReturnValueOnce(lean([assignment]))
        .mockReturnValueOnce(
          lean([{ accountAddress: OLD_WALLET }, { accountAddress: SECONDARY_WALLET }]),
        );
      ctx.migrationModel.findOne.mockResolvedValue(null);
      ctx.tenantModel.findById.mockReturnValue(
        lean({ _id: tenantId, active: true, stableInstitutionId: STABLE_ID }),
      );
      ctx.migrationModel.create.mockResolvedValue(created);
      ctx.walletsService.resolveByDni.mockResolvedValue({ registered: true, accountAddress: NEW_WALLET });
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(ready);
      const processSpy = jest
        .spyOn(ctx.service, 'processMigration')
        .mockResolvedValue({ processed: true, status: 'CONFIRMED' } as any);

      const result = await ctx.service.handleSignIn({ _id: userId, dni: ' 123456 ' });

      expect(ctx.migrationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          stableInstitutionId: STABLE_ID,
          status: 'AWAITING_WALLET',
          previousAdminWallet: OLD_WALLET,
          staleAuthorizedAddresses: [OLD_WALLET, SECONDARY_WALLET],
        }),
      );
      expect(ctx.walletsService.resolveByDni).toHaveBeenCalledWith('123456');
      expect(ctx.migrationModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: created._id, status: 'AWAITING_WALLET' },
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'READY', newAdminWallet: NEW_WALLET }),
          $pull: { staleAuthorizedAddresses: NEW_WALLET },
        }),
        expect.anything(),
      );
      expect(processSpy).toHaveBeenCalledWith(String(created._id));
      expect(result).toEqual([
        expect.objectContaining({ tenantId: String(tenantId), status: 'READY', newAdminWallet: NEW_WALLET }),
      ]);
    });

    it('ignora administraciones creadas después del despliegue', async () => {
      const ctx = buildService();
      const assignment = {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        accountAddress: NEW_WALLET,
        createdAt: new Date('2026-11-05T00:00:00.000Z'),
      };
      ctx.assignmentModel.find.mockReturnValueOnce(lean([assignment]));
      ctx.migrationModel.findOne.mockResolvedValue(null);

      await expect(ctx.service.handleSignIn({ _id: assignment.userId, dni: '1' })).resolves.toEqual([]);
      expect(ctx.migrationModel.create).not.toHaveBeenCalled();
      expect(ctx.walletsService.resolveByDni).not.toHaveBeenCalled();
    });

    it('queda esperando si Identity todavía no tiene billetera para el CI', async () => {
      const ctx = buildService();
      const migration = buildMigration({ status: 'AWAITING_WALLET', newAdminWallet: null });
      const assignment = {
        _id: migration.assignmentId,
        tenantId: migration.tenantId,
        userId: migration.userId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      ctx.assignmentModel.find.mockReturnValueOnce(lean([assignment]));
      ctx.migrationModel.findOne.mockResolvedValue(migration);
      ctx.walletsService.resolveByDni.mockResolvedValue({
        registered: false,
        accountAddress: null,
        reason: 'WALLET_NOT_FOUND',
        message: 'La persona debe crear o registrar primero su billetera en Tu Voto Decide.',
      });
      ctx.migrationModel.findById.mockResolvedValue({
        ...migration,
        lastError: 'La persona debe crear o registrar primero su billetera en Tu Voto Decide.',
      });
      const processSpy = jest.spyOn(ctx.service, 'processMigration');

      const result = await ctx.service.handleSignIn({ _id: migration.userId, dni: '123456' });

      expect(ctx.migrationModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(processSpy).not.toHaveBeenCalled();
      expect(result).toEqual([
        expect.objectContaining({
          status: 'AWAITING_WALLET',
          message: 'La persona debe crear o registrar primero su billetera en Tu Voto Decide.',
        }),
      ]);
    });

    it('no rompe el login si Identity falla', async () => {
      const ctx = buildService();
      const migration = buildMigration({ status: 'AWAITING_WALLET', newAdminWallet: null });
      ctx.assignmentModel.find.mockReturnValueOnce(
        lean([{ _id: migration.assignmentId, tenantId: migration.tenantId, userId: migration.userId }]),
      );
      ctx.migrationModel.findOne.mockResolvedValue(migration);
      ctx.walletsService.resolveByDni.mockRejectedValue(new Error('Identity no está disponible'));

      await expect(ctx.service.handleSignIn({ _id: migration.userId, dni: '123456' })).resolves.toEqual([]);
    });
  });

  describe('getGateForUser', () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const requester = { sub: String(userId), dni: '123456', tenantId: String(tenantId) };
    const beforeCutoff = new Date('2026-01-01T00:00:00.000Z');

    it('no bloquea si la migración está deshabilitada', async () => {
      const ctx = buildService({ cutoff: '' });
      ctx.assignmentModel.findOne.mockReturnValue(
        lean({ _id: new Types.ObjectId(), tenantId, userId, institutionalRole: 'PRIMARY' }),
      );

      await expect(ctx.service.getGateForUser(requester)).resolves.toEqual(
        expect.objectContaining({ blocking: false, reason: 'NONE' }),
      );
      expect(ctx.migrationModel.findOne).not.toHaveBeenCalled();
    });

    it('rechaza a quien no pertenece a la institución', async () => {
      const ctx = buildService();
      ctx.assignmentModel.findOne.mockReturnValue(lean(null));

      await expect(ctx.service.getGateForUser(requester)).rejects.toThrow(
        'No autorizado para consultar esta institución',
      );
    });

    it('bloquea a la admin principal mientras Identity no tenga su billetera nueva y reintenta al consultar', async () => {
      const ctx = buildService();
      const assignment = { _id: new Types.ObjectId(), tenantId, userId, institutionalRole: 'PRIMARY', createdAt: beforeCutoff };
      const awaiting = buildMigration({ tenantId, userId, status: 'AWAITING_WALLET', newAdminWallet: null });
      ctx.assignmentModel.findOne.mockReturnValue(lean(assignment));
      ctx.migrationModel.findOne.mockResolvedValue(awaiting);
      const prepareSpy = jest
        .spyOn(ctx.service, 'prepareForAssignment')
        .mockResolvedValue({ ...awaiting, lastError: 'Sin billetera' } as any);

      const result = await ctx.service.getGateForUser(requester);

      expect(prepareSpy).toHaveBeenCalledWith(assignment, { _id: String(userId), dni: '123456' });
      expect(result).toEqual(
        expect.objectContaining({ blocking: true, reason: 'WALLET_NOT_FOUND', institutionalRole: 'PRIMARY' }),
      );
    });

    it('bloquea mientras la re-asignación on-chain está en curso', async () => {
      const ctx = buildService();
      ctx.assignmentModel.findOne.mockReturnValue(
        lean({ _id: new Types.ObjectId(), tenantId, userId, institutionalRole: 'SECONDARY' }),
      );
      ctx.migrationModel.findOne.mockResolvedValue(buildMigration({ tenantId, status: 'RETRY_PENDING' }));

      await expect(ctx.service.getGateForUser(requester)).resolves.toEqual(
        expect.objectContaining({ blocking: true, reason: 'IN_PROGRESS' }),
      );
    });

    it('bloquea a la institución si la admin principal aún no inició sesión', async () => {
      const ctx = buildService();
      ctx.assignmentModel.findOne
        .mockReturnValueOnce(lean({ _id: new Types.ObjectId(), tenantId, userId, institutionalRole: 'SECONDARY' }))
        .mockReturnValueOnce(lean({ _id: new Types.ObjectId(), tenantId, institutionalRole: 'PRIMARY', createdAt: beforeCutoff }));
      ctx.migrationModel.findOne.mockResolvedValue(null);

      await expect(ctx.service.getGateForUser(requester)).resolves.toEqual(
        expect.objectContaining({ blocking: true, reason: 'PRIMARY_LOGIN_PENDING' }),
      );
    });

    it('no bloquea instituciones creadas después del despliegue', async () => {
      const ctx = buildService();
      ctx.assignmentModel.findOne
        .mockReturnValueOnce(lean({ _id: new Types.ObjectId(), tenantId, userId, institutionalRole: 'SECONDARY' }))
        .mockReturnValueOnce(
          lean({ _id: new Types.ObjectId(), tenantId, institutionalRole: 'PRIMARY', createdAt: new Date('2026-11-10T00:00:00.000Z') }),
        );
      ctx.migrationModel.findOne.mockResolvedValue(null);

      await expect(ctx.service.getGateForUser(requester)).resolves.toEqual(
        expect.objectContaining({ blocking: false, reason: 'NONE' }),
      );
    });

    it('desbloquea a la admin principal cuando la migración terminó', async () => {
      const ctx = buildService();
      ctx.assignmentModel.findOne.mockReturnValue(
        lean({ _id: new Types.ObjectId(), tenantId, userId, institutionalRole: 'PRIMARY', accountAddress: NEW_WALLET }),
      );
      ctx.migrationModel.findOne.mockResolvedValue(buildMigration({ tenantId, userId, status: 'CONFIRMED' }));

      await expect(ctx.service.getGateForUser(requester)).resolves.toEqual(
        expect.objectContaining({ blocking: false, reason: 'NONE', status: 'CONFIRMED' }),
      );
    });

    it('bloquea a una secundaria cuya billetera es una de las perdidas', async () => {
      const ctx = buildService();
      ctx.assignmentModel.findOne.mockReturnValue(
        lean({ _id: new Types.ObjectId(), tenantId, userId, institutionalRole: 'SECONDARY', accountAddress: SECONDARY_WALLET }),
      );
      ctx.migrationModel.findOne.mockResolvedValue(
        buildMigration({ tenantId, status: 'CONFIRMED', staleAuthorizedAddresses: [OLD_WALLET, SECONDARY_WALLET] }),
      );

      await expect(ctx.service.getGateForUser(requester)).resolves.toEqual(
        expect.objectContaining({ blocking: true, reason: 'SECONDARY_REAUTHORIZATION_REQUIRED' }),
      );
    });
  });

  describe('processMigration', () => {
    it('reutiliza el mismo id: borra y recrea la institución en una sola operación y sincroniza Mongo', async () => {
      const ctx = buildService();
      const migration = buildMigration();
      const applicationId = new Types.ObjectId();
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(migration);
      getInstitutionAdminMock.mockResolvedValueOnce(OLD_WALLET).mockResolvedValueOnce(NEW_WALLET);
      executeCoinbaseOpMock.mockResolvedValue({ txHash: '0xtx', receipt: { status: 'success' } });
      ctx.assignmentModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnValue(
          lean({ _id: migration.assignmentId, tenantId: migration.tenantId, applicationId }),
        ),
      });

      const result = await ctx.service.processMigration(String(migration._id));

      expect(result).toEqual(expect.objectContaining({ processed: true, status: 'CONFIRMED', txHash: '0xtx' }));
      expect(executeCoinbaseOpMock).toHaveBeenCalledWith(
        '0xabc',
        'base-sepolia',
        {
          calls: [
            { fn: 'deleteInstitution', id: STABLE_ID },
            { fn: 'createInstitution', id: STABLE_ID, admin: NEW_WALLET },
          ],
        },
        undefined,
        undefined,
      );
      expect(ctx.assignmentModel.updateOne).toHaveBeenCalledWith(
        { _id: migration.assignmentId },
        {
          $set: expect.objectContaining({
            accountAddress: NEW_WALLET,
            accountAddressNormalized: NEW_WALLET.toLowerCase(),
            walletVerificationSource: 'IDENTITY',
          }),
        },
        expect.anything(),
      );
      expect(ctx.applicationModel.updateOne).toHaveBeenCalledWith(
        { _id: applicationId, tenantId: migration.tenantId },
        { $set: { accountAddress: NEW_WALLET } },
        expect.anything(),
      );
      expect(ctx.migrationModel.updateOne).toHaveBeenCalledWith(
        { _id: migration._id },
        { $set: expect.objectContaining({ status: 'CONFIRMED', txHash: '0xtx' }) },
        expect.anything(),
      );
      expect(ctx.auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INSTITUTIONAL_WALLET_MIGRATED' }),
      );
      expect(ctx.historyService.create).toHaveBeenCalledWith(
        expect.objectContaining({ txHash: '0xtx', institutionId: STABLE_ID }),
      );
    });

    it('solo crea la institución si no existe en el contrato', async () => {
      const ctx = buildService();
      const migration = buildMigration();
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(migration);
      getInstitutionAdminMock
        .mockRejectedValueOnce(new Error('execution reverted: Institution does not exist'))
        .mockResolvedValueOnce(NEW_WALLET);
      executeCoinbaseOpMock.mockResolvedValue({ txHash: '0xtx', receipt: { status: 'success' } });
      ctx.assignmentModel.findOne.mockReturnValue({ session: jest.fn().mockReturnValue(lean(null)) });

      await ctx.service.processMigration(String(migration._id));

      expect(executeCoinbaseOpMock.mock.calls[0][2]).toEqual({
        calls: [{ fn: 'createInstitution', id: STABLE_ID, admin: NEW_WALLET }],
      });
    });

    it('si la billetera resuelta ya era la admin on-chain no envía transacción', async () => {
      const ctx = buildService();
      const migration = buildMigration({ previousAdminWallet: NEW_WALLET });
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(migration);
      getInstitutionAdminMock.mockResolvedValueOnce(NEW_WALLET);
      ctx.assignmentModel.findOne.mockReturnValue({ session: jest.fn().mockReturnValue(lean(null)) });

      const result = await ctx.service.processMigration(String(migration._id));

      expect(result).toEqual(expect.objectContaining({ status: 'NOT_REQUIRED' }));
      expect(executeCoinbaseOpMock).not.toHaveBeenCalled();
      expect(ctx.historyService.create).not.toHaveBeenCalled();
    });

    it('confirma sin reenviar si la red ya refleja un envío anterior interrumpido', async () => {
      const ctx = buildService();
      const migration = buildMigration({ status: 'RETRY_PENDING', attempts: 2 });
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(migration);
      getInstitutionAdminMock.mockResolvedValueOnce(NEW_WALLET);
      ctx.assignmentModel.findOne.mockReturnValue({ session: jest.fn().mockReturnValue(lean(null)) });

      const result = await ctx.service.processMigration(String(migration._id));

      expect(result).toEqual(expect.objectContaining({ status: 'CONFIRMED' }));
      expect(executeCoinbaseOpMock).not.toHaveBeenCalled();
    });

    it('no reemplaza una admin on-chain distinta de la registrada', async () => {
      const ctx = buildService();
      const migration = buildMigration();
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(migration);
      getInstitutionAdminMock.mockResolvedValueOnce(OTHER_WALLET);

      const result = await ctx.service.processMigration(String(migration._id));

      expect(result).toEqual(expect.objectContaining({ status: 'NEEDS_REVIEW' }));
      expect(executeCoinbaseOpMock).not.toHaveBeenCalled();
      expect(ctx.migrationModel.updateOne).toHaveBeenCalledWith(
        { _id: migration._id },
        { $set: expect.objectContaining({ status: 'NEEDS_REVIEW' }) },
      );
    });

    it('programa un reintento si la operación falla', async () => {
      const ctx = buildService();
      const migration = buildMigration({ attempts: 2 });
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(migration);
      getInstitutionAdminMock.mockResolvedValueOnce(OLD_WALLET);
      executeCoinbaseOpMock.mockRejectedValue(new Error('bundler timeout'));

      const result = await ctx.service.processMigration(String(migration._id));

      expect(result).toEqual(expect.objectContaining({ status: 'RETRY_PENDING' }));
      expect(ctx.migrationModel.updateOne).toHaveBeenCalledWith(
        { _id: migration._id },
        {
          $set: expect.objectContaining({
            status: 'RETRY_PENDING',
            lastError: 'bundler timeout',
            lockedUntil: null,
          }),
        },
      );
    });

    it('pasa a revisión manual al agotar los intentos', async () => {
      const ctx = buildService();
      const migration = buildMigration({ attempts: 6 });
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(migration);
      getInstitutionAdminMock.mockResolvedValueOnce(OLD_WALLET);
      executeCoinbaseOpMock.mockRejectedValue(new Error('reverted'));

      const result = await ctx.service.processMigration(String(migration._id));

      expect(result).toEqual(expect.objectContaining({ status: 'NEEDS_REVIEW' }));
    });

    it('no procesa si otra instancia tiene el lock', async () => {
      const ctx = buildService();
      ctx.migrationModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(ctx.service.processMigration(String(new Types.ObjectId()))).resolves.toEqual({
        processed: false,
        reason: 'NO_CLAIMABLE_MIGRATION',
      });
      expect(getInstitutionAdminMock).not.toHaveBeenCalled();
    });
  });
});
