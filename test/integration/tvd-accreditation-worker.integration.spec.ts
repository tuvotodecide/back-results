import appConfig from '@/config/app.config';
import { PaymentTransaction } from '@/modules/payments/schemas/payment-transaction.schema';
import {
  TokenAccreditation,
  TokenAccreditationSchema,
} from '@/modules/tvd/schemas/token-accreditation.schema';
import { TvdBlockchainError } from '@/modules/tvd/errors/tvd-blockchain.error';
import { TvdAccreditationProcessorService } from '@/modules/tvd/services/tvd-accreditation-processor.service';
import { TvdAccreditationReconciliationService } from '@/modules/tvd/services/tvd-accreditation-reconciliation.service';
import { TvdAccreditationWorkerService } from '@/modules/tvd/services/tvd-accreditation-worker.service';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { getAddress } from 'viem';

const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const assignmentContract = getAddress('0x2222222222222222222222222222222222222222');
const operatorAddress = getAddress('0x3333333333333333333333333333333333333333');
const txHashOne = `0x${'1'.repeat(64)}`;
const txHashTwo = `0x${'2'.repeat(64)}`;
const userOpHashOne = `0x${'e'.repeat(64)}`;
const userOpHashTwo = `0x${'f'.repeat(64)}`;
const serializedOne = `0x${'a'.repeat(64)}`;
const serializedTwo = `0x${'b'.repeat(64)}`;

