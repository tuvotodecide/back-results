import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../mail/mail.module';
import { InstitutionalAuditModule } from '../institutional-audit/institutional-audit.module';
import { InstitutionalPublicRateLimitGuard } from '../institutional-admin-applications/guards/institutional-public-rate-limit.guard';
import { RoledUser, RoledUserSchema } from '../auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '../institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '../institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalAccessRecoveryRequestsController } from './controllers/institutional-access-recovery-requests.controller';
import {
  InstitutionalAccessRecoveryRequest,
  InstitutionalAccessRecoveryRequestSchema,
} from './schemas/institutional-access-recovery-request.schema';
import { InstitutionalAccessRecoveryRequestsService } from './services/institutional-access-recovery-requests.service';

@Module({
  imports: [
    ConfigModule,
    MailModule,
    InstitutionalAuditModule,
    MongooseModule.forFeature([
      {
        name: InstitutionalAccessRecoveryRequest.name,
        schema: InstitutionalAccessRecoveryRequestSchema,
      },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
    ]),
  ],
  controllers: [InstitutionalAccessRecoveryRequestsController],
  providers: [InstitutionalAccessRecoveryRequestsService, InstitutionalPublicRateLimitGuard],
  exports: [InstitutionalAccessRecoveryRequestsService],
})
export class InstitutionalAccessRecoveryRequestsModule {}
