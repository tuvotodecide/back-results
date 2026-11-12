import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InstitutionalWalletMigrationService } from './institutional-wallet-migration.service';

/**
 * Reintenta las migraciones que quedaron listas o con error recuperable (por ejemplo, si el
 * proceso se reinició mientras esperaba el recibo). El login solo dispara el primer intento.
 */
@Injectable()
export class InstitutionalWalletMigrationWorker {
  private readonly logger = new Logger(InstitutionalWalletMigrationWorker.name);
  private running = false;

  constructor(private readonly migrationService: InstitutionalWalletMigrationService) {}

  @Interval(60_000)
  async tick() {
    if (process.env.NODE_ENV === 'test') return;
    if (this.running || !this.migrationService.isEnabled()) return;
    this.running = true;
    try {
      const results = await this.migrationService.processDue();
      if (results.length > 0) {
        this.logger.log(JSON.stringify({ event: 'wallet_migration_tick', processed: results.length }));
      }
    } catch (error: any) {
      this.logger.error({ event: 'wallet_migration_tick_failed', error: String(error?.message ?? error) });
    } finally {
      this.running = false;
    }
  }
}
