import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { HistoryOperationKey } from '@/modules/history/dto/create-history.dto';
import { TvdAdminOperationsQueryDto } from '@/modules/tvd/dto/tvd-query.dto';
import { TvdQueryService } from '@/modules/tvd/services/tvd-query.service';
import {
  TvdAdminOperationStatus,
  TvdAdminOperationType,
} from '@/modules/tvd/types/tvd-admin-operations.types';

type QueryMock<T> = {
  sort: jest.Mock<QueryMock<T>, [Record<string, unknown>]>;
  limit: jest.Mock<QueryMock<T>, [number]>;
  lean: jest.Mock<Promise<T>, []>;
};

const adminRequester = {
  sub: new Types.ObjectId().toString(),
  role: 'ADMIN',
  active: true,
};

const createQuery = <T>(value: T): QueryMock<T> => {
  const query = {
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn().mockResolvedValue(value),
  } as unknown as QueryMock<T>;
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
};

const createLeanQuery = <T>(value: T) => ({
  lean: jest.fn().mockResolvedValue(value),
});

const fixedDate = (day: number) =>
  new Date(Date.UTC(2026, 6, day, 12, 0, 0));

const query = (
  overrides: Partial<TvdAdminOperationsQueryDto> = {},
): TvdAdminOperationsQueryDto => ({
  page: 1,
  limit: 20,
  ...overrides,
});

const createAccreditation = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  sourceType: 'MANUAL_GRANT',
  sourceId: new Types.ObjectId().toString(),
  tenantId: overrides.tenantId,
  targetAssignmentId: new Types.ObjectId(),
  targetWallet: '0x1111111111111111111111111111111111111111',
  tokenAmount: '1',
  tokenAmountSmallestUnit: '1000000000000000000',
  status: 'CONFIRMED',
  txHash: '0xaccreditation',
  createdBy: new Types.ObjectId(),
  createdAt: fixedDate(20),
  updatedAt: fixedDate(20),
  ...overrides,
});

const createHistory = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  txHash: '0xhistory',
  operationName: HistoryOperationKey.castVote,
  type: 'automated',
  institutionId: overrides.institutionId,
  registerDate: fixedDate(19),
  ...overrides,
});

const createService = () => {
  const tenantA = {
    _id: new Types.ObjectId(),
    name: 'Universidad Mayor de San Andrés',
    active: true,
  };
  const tenantB = {
    _id: new Types.ObjectId(),
    name: 'Municipio de La Paz',
    active: true,
  };

  const accreditationModel = {
    find: jest.fn().mockReturnValue(createQuery([])),
  };
  const historyModel = {
    find: jest.fn().mockReturnValue(createQuery([])),
  };
  const tenantModel = {
    find: jest.fn().mockReturnValue(createLeanQuery([tenantA, tenantB])),
    findById: jest.fn().mockReturnValue(createLeanQuery(tenantA)),
  };
  const historyService = {
    getRelatedAmounts: jest.fn(async (items: any[]) =>
      items.map((item) => ({
        ...item,
        relatedAmount: item.relatedAmount ?? '1.25',
      })),
    ),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'app.tvd.decimals') return '18';
      if (key === 'app.blockchain.chain') return 'base-sepolia';
      return undefined;
    }),
  };

  const service = new TvdQueryService(
    accreditationModel as any,
    historyModel as any,
    {} as any,
    tenantModel as any,
    {} as any,
    {} as any,
    {} as any,
    historyService as any,
    configService as any,
  );

  return {
    accreditationModel,
    configService,
    historyModel,
    historyService,
    service,
    tenantA,
    tenantB,
    tenantModel,
  };
};

