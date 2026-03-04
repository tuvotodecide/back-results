import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoledUser, RoledUserSchema } from '../auth/schemas/roledUser.schema';
import { InstitutionalTenantsController } from './controllers/institutional-tenants.controller';
import { InstitutionalTenantsService } from './services/institutional-tenants.service';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from './schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from './schemas/tenant-admin-assignment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
    ]),
  ],
  controllers: [InstitutionalTenantsController],
  providers: [InstitutionalTenantsService],
  exports: [InstitutionalTenantsService],
})
export class InstitutionalTenantsModule {}
