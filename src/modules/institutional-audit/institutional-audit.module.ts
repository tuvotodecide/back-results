import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalAuditController } from './controllers/institutional-audit.controller';
import {
  InstitutionalAuditEvent,
  InstitutionalAuditEventSchema,
} from './schemas/institutional-audit-event.schema';
import { InstitutionalAuditService } from './services/institutional-audit.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstitutionalAuditEvent.name, schema: InstitutionalAuditEventSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
    ]),
  ],
  controllers: [InstitutionalAuditController],
  providers: [InstitutionalAuditService],
  exports: [InstitutionalAuditService],
})
export class InstitutionalAuditModule {}
