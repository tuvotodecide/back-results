import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HistoryModule } from '@/modules/history/history.module';
import { InstitutionalAuditModule } from '@/modules/institutional-audit/institutional-audit.module';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationSchema,
} from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalWalletsModule } from '@/modules/institutional-wallets/institutional-wallets.module';
import {
  InstitutionalWalletMigration,
  InstitutionalWalletMigrationSchema,
} from './schemas/institutional-wallet-migration.schema';
import { InstitutionalWalletMigrationController } from './controllers/institutional-wallet-migration.controller';
import { InstitutionalWalletMigrationService } from './services/institutional-wallet-migration.service';
import { InstitutionalWalletMigrationWorker } from './services/institutional-wallet-migration.worker';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstitutionalWalletMigration.name, schema: InstitutionalWalletMigrationSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: InstitutionalAdminApplication.name, schema: InstitutionalAdminApplicationSchema },
    ]),
    InstitutionalWalletsModule,
    InstitutionalAuditModule,
    HistoryModule,
  ],
  controllers: [InstitutionalWalletMigrationController],
  providers: [InstitutionalWalletMigrationService, InstitutionalWalletMigrationWorker],
  exports: [InstitutionalWalletMigrationService],
})
export class InstitutionalWalletMigrationModule {}
