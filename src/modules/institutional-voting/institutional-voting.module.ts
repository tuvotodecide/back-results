import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InstitutionalVotingController } from './controllers/institutional-voting.controller';
import { InstitutionalVotingService } from './services/institutional-voting.service';
import { InstitutionalVotingAccessService } from './services/core/institutional-voting-access.service';
import { VotingEventsService } from './services/events/voting-events.service';
import { PadronService } from './services/padron/padron.service';
import { ParticipationService } from './services/participation/participation.service';
import { VotingResultsService } from './services/results/voting-results.service';
import { VotingEvent, VotingEventSchema } from './schemas/voting-event.schema';
import { EventRole, EventRoleSchema } from './schemas/event-role.schema';
import { VotingOption, VotingOptionSchema } from './schemas/voting-option.schema';
import { PadronVersion, PadronVersionSchema } from './schemas/padron-version.schema';
import { PadronEntry, PadronEntrySchema } from './schemas/padron-entry.schema';
import { ComparisonReport, ComparisonReportSchema } from './schemas/comparison-report.schema';
import { Participation, ParticipationSchema } from './schemas/participation.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '../institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '../institutional-tenants/schemas/tenant-admin-assignment.schema';
import { ZkAuthModule } from '../zk-auth/zk-auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VotingEvent.name, schema: VotingEventSchema },
      { name: EventRole.name, schema: EventRoleSchema },
      { name: VotingOption.name, schema: VotingOptionSchema },
      { name: PadronVersion.name, schema: PadronVersionSchema },
      { name: PadronEntry.name, schema: PadronEntrySchema },
      { name: ComparisonReport.name, schema: ComparisonReportSchema },
      { name: Participation.name, schema: ParticipationSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
  ]),
    ZkAuthModule,
  ],
  controllers: [InstitutionalVotingController],
  providers: [
    InstitutionalVotingService,
    InstitutionalVotingAccessService,
    VotingEventsService,
    PadronService,
    ParticipationService,
    VotingResultsService,
  ],
  exports: [InstitutionalVotingService],
})
export class InstitutionalVotingModule {}