describe('TVD accreditation worker and processor integration', () => {
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let accreditationModel: Model<any>;
  let paymentModel: Model<any>;
  let processor: TvdAccreditationProcessorService;
  let reconciliation: TvdAccreditationReconciliationService;
  let worker: TvdAccreditationWorkerService;
  let configService: ConfigService;
  let previousEnv: Record<string, string | undefined>;
  let preparedNonce = 0;

  const blockchain = {
    validateBlockchainConfiguration: jest.fn(async () => ({
      configured: true,
    })),
    getOperatorContext: jest.fn(() => ({
      chainId: 84532,
      operatorAddress,
      assignmentContractAddress: assignmentContract,
    })),
    validateAssignReadiness: jest.fn(async () => ({
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress,
    })),
    prepareSignedAssignTransaction: jest.fn(async () => {
      preparedNonce += 1;
      const nonce = String(preparedNonce);
      return {
      userOpHash: nonce === '2' ? userOpHashTwo : userOpHashOne,
      nonce,
      serializedTransaction: nonce === '2' ? serializedTwo : serializedOne,
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress,
      institutionWallet: wallet,
      amountSmallestUnit: '100',
    };
    }),
    broadcastSignedTransaction: jest.fn(async (serializedTransaction: string) => ({
      txHash: serializedTransaction === serializedTwo ? txHashTwo : txHashOne,
      userOpHash: serializedTransaction === serializedTwo ? userOpHashTwo : userOpHashOne,
      alreadyKnown: false,
    })),
    resolveUserOperationTransactionHash: jest.fn(async () => txHashOne),
    getTransactionReceipt: jest.fn(async () => ({ transactionHash: txHashOne })),
    validateSubmittedAssignReceipt: jest.fn(async () => ({
      blockNumber: '99',
      confirmations: 3,
    })),
  };

  beforeAll(async () => {
    previousEnv = {
      TVD_DECIMALS: process.env.TVD_DECIMALS,
      TVD_ACCREDITATION_WORKER_ENABLED: process.env.TVD_ACCREDITATION_WORKER_ENABLED,
      TVD_ACCREDITATION_BATCH_SIZE: process.env.TVD_ACCREDITATION_BATCH_SIZE,
      TVD_ACCREDITATION_LOCK_TTL_MS: process.env.TVD_ACCREDITATION_LOCK_TTL_MS,
      TVD_OPERATOR_LOCK_TTL_MS: process.env.TVD_OPERATOR_LOCK_TTL_MS,
      TVD_ACCREDITATION_RECONCILE_AFTER_MS:
        process.env.TVD_ACCREDITATION_RECONCILE_AFTER_MS,
    };
    process.env.TVD_DECIMALS = '2';
    process.env.TVD_ACCREDITATION_WORKER_ENABLED = 'true';
    process.env.TVD_ACCREDITATION_BATCH_SIZE = '10';
    process.env.TVD_ACCREDITATION_LOCK_TTL_MS = '1000';
    process.env.TVD_OPERATOR_LOCK_TTL_MS = '1000';
    process.env.TVD_ACCREDITATION_RECONCILE_AFTER_MS = '1';

    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 120000 }],
    });
    await mongod.waitUntilRunning();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        JwtModule.register({ global: true, secret: 'test-secret' }),
        MongooseModule.forRoot(mongod.getUri()),
        TvdModule,
        MongooseModule.forFeature([
          { name: TokenAccreditation.name, schema: TokenAccreditationSchema },
        ]),
      ],
    })
      .overrideProvider(TvdBlockchainService)
      .useValue(blockchain)
      .compile();

    conn = moduleRef.get(getConnectionToken());
    accreditationModel = moduleRef.get(getModelToken(TokenAccreditation.name));
    paymentModel = moduleRef.get(getModelToken(PaymentTransaction.name));
    processor = moduleRef.get(TvdAccreditationProcessorService);
    reconciliation = moduleRef.get(TvdAccreditationReconciliationService);
    worker = moduleRef.get(TvdAccreditationWorkerService);
    configService = moduleRef.get(ConfigService);
    await Promise.all([accreditationModel.init(), paymentModel.init()]);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    preparedNonce = 0;
    await conn.dropDatabase();
    blockchain.validateBlockchainConfiguration.mockResolvedValue({ configured: true });
    blockchain.prepareSignedAssignTransaction.mockImplementation(async () => {
      preparedNonce += 1;
      const nonce = String(preparedNonce);
      return {
      userOpHash: nonce === '2' ? userOpHashTwo : userOpHashOne,
      nonce,
      serializedTransaction: nonce === '2' ? serializedTwo : serializedOne,
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress,
      institutionWallet: wallet,
      amountSmallestUnit: '100',
    };
    });
    blockchain.broadcastSignedTransaction.mockResolvedValue({
      txHash: txHashOne,
      userOpHash: userOpHashOne,
      alreadyKnown: false,
    });
    blockchain.resolveUserOperationTransactionHash.mockResolvedValue(txHashOne);
    blockchain.getTransactionReceipt.mockResolvedValue({ transactionHash: txHashOne });
    blockchain.validateSubmittedAssignReceipt.mockResolvedValue({
      blockNumber: '99',
      confirmations: 3,
    });
  });

  afterAll(async () => {
    await conn?.close();
    await mongod?.stop();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  function baseAccreditation(overrides: Record<string, any> = {}) {
    return accreditationModel.create({
      sourceType: 'QR_PAYMENT',
      sourceId: new Types.ObjectId().toHexString(),
      tenantId: new Types.ObjectId(),
      targetAssignmentId: new Types.ObjectId(),
      targetWallet: wallet,
      targetWalletNormalized: wallet.toLowerCase(),
      tokenAmount: '1',
      tokenAmountSmallestUnit: '100',
      status: 'PENDING',
      attempts: 0,
      createdBy: new Types.ObjectId(),
      ...overrides,
    });
  }

  it('TVD-PROC-POS-I-001/002/007/017 | POSITIVO | INTEGRACION | dos workers concurrentes hacen un solo broadcast', async () => {
    const accreditation = await baseAccreditation();

    await Promise.all([
      processor.processAccreditationById(accreditation._id, { ownerId: 'worker-a' }),
      processor.processAccreditationById(accreditation._id, { ownerId: 'worker-b' }),
    ]);

    const stored = await accreditationModel.findById(accreditation._id).lean();
    expect(stored).toMatchObject({
      status: 'SUBMITTED',
      txHash: txHashOne,
      userOpHash: userOpHashOne,
      nonce: '1',
    });
    expect(blockchain.prepareSignedAssignTransaction).toHaveBeenCalledTimes(1);
    expect(blockchain.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
  });

  it('TVD-PROC-POS-I-002/003 | POSITIVO | INTEGRACION | acreditaciones distintas usan nonces secuenciales bajo lock', async () => {
    await baseAccreditation({ sourceId: 'qr-1' });
    await baseAccreditation({ sourceId: 'qr-2' });

    await processor.processNextPending('worker-seq');
    await processor.processNextPending('worker-seq');

    const stored = await accreditationModel.find({}).sort({ nonce: 1 }).lean();
    expect(stored.map((row) => row.nonce)).toEqual(['1', '2']);
    expect(blockchain.prepareSignedAssignTransaction).toHaveBeenCalledTimes(2);
  });

  it('TVD-PROC-POS-I-004/005/012 | POSITIVO | INTEGRACION | receipt pendiente retransmite la misma transaccion firmada', async () => {
    const accreditation = await baseAccreditation({
      status: 'SUBMITTED',
      txHash: txHashOne,
      nonce: '1',
      serializedTransaction: serializedOne,
      submittedAt: new Date(),
    });
    blockchain.getTransactionReceipt.mockRejectedValueOnce(
      new TvdBlockchainError('TVD_RECEIPT_NOT_FOUND'),
    );

    await reconciliation.reconcileSubmittedAccreditation(accreditation._id, 'recon-a');

    const stored = await accreditationModel
      .findById(accreditation._id)
      .select('+serializedTransaction')
      .lean();
    expect(stored).toMatchObject({
      status: 'SUBMITTED',
      txHash: txHashOne,
      serializedTransaction: serializedOne,
    });
    expect(blockchain.broadcastSignedTransaction).toHaveBeenCalledWith(serializedOne);
    expect(blockchain.prepareSignedAssignTransaction).not.toHaveBeenCalled();
  });

  it('TVD-PROC-POS-I-005 | POSITIVO | INTEGRACION | receipt valido confirma y actualiza resumen QR', async () => {
    const paymentId = new Types.ObjectId();
    await paymentModel.create({
      _id: paymentId,
      tenantId: new Types.ObjectId(),
      requestedByUserId: new Types.ObjectId(),
      provider: 'RED_ENLACE',
      merchantReference: '123',
      amountMinor: '100',
      currency: 'BOB',
      status: 'PAYMENT_CONFIRMED',
    });
    const accreditation = await baseAccreditation({
      sourceType: 'QR_PAYMENT',
      sourceId: paymentId.toHexString(),
      status: 'SUBMITTED',
      txHash: txHashOne,
      nonce: '1',
      serializedTransaction: serializedOne,
    });

    await reconciliation.reconcileSubmittedAccreditation(accreditation._id, 'recon-b');

    const stored = await accreditationModel.findById(accreditation._id).lean();
    const payment = await paymentModel.findById(paymentId).lean();
    expect(stored).toMatchObject({ status: 'CONFIRMED', blockNumber: '99' });
    expect(payment).toMatchObject({
      tokenAccreditationStatus: 'CONFIRMED',
      tokenAccreditationErrorCode: null,
    });
  });

  it('TVD-PROC-POS-I-006/008/009 | POSITIVO | INTEGRACION | recupera locks vencidos y no reclama terminales', async () => {
    const expired = new Date(Date.now() - 1000);
    await baseAccreditation({
      status: 'SUBMITTING',
      processingLockExpiresAt: expired,
      txHash: null,
      serializedTransaction: null,
    });
    await baseAccreditation({
      status: 'SUBMITTING',
      processingLockExpiresAt: expired,
      userOpHash: userOpHashOne,
      nonce: '1',
      serializedTransaction: serializedOne,
    });
    await baseAccreditation({ status: 'BLOCKED_CONFIGURATION', sourceId: 'blocked' });
    await baseAccreditation({ status: 'CONFIRMED', sourceId: 'confirmed' });

    const recovered = await processor.recoverExpiredClaims();
    await processor.processNextPending('worker-recover');

    expect(recovered).toEqual({ recoveredPending: 1, recoveredSubmitted: 1 });
    expect(await accreditationModel.countDocuments({ sourceId: 'blocked', status: 'BLOCKED_CONFIGURATION' })).toBe(1);
    expect(await accreditationModel.countDocuments({ sourceId: 'confirmed', status: 'CONFIRMED' })).toBe(1);
  });

  it('TVD-PROC-NEG-I-010 | NEGATIVO | INTEGRACION | worker deshabilitado no procesa', async () => {
    await baseAccreditation();
    const spy = jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === 'app.tvd.accreditationWorkerEnabled') return 'false';
      return undefined;
    });

    const result = await worker.processPendingBatch();

    expect(result).toEqual([]);
    expect(blockchain.prepareSignedAssignTransaction).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('TVD-PROC-NEG-U-002 | NEGATIVO | INTEGRACION | configuracion incompleta no procesa ni prepara tx', async () => {
    await baseAccreditation();
    blockchain.validateBlockchainConfiguration.mockResolvedValueOnce({
      configured: false,
    });

    const result = await worker.processPendingBatch();

    expect(result).toEqual([]);
    expect(blockchain.prepareSignedAssignTransaction).not.toHaveBeenCalled();
    expect(await accreditationModel.countDocuments({ status: 'PENDING' })).toBe(1);
  });

  it('TVD-PROC-POS-I-013 | POSITIVO | INTEGRACION | SUBMITTED con solo userOpHash resuelve txHash antes de validar receipt', async () => {
    const accreditation = await baseAccreditation({
      status: 'SUBMITTED',
      userOpHash: userOpHashOne,
      nonce: '1',
      serializedTransaction: serializedOne,
      submittedAt: new Date(),
    });

    await reconciliation.reconcileSubmittedAccreditation(accreditation._id, 'recon-userop');

    const stored = await accreditationModel.findById(accreditation._id).lean();
    expect(blockchain.resolveUserOperationTransactionHash).toHaveBeenCalledWith(userOpHashOne);
    expect(blockchain.getTransactionReceipt).toHaveBeenCalledWith(txHashOne);
    expect(stored).toMatchObject({ status: 'CONFIRMED', txHash: txHashOne });
  });

  it('TVD-PROC-NEG-I-014/015/016 | NEGATIVO | INTEGRACION | receipt incompatible queda FAILED_TERMINAL sin acreditar', async () => {
    const accreditation = await baseAccreditation({
      status: 'SUBMITTED',
      txHash: txHashOne,
      userOpHash: userOpHashOne,
      nonce: '1',
      serializedTransaction: serializedOne,
    });
    blockchain.validateSubmittedAssignReceipt.mockRejectedValueOnce(
      new TvdBlockchainError('TVD_EVENT_AMOUNT_MISMATCH'),
    );

    await reconciliation.reconcileSubmittedAccreditation(accreditation._id, 'recon-mismatch');

    const stored = await accreditationModel.findById(accreditation._id).lean();
    expect(stored).toMatchObject({
      status: 'FAILED_TERMINAL',
      lastErrorCode: 'TVD_EVENT_AMOUNT_MISMATCH',
      retryable: false,
    });
  });

  it('TVD-PROC-POS-I-018 | POSITIVO | INTEGRACION | confirmaciones insuficientes conserva SUBMITTED con backoff', async () => {
    const accreditation = await baseAccreditation({
      status: 'SUBMITTED',
      txHash: txHashOne,
      userOpHash: userOpHashOne,
      nonce: '1',
      serializedTransaction: serializedOne,
    });
    blockchain.validateSubmittedAssignReceipt.mockRejectedValueOnce(
      new TvdBlockchainError('TVD_CONFIRMATIONS_INSUFFICIENT'),
    );

    await reconciliation.reconcileSubmittedAccreditation(accreditation._id, 'recon-confirmations');

    const stored = await accreditationModel.findById(accreditation._id).lean();
    expect(stored.status).toBe('SUBMITTED');
    expect(stored.lastErrorCode).toBe('TVD_CONFIRMATIONS_INSUFFICIENT');
    expect(stored.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('TVD-PROC-NEG-I-019 | NEGATIVO | INTEGRACION | validacion previa bloquea configuracion sin broadcast', async () => {
    const accreditation = await baseAccreditation();
    blockchain.validateAssignReadiness.mockRejectedValueOnce(
      new TvdBlockchainError('TVD_OPERATOR_MISMATCH'),
    );

    await processor.processAccreditationById(accreditation._id, { ownerId: 'worker-config' });

    const stored = await accreditationModel.findById(accreditation._id).lean();
    expect(stored).toMatchObject({
      status: 'BLOCKED_CONFIGURATION',
      lastErrorCode: 'TVD_OPERATOR_MISMATCH',
      retryable: false,
    });
    expect(blockchain.broadcastSignedTransaction).not.toHaveBeenCalled();
  });

  it('TVD-PROC-NEG-I-020 | NEGATIVO | INTEGRACION | worker deshabilitado en staging no queda ready', async () => {
    const spy = jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === 'app.tvd.accreditationWorkerEnabled') return 'false';
      if (key === 'app.nodeEnv') return 'staging';
      return undefined;
    });

    await expect(worker.getWorkerStatus()).resolves.toMatchObject({
      ready: false,
      workerEnabled: false,
      configurationValid: false,
      reasonCode: 'TVD_ACCREDITATION_WORKER_DISABLED',
    });
    spy.mockRestore();
  });
});
