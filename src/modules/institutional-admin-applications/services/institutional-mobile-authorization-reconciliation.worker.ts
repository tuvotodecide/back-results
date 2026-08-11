import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InstitutionalAdminApplicationsService } from './institutional-admin-applications.service';

@Injectable()
export class InstitutionalMobileAuthorizationReconciliationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InstitutionalMobileAuthorizationReconciliationWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly applications: InstitutionalAdminApplicationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.enabled()) return;
    void this.runOnce().catch((error) => {
      this.logger.warn({ code: 'INSTITUTIONAL_AUTHORIZATION_RECONCILIATION_FAILED', message: error?.message || String(error) });
    });
    this.timer = setInterval(() => void this.runOnce().catch((error) => {
      this.logger.warn({ code: 'INSTITUTIONAL_AUTHORIZATION_RECONCILIATION_FAILED', message: error?.message || String(error) });
    }), this.number('reconciliationIntervalMs', 10_000));
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(options: { force?: boolean } = {}) {
    if (!options.force && !this.enabled()) return { processed: 0 };
    const deliveryRows = await this.applications.findMobileAuthorizationDeliveryRetryBatch(
      this.number('reconciliationBatchSize', 10),
    );
    const rows = await this.applications.findMobileAuthorizationReconciliationBatch(
      this.number('reconciliationBatchSize', 10),
    );
    let processed = 0;
    for (const row of deliveryRows) {
      const result = await this.applications.retryMobileAuthorizationDelivery(String(row._id));
      if (result.processed) processed += 1;
    }
    for (const row of rows) {
      const result = await this.applications.processMobileAuthorizationRetry(String(row._id));
      if (result.processed) processed += 1;
      if (result.reissuable) await this.applications.recoverFailedMobileAuthorization(String(row._id));
    }
    return { processed };
  }

  private enabled() {
    return this.config.get<string>('app.institutionalAuthorization.reconciliationEnabled') === 'true';
  }

  private number(key: string, fallback: number) {
    return Math.max(1, Number(this.config.get<string>(`app.institutionalAuthorization.${key}`) || fallback));
  }
}
