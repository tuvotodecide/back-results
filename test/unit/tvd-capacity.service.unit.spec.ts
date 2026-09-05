jest.mock('@/api/electoralCredits', () => ({
  CreditsContractCalls: {
    liquidate: jest.fn(),
    tvdPerCredit: jest.fn(),
  },
}));

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
import { CreditsContractCalls } from '@/api/electoralCredits';
import { ConfigService } from '@nestjs/config';

const walletA = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const walletB = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const electoralCreditsAddr = getAddress(
  '0xcccccccccccccccccccccccccccccccccccccccc',
);
const CHAIN_ID = '84532';
const ONE_TVD = 10n ** 18n;

const tvdPerCreditMock = CreditsContractCalls.tvdPerCredit as jest.MockedFunction<
  typeof CreditsContractCalls.tvdPerCredit
>;

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
    chain: CHAIN_ID,
    getLiquidBalance: jest.fn(async () => '10000000000000000000'),
    getTokenDecimals: jest.fn(async () => 18),
  };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'app.contracts.electoralCredits.address'
        ? electoralCreditsAddr
        : undefined,
    ),
  };

  tvdPerCreditMock.mockResolvedValue(ONE_TVD);

  const service = new TvdCapacityService(
    configService as unknown as ConfigService,
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
    configService,
    tvdPerCredit: tvdPerCreditMock,
    tenantA,
    tenantB,
    eventId,
    padronVersionId,
  };
}

