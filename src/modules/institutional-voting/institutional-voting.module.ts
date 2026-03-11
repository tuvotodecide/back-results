import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InstitutionalVotingAdminController } from './controllers/institutional-voting-admin.controller';
import { InstitutionalVotingNewsController } from './controllers/institutional-voting-news.controller';
import { InstitutionalVotingPublicController } from './controllers/institutional-voting-public.controller';
import { InstitutionalVotingService } from './services/institutional-voting.service';
import { InstitutionalVotingAccessService } from './services/core/institutional-voting-access.service';
import { VotingEventsService } from './services/events/voting-events.service';
import { InstitutionalVotingLifecycleService } from './services/events/institutional-voting-lifecycle.service';
import { InstitutionalVotingNotificationsService } from './services/notifications/institutional-voting-notifications.service';
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
  EventResultsSnapshot,
  EventResultsSnapshotSchema,
} from './schemas/event-results-snapshot.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '../institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '../institutional-tenants/schemas/tenant-admin-assignment.schema';
import { ZkAuthModule } from '../zk-auth/zk-auth.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  UserNotification,
  UserNotificationSchema,
} from '../notifications/schemas/user-notification.schema';
import {
  NotificationLog,
  NotificationLogSchema,
} from '../notifications/schemas/notification-log.schema';
import { HttpModule } from '@nestjs/axios';
import { PadronUsersService } from './services/core/padron-users.service';
import { IssuerService } from './services/core/issuer.service';

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
      { name: EventResultsSnapshot.name, schema: EventResultsSnapshotSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: User.name, schema: UserSchema },
      { name: UserNotification.name, schema: UserNotificationSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
    ]),
    ZkAuthModule,
    HttpModule
  ],
  controllers: [
    InstitutionalVotingAdminController,
    InstitutionalVotingPublicController,
    InstitutionalVotingNewsController,
  ],
  providers: [
    InstitutionalVotingService,
    InstitutionalVotingAccessService,
    PadronUsersService,
    IssuerService,
    VotingEventsService,
    InstitutionalVotingLifecycleService,
    InstitutionalVotingNotificationsService,
    PadronService,
    ParticipationService,
    VotingResultsService,
  ],
  exports: [InstitutionalVotingService],
})
export class InstitutionalVotingModule {}
