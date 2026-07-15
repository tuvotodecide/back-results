import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../mail/mail.module';
import { RoledUser, RoledUserSchema } from '../auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '../institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '../institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationSchema,
} from './schemas/institutional-admin-application.schema';
import {
  VotingEvent,
  VotingEventSchema,
} from '../institutional-voting/schemas/voting-event.schema';
import { InstitutionalAdminApplicationsService } from './services/institutional-admin-applications.service';
import { InstitutionalAdminApplicationsController } from './controllers/institutional-admin-applications.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstitutionalAdminApplication.name, schema: InstitutionalAdminApplicationSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: VotingEvent.name, schema: VotingEventSchema },
    ]),
    HttpModule,
    MailModule,
  ],
  controllers: [InstitutionalAdminApplicationsController],
  providers: [InstitutionalAdminApplicationsService],
  exports: [InstitutionalAdminApplicationsService],
})
export class InstitutionalAdminApplicationsModule {}
