import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getAddress } from 'viem';
import { Model, Types } from 'mongoose';
import {
  PadronEntry,
  PadronEntryDocument,
} from '@/modules/institutional-voting/schemas/padron-entry.schema';
import {
  PadronImportJob,
  PadronImportJobDocument,
} from '@/modules/institutional-voting/schemas/padron-import-job.schema';
import {
  PadronVersion,
  PadronVersionDocument,
} from '@/modules/institutional-voting/schemas/padron-version.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '@/modules/institutional-voting/schemas/voting-event.schema';
import { TvdCapacityService } from '@/modules/tvd/services/tvd-capacity.service';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdQueryService } from '@/modules/tvd/services/tvd-query.service';

const walletA = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const walletB = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

type LeanQuery<T> = {
  lean: jest.Mock<Promise<T>, []>;
};

type SortLeanQuery<T> = {
  sort: jest.Mock<LeanQuery<T>, [Record<string, 1 | -1>]>;
};

function leanResult<T>(value: T): LeanQuery<T> {
  return { lean: jest.fn(async () => value) };
}

function sortedLeanResult<T>(value: T): SortLeanQuery<T> {
  return { sort: jest.fn((_sort) => leanResult(value)) };
}

function createHarness() {
  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();
  const eventId = new Types.ObjectId();
  const padronVersionId = new Types.ObjectId();

  const votingEventModel: { findById: jest.Mock } = {
    findById: jest.fn(() =>
      leanResult({
        _id: eventId,
        tenantId: tenantA,
        state: 'READY_FOR_REVIEW',
      }),
    ),
  };
  const padronVersionModel: { findOne: jest.Mock } = {
    findOne: jest.fn(() =>
      leanResult({
        _id: padronVersionId,
        eventId,
        tenantId: tenantA,
        isCurrent: true,
        totals: {
          validCount: 10,
          duplicateCount: 0,
          invalidCount: 0,
        },
      }),
    ),
  };
  const padronEntryModel: { countDocuments: jest.Mock } = {
    countDocuments: jest.fn(async () => 10),
  };
  const padronImportJobModel: { findOne: jest.Mock } = {
    findOne: jest.fn(() => sortedLeanResult(null)),
  };
  const tvdQueries = {
    resolveMyInstitutionalWallet: jest.fn(async () => ({
      tenantId: String(tenantA),
      assignmentId: new Types.ObjectId().toHexString(),
      userId: new Types.ObjectId().toHexString(),
      wallet: walletA,
      walletNormalized: walletA.toLowerCase(),
    })),
  };
  const blockchain = {
    getTotalBalance: jest.fn(async () => ({
      wallet: walletA,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '10000000000000000000',
      totalBalanceSmallestUnit: '10000000000000000000',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '10',
      totalBalanceFormatted: '10',
      isUnlocked: false,
      unlockTime: '0',
    })),
  };

  const service = new TvdCapacityService(
    votingEventModel as unknown as Model<VotingEventDocument>,
    padronVersionModel as unknown as Model<PadronVersionDocument>,
    padronEntryModel as unknown as Model<PadronEntryDocument>,
    padronImportJobModel as unknown as Model<PadronImportJobDocument>,
    tvdQueries as unknown as TvdQueryService,
    blockchain as unknown as TvdBlockchainService,
  );

  return {
    service,
    votingEventModel,
    padronVersionModel,
    padronEntryModel,
    padronImportJobModel,
    tvdQueries,
    blockchain,
    tenantA,
    tenantB,
    eventId,
    padronVersionId,
  };
}