describe('TvdCapacityService', () => {
  beforeEach(() => {
    tvdPerCreditMock.mockReset();
  });

  it('TVD-PUB-P0-001 TVD-PUB-P0-002 | calcula capacidad estimada con 1 participante = 1 TVD y saldo exacto', async () => {
    const { service, blockchain } = createHarness();

    const result = await service.estimateCapacity('10', {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    expect(blockchain.getLiquidBalance).toHaveBeenCalledWith(walletA);
    expect(blockchain.getTokenDecimals).toHaveBeenCalled();
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
      usableBalanceField: 'liquidBalanceSmallestUnit',
      walletAddress: walletA,
    });
  });

  it('TVD-PUB-P0-003 | calcula faltante estimado con bigint sin usar saldos persistidos', async () => {
    const { service, blockchain } = createHarness();
    blockchain.getLiquidBalance.mockResolvedValueOnce('80000000000000000000');

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
      expect(blockchain.getLiquidBalance).not.toHaveBeenCalled();
      expect(tvdPerCreditMock).not.toHaveBeenCalled();
    },
  );

  it('propaga wallet faltante o no verificada desde la resolución institucional', async () => {
    const { service, tvdQueries, blockchain, tvdPerCredit } = createHarness();
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
    expect(blockchain.getLiquidBalance).not.toHaveBeenCalled();
    expect(tvdPerCredit).not.toHaveBeenCalled();
  });

  it('normaliza errores RPC sin exponer detalles técnicos', async () => {
    const { service, blockchain } = createHarness();
    blockchain.getLiquidBalance.mockRejectedValueOnce(
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

  it('TVD-PUB-P0-001 TVD-PUB-P0-002 TVD-PUB-P0-004 | calcula capacidad definitiva desde el padrón vigente habilitado', async () => {
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
      publicationReadiness: 'PUBLICATION_READY',
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
    blockchain.getLiquidBalance.mockResolvedValueOnce('9000000000000000000');

    const result = await service.getEventCapacity(String(eventId), {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    expect(blockchain.getLiquidBalance).toHaveBeenCalledWith(walletB);
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
    expect(blockchain.getLiquidBalance).not.toHaveBeenCalled();
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
      publicationReadiness: 'PUBLICATION_PADRON_BLOCKED',
    });
  });

  it('TVD-PUB-P0-003 TVD-PUB-P0-007 | devuelve canPublish=false para padrón vacío o saldo insuficiente sin publicar', async () => {
    const { service, eventId, padronEntryModel, blockchain } = createHarness();
    padronEntryModel.countDocuments.mockResolvedValueOnce(10);
    blockchain.getLiquidBalance.mockResolvedValueOnce('5000000000000000000');

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
      publicationReadiness: 'PUBLICATION_BALANCE_INSUFFICIENT',
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

    blockchain.getLiquidBalance.mockResolvedValueOnce('not-a-number');

    await expect(
      service.getEventCapacity(String(eventId), {
        sub: new Types.ObjectId().toHexString(),
        role: 'USER',
        active: true,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  describe('getEventCapacity | tvdPerCredit on-chain', () => {
    const requester = () => ({
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    it('lee tvdPerCredit con la chain del servicio blockchain y la dirección configurada', async () => {
      const { service, eventId, tvdPerCredit, configService } = createHarness();

      await service.getEventCapacity(String(eventId), requester());

      expect(configService.get).toHaveBeenCalledWith(
        'app.contracts.electoralCredits.address',
      );
      expect(tvdPerCredit).toHaveBeenCalledTimes(1);
      expect(tvdPerCredit).toHaveBeenCalledWith(CHAIN_ID, electoralCreditsAddr);
    });

    it('usa la tarifa on-chain en lugar de asumir 1 TVD por participante', async () => {
      const { service, eventId, padronEntryModel, blockchain, tvdPerCredit } =
        createHarness();
      // 2.5 TVD por participante.
      tvdPerCredit.mockResolvedValueOnce(2_500_000_000_000_000_000n);
      padronEntryModel.countDocuments.mockResolvedValueOnce(4);
      blockchain.getLiquidBalance.mockResolvedValueOnce('10000000000000000000');

      const result = await service.getEventCapacity(
        String(eventId),
        requester(),
      );

      expect(result).toMatchObject({
        participantCount: 4,
        tokensPerParticipant: '1',
        requiredTokens: '10',
        requiredSmallestUnit: '10000000000000000000',
        availableTokens: '10',
        missingTokens: '0',
        missingSmallestUnit: '0',
        canPublish: true,
        reasonCode: null,
        publicationReadiness: 'PUBLICATION_READY',
      });
    });

    it('reporta saldo insuficiente cuando la tarifa on-chain sube el requerimiento', async () => {
      const { service, eventId, padronEntryModel, blockchain, tvdPerCredit } =
        createHarness();
      // 3 TVD por participante.
      tvdPerCredit.mockResolvedValueOnce(3_000_000_000_000_000_000n);
      padronEntryModel.countDocuments.mockResolvedValueOnce(5);
      blockchain.getLiquidBalance.mockResolvedValueOnce('10000000000000000000');

      const result = await service.getEventCapacity(
        String(eventId),
        requester(),
      );

      expect(result).toMatchObject({
        participantCount: 5,
        requiredTokens: '15',
        availableTokens: '10',
        missingTokens: '5',
        missingSmallestUnit: '5000000000000000000',
        canPublish: false,
        reasonCode: 'INSUFFICIENT_TVD_BALANCE',
        publicationReadiness: 'PUBLICATION_BALANCE_INSUFFICIENT',
      });
    });

    it('soporta una tarifa on-chain fraccionaria sin perder precisión', async () => {
      const { service, eventId, padronEntryModel, blockchain, tvdPerCredit } =
        createHarness();
      // 0.000000000000000001 TVD por participante (1 unidad mínima).
      tvdPerCredit.mockResolvedValueOnce(1n);
      padronEntryModel.countDocuments.mockResolvedValueOnce(3);
      blockchain.getLiquidBalance.mockResolvedValueOnce('2');

      const result = await service.getEventCapacity(
        String(eventId),
        requester(),
      );

      expect(result).toMatchObject({
        participantCount: 3,
        requiredSmallestUnit: '3',
        availableSmallestUnit: '2',
        missingSmallestUnit: '1',
        requiredTokens: '0.000000000000000003',
        missingTokens: '0.000000000000000001',
        canPublish: false,
        reasonCode: 'INSUFFICIENT_TVD_BALANCE',
      });
    });

    it('permite publicar sin consumir saldo cuando la tarifa on-chain es cero', async () => {
      const { service, eventId, padronEntryModel, blockchain, tvdPerCredit } =
        createHarness();
      tvdPerCredit.mockResolvedValueOnce(0n);
      padronEntryModel.countDocuments.mockResolvedValueOnce(1000);
      blockchain.getLiquidBalance.mockResolvedValueOnce('0');

      const result = await service.getEventCapacity(
        String(eventId),
        requester(),
      );

      expect(result).toMatchObject({
        participantCount: 1000,
        requiredTokens: '0',
        requiredSmallestUnit: '0',
        missingSmallestUnit: '0',
        canPublish: true,
        reasonCode: null,
        publicationReadiness: 'PUBLICATION_READY',
      });
    });

    it('aplica la tarifa on-chain a maxOpenVoters en votación abierta sin leer el padrón', async () => {
      const {
        service,
        eventId,
        tenantA,
        votingEventModel,
        padronVersionModel,
        padronEntryModel,
        blockchain,
        tvdPerCredit,
      } = createHarness();
      votingEventModel.findById.mockReturnValueOnce(
        leanResult({
          _id: eventId,
          tenantId: tenantA,
          state: 'READY_FOR_REVIEW',
          isOpenVoting: true,
          maxOpenVoters: 300,
        }),
      );
      // 2 TVD por participante.
      tvdPerCredit.mockResolvedValueOnce(2_000_000_000_000_000_000n);
      blockchain.getLiquidBalance.mockResolvedValueOnce('600000000000000000000');

      const result = await service.getEventCapacity(
        String(eventId),
        requester(),
      );

      expect(padronVersionModel.findOne).not.toHaveBeenCalled();
      expect(padronEntryModel.countDocuments).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        participantCount: 300,
        padronVersionId: null,
        requiredTokens: '600',
        availableTokens: '600',
        missingTokens: '0',
        canPublish: true,
        reasonCode: null,
      });
    });

    it('mantiene el bloqueo por padrón aunque la tarifa on-chain deje el requerimiento en cero', async () => {
      const {
        service,
        eventId,
        padronVersionModel,
        padronImportJobModel,
        tvdPerCredit,
      } = createHarness();
      padronVersionModel.findOne.mockReturnValueOnce(leanResult(null));
      padronImportJobModel.findOne.mockReturnValueOnce(sortedLeanResult(null));
      tvdPerCredit.mockResolvedValueOnce(5_000_000_000_000_000_000n);

      const result = await service.getEventCapacity(
        String(eventId),
        requester(),
      );

      expect(result).toMatchObject({
        participantCount: 0,
        requiredTokens: '0',
        missingTokens: '0',
        canPublish: false,
        reasonCode: 'PADRON_NOT_FOUND',
        publicationReadiness: 'PUBLICATION_PADRON_BLOCKED',
      });
    });

    it('no consulta la tarifa on-chain cuando el evento es inválido o de otro tenant', async () => {
      const { service, eventId, tvdQueries, tenantB, tvdPerCredit } =
        createHarness();

      await expect(
        service.getEventCapacity('not-object-id', requester()),
      ).rejects.toBeInstanceOf(BadRequestException);

      tvdQueries.resolveMyInstitutionalWallet.mockResolvedValueOnce({
        tenantId: String(tenantB),
        assignmentId: new Types.ObjectId().toHexString(),
        userId: new Types.ObjectId().toHexString(),
        wallet: walletB,
        walletNormalized: walletB.toLowerCase(),
      });
      await expect(
        service.getEventCapacity(String(eventId), requester()),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(tvdPerCredit).not.toHaveBeenCalled();
    });

    it('no consulta la tarifa on-chain cuando el saldo no está disponible', async () => {
      const { service, eventId, blockchain, tvdPerCredit } = createHarness();
      blockchain.getLiquidBalance.mockRejectedValueOnce(
        Object.assign(new Error('rpc http://secret.local failed'), {
          code: 'TVD_RPC_UNAVAILABLE',
        }),
      );

      await expect(
        service.getEventCapacity(String(eventId), requester()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(tvdPerCredit).not.toHaveBeenCalled();
    });

    it('propaga el fallo de lectura de tvdPerCredit sin devolver una capacidad falsa', async () => {
      const { service, eventId, tvdPerCredit } = createHarness();
      tvdPerCredit.mockRejectedValueOnce(
        new Error('On-chain vote reward is not bigint'),
      );

      await expect(
        service.getEventCapacity(String(eventId), requester()),
      ).rejects.toThrow('On-chain vote reward is not bigint');
    });

  });

  describe('estimateCapacity | tvdPerCredit on-chain', () => {
    const requester = () => ({
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    });

    it('lee tvdPerCredit con la chain del servicio blockchain y la dirección configurada', async () => {
      const { service, tvdPerCredit, configService } = createHarness();

      await service.estimateCapacity('10', requester());

      expect(configService.get).toHaveBeenCalledWith(
        'app.contracts.electoralCredits.address',
      );
      expect(tvdPerCredit).toHaveBeenCalledTimes(1);
      expect(tvdPerCredit).toHaveBeenCalledWith(CHAIN_ID, electoralCreditsAddr);
    });

    it('usa la tarifa on-chain en lugar de asumir 1 TVD por participante', async () => {
      const { service, blockchain, tvdPerCredit } = createHarness();
      // 2.5 TVD por participante.
      tvdPerCredit.mockResolvedValueOnce(2_500_000_000_000_000_000n);
      blockchain.getLiquidBalance.mockResolvedValueOnce('10000000000000000000');

      const result = await service.estimateCapacity('4', requester());

      expect(result).toMatchObject({
        estimatedParticipants: '4',
        tokensPerParticipant: '1',
        estimatedRequiredTokens: '10',
        estimatedRequiredSmallestUnit: '10000000000000000000',
        availableTokens: '10',
        estimatedMissingTokens: '0',
        estimatedMissingSmallestUnit: '0',
        hasEstimatedCapacity: true,
        reasonCode: null,
      });
    });

    it('reporta saldo insuficiente cuando la tarifa on-chain sube el requerimiento', async () => {
      const { service, blockchain, tvdPerCredit } = createHarness();
      // 3 TVD por participante.
      tvdPerCredit.mockResolvedValueOnce(3_000_000_000_000_000_000n);
      blockchain.getLiquidBalance.mockResolvedValueOnce('10000000000000000000');

      const result = await service.estimateCapacity('5', requester());

      expect(result).toMatchObject({
        estimatedRequiredTokens: '15',
        availableTokens: '10',
        estimatedMissingTokens: '5',
        estimatedMissingSmallestUnit: '5000000000000000000',
        hasEstimatedCapacity: false,
        reasonCode: 'INSUFFICIENT_TVD_BALANCE',
      });
    });

    it('soporta una tarifa on-chain fraccionaria sin perder precisión', async () => {
      const { service, blockchain, tvdPerCredit } = createHarness();
      // 1 unidad mínima por participante.
      tvdPerCredit.mockResolvedValueOnce(1n);
      blockchain.getLiquidBalance.mockResolvedValueOnce('2');

      const result = await service.estimateCapacity('3', requester());

      expect(result).toMatchObject({
        estimatedRequiredSmallestUnit: '3',
        availableSmallestUnit: '2',
        estimatedMissingSmallestUnit: '1',
        estimatedRequiredTokens: '0.000000000000000003',
        estimatedMissingTokens: '0.000000000000000001',
        hasEstimatedCapacity: false,
        reasonCode: 'INSUFFICIENT_TVD_BALANCE',
      });
    });

    it('declara capacidad estimada sin saldo cuando la tarifa on-chain es cero', async () => {
      const { service, blockchain, tvdPerCredit } = createHarness();
      tvdPerCredit.mockResolvedValueOnce(0n);
      blockchain.getLiquidBalance.mockResolvedValueOnce('0');

      const result = await service.estimateCapacity('1000', requester());

      expect(result).toMatchObject({
        estimatedParticipants: '1000',
        estimatedRequiredTokens: '0',
        estimatedRequiredSmallestUnit: '0',
        estimatedMissingSmallestUnit: '0',
        hasEstimatedCapacity: true,
        reasonCode: null,
      });
    });

    it('no consulta la tarifa on-chain cuando el saldo no está disponible', async () => {
      const { service, blockchain, tvdPerCredit } = createHarness();
      blockchain.getLiquidBalance.mockRejectedValueOnce(
        Object.assign(new Error('rpc http://secret.local failed'), {
          code: 'TVD_RPC_UNAVAILABLE',
        }),
      );

      await expect(
        service.estimateCapacity('1', requester()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(tvdPerCredit).not.toHaveBeenCalled();
    });

    it('propaga el fallo de lectura de tvdPerCredit sin devolver una estimación falsa', async () => {
      const { service, tvdPerCredit } = createHarness();
      tvdPerCredit.mockRejectedValueOnce(
        new Error('On-chain vote reward is not bigint'),
      );

      await expect(service.estimateCapacity('10', requester())).rejects.toThrow(
        'On-chain vote reward is not bigint',
      );
    });
  });
});
