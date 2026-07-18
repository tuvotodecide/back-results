import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { TvdAccreditationProcessorService } from './tvd-accreditation-processor.service';
import { TvdAccreditationReconciliationService } from './tvd-accreditation-reconciliation.service';
import { TvdBlockchainService } from './tvd-blockchain.service';

@Injectable()
export class TvdAccreditationWorkerService {
  private readonly logger = new Logger(TvdAccreditationWorkerService.name);
  private readonly workerId = `tvd-accreditation-worker:${process.pid}:${randomUUID()}`;
  private lastRunAt = 0;

  constructor(
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