describe('TvdCapacityService', () => {
  it('calcula capacidad estimada con 1 participante = 1 TVD y saldo exacto', async () => {
    const { service, blockchain } = createHarness();

    const result = await service.estimateCapacity('10', {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    expect(blockchain.getTotalBalance).toHaveBeenCalledWith(walletA);
    expect(result).toMatchObject({
      estimatedParticipants: '10',
      tokensPerParticipant: '1',
      estimatedRequiredTokens: '10',
      estimatedRequiredSmallestUnit: '10000000000000000000',
      availableTokens: '10',
      availableSmallestUnit: '10000000000000000000',
      estimatedMissingTokens: '0',
      estimatedMissingSmallestUnit: '0',
      hasEstimatedCapacity: true,
      reasonCode: null,
      balanceSource: 'BLOCKCHAIN',
      usableBalanceField: 'totalBalanceSmallestUnit',
      walletAddress: walletA,
    });
  });

  it('calcula faltante estimado con bigint sin usar saldos persistidos', async () => {
    const { service, blockchain } = createHarness();
    blockchain.getTotalBalance.mockResolvedValueOnce({
      wallet: walletA,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '80000000000000000000',
      totalBalanceSmallestUnit: '80000000000000000000',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '80',
      totalBalanceFormatted: '80',
      isUnlocked: false,
      unlockTime: '0',
    });

    const result = await service.estimateCapacity('100', {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    expect(result).toMatchObject({
      estimatedRequiredTokens: '100',
      availableTokens: '80',
      estimatedMissingTokens: '20',
      hasEstimatedCapacity: false,
      reasonCode: 'INSUFFICIENT_TVD_BALANCE',
    });
  });

  it.each(['', '   ', '0', '-1', '1.5', 'abc'])(
    'rechaza estimatedParticipants invalido "%s"',
    async (estimatedParticipants) => {
      const { service, blockchain } = createHarness();

      await expect(
        service.estimateCapacity(estimatedParticipants, {
          sub: new Types.ObjectId().toHexString(),
          role: 'USER',
          active: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(blockchain.getTotalBalance).not.toHaveBeenCalled();
    },
  );

  it('propaga wallet faltante o no verificada desde la resolución institucional', async () => {
    const { service, tvdQueries, blockchain } = createHarness();
    tvdQueries.resolveMyInstitutionalWallet.mockRejectedValueOnce(
      new BadRequestException({
        code: 'TVD_WALLET_REQUIRED',
        message: 'Wallet institucional requerida',
      }),
    );

    await expect(
      service.estimateCapacity('1', {
        sub: new Types.ObjectId().toHexString(),
        role: 'USER',
        active: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(blockchain.getTotalBalance).not.toHaveBeenCalled();
  });

  it('normaliza errores RPC sin exponer detalles técnicos', async () => {
    const { service, blockchain } = createHarness();
    blockchain.getTotalBalance.mockRejectedValueOnce(
      Object.assign(new Error('rpc http://secret.local failed'), {
        code: 'TVD_RPC_UNAVAILABLE',
      }),
    );

    await expect(
      service.estimateCapacity('1', {
        sub: new Types.ObjectId().toHexString(),
        role: 'USER',
        active: true,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'TVD_BALANCE_TEMPORARILY_UNAVAILABLE',
        errorCode: 'TVD_RPC_UNAVAILABLE',
      },
    });
  });

  it('calcula capacidad definitiva desde el padrón vigente habilitado', async () => {
    const { service, eventId, padronVersionId, padronEntryModel } =
      createHarness();
    padronEntryModel.countDocuments.mockResolvedValueOnce(7);

    const result = await service.getEventCapacity(String(eventId), {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    expect(padronEntryModel.countDocuments).toHaveBeenCalledWith({
      padronVersionId,
      enabled: true,
    });
    expect(result).toMatchObject({
      eventId: String(eventId),
      participantCount: 7,
      padronVersionId: String(padronVersionId),
      requiredTokens: '7',
      missingTokens: '0',
      canPublish: true,
      reasonCode: null,
    });
  });

  it('usa la wallet del usuario autenticado actual cuando otro admin valida el mismo evento', async () => {
    const { service, eventId, tvdQueries, blockchain, tenantA } = createHarness();
    tvdQueries.resolveMyInstitutionalWallet.mockResolvedValueOnce({
      tenantId: String(tenantA),
      assignmentId: new Types.ObjectId().toHexString(),
      userId: new Types.ObjectId().toHexString(),
      wallet: walletB,
      walletNormalized: walletB.toLowerCase(),
    });
    blockchain.getTotalBalance.mockResolvedValueOnce({
      wallet: walletB,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '9000000000000000000',
      totalBalanceSmallestUnit: '9000000000000000000',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '9',
      totalBalanceFormatted: '9',
      isUnlocked: false,
      unlockTime: '0',
    });

    const result = await service.getEventCapacity(String(eventId), {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    expect(blockchain.getTotalBalance).toHaveBeenCalledWith(walletB);
    expect(result.walletAddress).toBe(walletB);
    expect(result.availableTokens).toBe('9');
  });

  it('bloquea cross-tenant antes de consultar saldo on-chain', async () => {
    const { service, eventId, tvdQueries, blockchain, tenantB } = createHarness();
    tvdQueries.resolveMyInstitutionalWallet.mockResolvedValueOnce({
      tenantId: String(tenantB),
      assignmentId: new Types.ObjectId().toHexString(),
      userId: new Types.ObjectId().toHexString(),
      wallet: walletB,
      walletNormalized: walletB.toLowerCase(),
    });

    await expect(
      service.getEventCapacity(String(eventId), {
        sub: new Types.ObjectId().toHexString(),
        role: 'USER',
        active: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(blockchain.getTotalBalance).not.toHaveBeenCalled();
  });

  it('devuelve canPublish=false para padrón inexistente o en procesamiento', async () => {
    const { service, eventId, padronVersionModel, padronImportJobModel } =
      createHarness();
    padronVersionModel.findOne.mockReturnValueOnce(leanResult(null));
    padronImportJobModel.findOne.mockReturnValueOnce(
      sortedLeanResult({ status: 'PROCESSING' }),
    );

    const result = await service.getEventCapacity(String(eventId), {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    expect(result).toMatchObject({
      participantCount: 0,
      padronVersionId: null,
      requiredTokens: '0',
      canPublish: false,
      reasonCode: 'PADRON_PROCESSING',
    });
  });

  it('devuelve canPublish=false para padrón vacío o saldo insuficiente sin publicar', async () => {
    const { service, eventId, padronEntryModel, blockchain } = createHarness();
    padronEntryModel.countDocuments.mockResolvedValueOnce(10);
    blockchain.getTotalBalance.mockResolvedValueOnce({
      wallet: walletA,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '5000000000000000000',
      totalBalanceSmallestUnit: '5000000000000000000',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '5',
      totalBalanceFormatted: '5',
      isUnlocked: false,
      unlockTime: '0',
    });

    const result = await service.getEventCapacity(String(eventId), {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    expect(result).toMatchObject({
      participantCount: 10,
      requiredTokens: '10',
      availableTokens: '5',
      missingTokens: '5',
      canPublish: false,
      reasonCode: 'INSUFFICIENT_TVD_BALANCE',
    });
  });

  it('rechaza eventId inválido y respuestas blockchain inválidas con errores seguros', async () => {
    const { service, blockchain, eventId } = createHarness();

    await expect(
      service.getEventCapacity('not-object-id', {
        sub: new Types.ObjectId().toHexString(),
        role: 'USER',
        active: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    blockchain.getTotalBalance.mockResolvedValueOnce({
      wallet: walletA,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '0',
      totalBalanceSmallestUnit: 'not-a-number',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '0',
      totalBalanceFormatted: '0',
      isUnlocked: false,
      unlockTime: '0',
    });

    await expect(
      service.getEventCapacity(String(eventId), {
        sub: new Types.ObjectId().toHexString(),
        role: 'USER',
        active: true,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
