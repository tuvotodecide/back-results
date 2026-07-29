import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import {
  TokenAccreditation,
  TokenAccreditationDocument,
} from '../schemas/token-accreditation.schema';
import { TvdAccreditationProcessorService } from './tvd-accreditation-processor.service';
import { TvdAccreditationReconciliationService } from './tvd-accreditation-reconciliation.service';
import { TvdBlockchainService } from './tvd-blockchain.service';

@Injectable()
export class TvdAccreditationWorkerService {
  private readonly logger = new Logger(TvdAccreditationWorkerService.name);
  private readonly workerId = `tvd-accreditation-worker:${process.pid}:${randomUUID()}`;
  private lastRunAt = 0;
  private lastSuccessfulRun: Date | null = null;

  constructor(
    @InjectModel(TokenAccreditation.name)
    private readonly accreditationModel: Model<TokenAccreditationDocument>,
    private readonly processor: TvdAccreditationProcessorService,
    private readonly reconciliation: TvdAccreditationReconciliationService,
    private readonly blockchain: TvdBlockchainService,
    private readonly configService: ConfigService,
  ) {}

  @Interval(5000)
  async processScheduledTick() {
    if (process.env.NODE_ENV === 'test') return;
    if (!(await this.canProcess())) return;
    const now = Date.now();
    if (now - this.lastRunAt < this.getPollIntervalMs()) return;
    this.lastRunAt = now;
    await this.runOnce();
  }

  async runOnce() {
    if (!(await this.canProcess())) {
      return { disabled: true, recovered: null, processed: [], reconciled: [] };
    }
    const recovered = await this.recoverExpiredClaims();
    const processed = await this.processPendingBatch();
    const reconciled = await this.reconcileSubmittedBatch();
    this.lastSuccessfulRun = new Date();
    this.logger.log(
      JSON.stringify({
        event: 'tvd_accreditation_duration',
        workerId: this.workerId,
        processed: processed.length,
        reconciled: reconciled.length,
      }),
    );
    return { disabled: false, recovered, processed, reconciled };
  }

  async processPendingBatch(limit = this.getBatchSize()) {
    if (!(await this.canProcess())) return [];
    const processed: any[] = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await this.processor.processNextPending(this.workerId);
      if (!result) break;
      processed.push(result);
    }
    return processed;
  }

  async reconcileSubmittedBatch(limit = this.getBatchSize()) {
    if (!(await this.canProcess())) return [];
    return this.reconciliation.reconcileSubmittedBatch(limit, this.workerId);
  }

  async recoverExpiredClaims() {
    if (!(await this.canProcess())) return null;
    return this.processor.recoverExpiredClaims();
  }

  async getWorkerStatus() {
    const [configuration, counts, oldestPending] = await Promise.all([
      this.getConfigurationStatus(),
      this.getAccreditationCounts(),
      this.getOldestPending(),
    ]);
    const environment = this.configService.get<string>('app.nodeEnv') ?? process.env.NODE_ENV;
    const productionLike = ['production', 'staging'].includes(String(environment));
    const ready =
      configuration.workerEnabled &&
      configuration.configurationValid &&
      (!productionLike || configuration.workerEnabled);

    return {
      ready,
      workerEnabled: configuration.workerEnabled,
      configurationValid: configuration.configurationValid,
      reasonCode: configuration.reasonCode,
      environment,
      lastSuccessfulRun: this.lastSuccessfulRun?.toISOString() ?? null,
      pendingCount: counts.pendingCount,
      submittedCount: counts.submittedCount,
      blockedCount: counts.blockedCount,
      oldestPendingAgeMs: oldestPending
        ? Math.max(Date.now() - oldestPending.createdAt.getTime(), 0)
        : null,
    };
  }

  private isEnabled() {
    return String(
      this.configService.get<string>('app.tvd.accreditationWorkerEnabled') ?? 'false',
    ).toLowerCase() === 'true';
  }

  private async canProcess() {
    if (!this.isEnabled()) return false;
    const validation = await this.blockchain.validateBlockchainConfiguration();
    return validation.configured === true;
  }

  private async getConfigurationStatus() {
    const workerEnabled = this.isEnabled();
    if (!workerEnabled) {
      const environment =
        this.configService.get<string>('app.nodeEnv') ?? process.env.NODE_ENV;
      const productionLike = ['production', 'staging'].includes(String(environment));
      return {
        workerEnabled,
        configurationValid: !productionLike,
        reasonCode: productionLike
          ? 'TVD_ACCREDITATION_WORKER_DISABLED'
          : 'TVD_ACCREDITATION_WORKER_DISABLED_DEV_TEST',
      };
    }
    try {
      const validation = await this.blockchain.validateBlockchainConfiguration();
      return {
        workerEnabled,
        configurationValid: validation.configured === true,
        reasonCode:
          validation.configured === true ? null : 'TVD_BLOCKCHAIN_CONFIG_INCOMPLETE',
      };
    } catch {
      return {
        workerEnabled,
        configurationValid: false,
        reasonCode: 'TVD_BLOCKCHAIN_CONFIG_INVALID',
      };
    }
  }

  private async getAccreditationCounts() {
    const [pendingCount, submittedCount, blockedCount] = await Promise.all([
      this.accreditationModel.countDocuments({ status: 'PENDING' }),
      this.accreditationModel.countDocuments({ status: 'SUBMITTED' }),
      this.accreditationModel.countDocuments({
        status: { $in: ['BLOCKED_CONFIGURATION', 'FAILED_TERMINAL', 'FAILED'] },
      }),
    ]);
    return { pendingCount, submittedCount, blockedCount };
  }

  private getOldestPending() {
    return this.accreditationModel
      .findOne({ status: { $in: ['PENDING', 'SUBMITTED'] } }, { createdAt: 1 })
      .sort({ createdAt: 1 })
      .lean();
  }

  private getBatchSize() {
    return this.getPositiveConfigNumber('app.tvd.accreditationBatchSize', 10);
  }

  private getPollIntervalMs() {
    return this.getPositiveConfigNumber('app.tvd.accreditationPollIntervalMs', 5000);
  }

  private getPositiveConfigNumber(key: string, fallback: number) {
    const value = Number(this.configService.get<string | number>(key) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