describe('TvdQueryService.listAdminOperations', () => {
  it('rechaza usuarios institucionales antes de consultar fuentes', async () => {
    const { accreditationModel, historyModel, service } = createService();

    await expect(
      service.listAdminOperations(
        query(),
        {
          ...adminRequester,
          role: 'TENANT_ADMIN',
          tenantId: new Types.ObjectId().toString(),
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(accreditationModel.find).not.toHaveBeenCalled();
    expect(historyModel.find).not.toHaveBeenCalled();
  });

  it('normaliza asignaciones, recargas y consumos verificables con totales exactos', async () => {
    const {
      accreditationModel,
      historyModel,
      historyService,
      service,
      tenantA,
      tenantB,
      tenantModel,
    } = createService();
    const manual = createAccreditation({
      tenantId: tenantA._id,
      sourceType: 'MANUAL_GRANT',
      tokenAmount: '1',
      tokenAmountSmallestUnit: '1000000000000000000',
      createdAt: fixedDate(21),
      txHash: '0xmanual',
    });
    const qr = createAccreditation({
      tenantId: tenantB._id,
      sourceType: 'QR_PAYMENT',
      tokenAmount: '2.0005',
      tokenAmountSmallestUnit: '2000500000000000000',
      createdAt: fixedDate(20),
      txHash: '0xqr',
    });
    const history = createHistory({
      institutionId: tenantA._id,
      txHash: '0xvote',
      registerDate: fixedDate(19),
    });

    accreditationModel.find.mockReturnValueOnce(createQuery([manual, qr]));
    historyModel.find.mockReturnValueOnce(createQuery([history]));
    tenantModel.find.mockReturnValueOnce(createLeanQuery([tenantA, tenantB]));

    const response = await service.listAdminOperations(
      query(),
      adminRequester,
    );

    expect(historyService.getRelatedAmounts).toHaveBeenCalledTimes(1);
    expect(historyService.getRelatedAmounts).toHaveBeenCalledWith([history]);
    expect(response).toMatchObject({
      page: 1,
      limit: 20,
      total: 3,
      hasNextPage: false,
      summary: {
        totalOperations: 3,
        totalAssigned: '3.0005',
        totalConsumed: '1.25',
      },
    });
    expect(response.items.map((item) => item.operationLabel)).toEqual([
      'Asignación manual',
      'Recarga mediante QR',
      'Consumo por voto',
    ]);
    expect(response.items[0]).toMatchObject({
      tenantId: String(tenantA._id),
      institutionName: tenantA.name,
      operationType: TvdAdminOperationType.MANUAL_ASSIGNMENT,
      economicDirection: 'IN',
      status: TvdAdminOperationStatus.CONFIRMED,
      amount: '1',
      amountSmallestUnit: '1000000000000000000',
      explorerUrl: 'https://sepolia.basescan.org/tx/0xmanual',
      source: 'TOKEN_ACCREDITATION',
    });
    expect(response.items[2]).toMatchObject({
      tenantId: String(tenantA._id),
      institutionName: tenantA.name,
      operationType: TvdAdminOperationType.VOTE_CONSUMPTION,
      economicDirection: 'OUT',
      status: TvdAdminOperationStatus.CONFIRMED,
      amount: '1.25',
      amountSmallestUnit: '1250000000000000000',
      txHash: '0xvote',
      source: 'HISTORY',
    });
  });

  it('aplica filtros por institucion, estado, tipo y fechas a las fuentes canonicas', async () => {
    const { accreditationModel, historyModel, service, tenantA, tenantModel } =
      createService();
    const dateFrom = '2026-07-01T00:00:00.000Z';
    const dateTo = '2026-07-31T23:59:59.999Z';

    tenantModel.findById.mockReturnValueOnce(createLeanQuery(tenantA));
    accreditationModel.find.mockReturnValueOnce(createQuery([]));

    await service.listAdminOperations(
      {
        ...query({
          tenantId: String(tenantA._id),
          status: TvdAdminOperationStatus.CONFIRMED,
          operationType: TvdAdminOperationType.MANUAL_ASSIGNMENT,
          dateFrom,
          dateTo,
        }),
      },
      adminRequester,
    );

    expect(accreditationModel.find).toHaveBeenCalledWith({
      sourceType: { $in: ['MANUAL_GRANT'] },
      tenantId: tenantA._id,
      status: { $in: ['CONFIRMED'] },
      createdAt: {
        $gte: new Date(dateFrom),
        $lte: new Date(dateTo),
      },
    });
    expect(historyModel.find).not.toHaveBeenCalled();
  });

  it('no suma operaciones no confirmadas o sin monto verificable', async () => {
    const { accreditationModel, historyModel, historyService, service, tenantA, tenantModel } =
      createService();
    const pending = createAccreditation({
      tenantId: tenantA._id,
      status: 'PENDING',
      tokenAmount: '4',
      tokenAmountSmallestUnit: '4000000000000000000',
      createdAt: fixedDate(21),
    });
    const submitting = createAccreditation({
      tenantId: tenantA._id,
      status: 'SUBMITTING',
      tokenAmount: '5',
      tokenAmountSmallestUnit: '5000000000000000000',
      createdAt: fixedDate(20),
    });
    const failed = createAccreditation({
      tenantId: tenantA._id,
      status: 'FAILED',
      tokenAmount: '6',
      tokenAmountSmallestUnit: '6000000000000000000',
      createdAt: fixedDate(19),
    });
    const reviewHistory = createHistory({
      institutionId: tenantA._id,
      txHash: null,
      registerDate: fixedDate(18),
    });

    accreditationModel.find.mockReturnValueOnce(
      createQuery([pending, submitting, failed]),
    );
    historyModel.find.mockReturnValueOnce(createQuery([reviewHistory]));
    tenantModel.find.mockReturnValueOnce(createLeanQuery([tenantA]));
    historyService.getRelatedAmounts.mockResolvedValueOnce([reviewHistory]);

    const response = await service.listAdminOperations(query(), adminRequester);

    expect(response.total).toBe(4);
    expect(response.summary).toEqual({
      totalOperations: 4,
      totalAssigned: '0',
      totalConsumed: '0',
    });
    expect(response.items.map((item) => item.statusLabel)).toEqual([
      'Pendiente',
      'En proceso',
      'Fallida',
      'Requiere revisión',
    ]);
  });

  it('mantiene la respuesta cuando el enriquecimiento de History falla', async () => {
    const { accreditationModel, historyModel, historyService, service, tenantA, tenantModel } =
      createService();
    const history = createHistory({
      institutionId: tenantA._id,
      txHash: '0xunavailable',
      registerDate: fixedDate(20),
    });

    accreditationModel.find.mockReturnValueOnce(createQuery([]));
    historyModel.find.mockReturnValueOnce(createQuery([history]));
    tenantModel.find.mockReturnValueOnce(createLeanQuery([tenantA]));
    historyService.getRelatedAmounts.mockRejectedValueOnce(
      new Error('RPC timeout'),
    );

    const response = await service.listAdminOperations(query(), adminRequester);

    expect(response.total).toBe(1);
    expect(response.items[0]).toMatchObject({
      operationLabel: 'Consumo por voto',
      status: TvdAdminOperationStatus.NEEDS_REVIEW,
      amount: null,
      amountSmallestUnit: null,
    });
    expect(response.summary.totalConsumed).toBe('0');
  });

  it('pagina el resultado combinado sin calcular totales solo desde la pagina visible', async () => {
    const { accreditationModel, historyModel, service, tenantA, tenantModel } =
      createService();
    const first = createAccreditation({
      tenantId: tenantA._id,
      tokenAmount: '10',
      tokenAmountSmallestUnit: '10000000000000000000',
      createdAt: fixedDate(23),
    });
    const second = createAccreditation({
      tenantId: tenantA._id,
      tokenAmount: '20',
      tokenAmountSmallestUnit: '20000000000000000000',
      createdAt: fixedDate(22),
    });
    const third = createAccreditation({
      tenantId: tenantA._id,
      tokenAmount: '30',
      tokenAmountSmallestUnit: '30000000000000000000',
      createdAt: fixedDate(21),
    });

    accreditationModel.find.mockReturnValueOnce(
      createQuery([first, second, third]),
    );
    historyModel.find.mockReturnValueOnce(createQuery([]));
    tenantModel.find.mockReturnValueOnce(createLeanQuery([tenantA]));

    const response = await service.listAdminOperations(
      query({ page: 2, limit: 2 }),
      adminRequester,
    );

    expect(response.items).toHaveLength(1);
    expect(response.total).toBe(3);
    expect(response.hasNextPage).toBe(false);
    expect(response.summary.totalAssigned).toBe('60');
  });

  it('reporta institucion inexistente y rangos de fecha invalidos', async () => {
    const { service, tenantA, tenantModel } = createService();

    tenantModel.findById.mockReturnValueOnce(createLeanQuery(null));
    await expect(
      service.listAdminOperations(
        query({ tenantId: String(tenantA._id) }),
        adminRequester,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.listAdminOperations(
        query({
          dateFrom: '2026-07-31T00:00:00.000Z',
          dateTo: '2026-07-01T00:00:00.000Z',
        }),
        adminRequester,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza consultas demasiado amplias sin crear documentos reales', async () => {
    const { accreditationModel, historyModel, service } = createService();
    accreditationModel.find.mockReturnValueOnce(createQuery([]));
    historyModel.find.mockReturnValueOnce(
      createQuery(Array.from({ length: 501 }, () => createHistory())),
    );

    await expect(service.listAdminOperations(query(), adminRequester)).rejects.toMatchObject({
      response: {
        code: 'TVD_OPERATION_FILTER_TOO_BROAD',
      },
    });
  });
});
