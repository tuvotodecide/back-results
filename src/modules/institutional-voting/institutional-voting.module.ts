import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InstitutionalVotingAdminController } from './controllers/institutional-voting-admin.controller';
import { InstitutionalVotingNewsController } from './controllers/institutional-voting-news.controller';
import { InstitutionalVotingPublicController } from './controllers/institutional-voting-public.controller';
import { InstitutionalVotingPresentialController } from './controllers/institutional-voting-presential.controller';
import { InstitutionalVotingService } from './services/institutional-voting.service';
import { InstitutionalVotingAccessService } from './services/core/institutional-voting-access.service';
import { VotingEventsService } from './services/events/voting-events.service';
import { InstitutionalVotingLifecycleService } from './services/events/institutional-voting-lifecycle.service';
import { InstitutionalVotingNotificationsService } from './services/notifications/institutional-voting-notifications.service';
import { PadronService } from './services/padron/padron.service';
import { ParticipationService } from './services/participation/participation.service';
import { ParticipationAnalyticsService } from './services/participation/participation-analytics.service';
import { ParticipationReportPdfService } from './services/participation/participation-report-pdf.service';
import { VotingResultsService } from './services/results/voting-results.service';
import { VotingEvent, VotingEventSchema } from './schemas/voting-event.schema';
import { EventRole, EventRoleSchema } from './schemas/event-role.schema';
import { VotingOption, VotingOptionSchema } from './schemas/voting-option.schema';
import { PadronVersion, PadronVersionSchema } from './schemas/padron-version.schema';
import { PadronEntry, PadronEntrySchema } from './schemas/padron-entry.schema';
import {
  PadronImportJob,
  PadronImportJobSchema,
} from './schemas/padron-import-job.schema';
import {
  PadronStagingEntry,
  PadronStagingEntrySchema,
} from './schemas/padron-staging-entry.schema';
import {
  PadronCertificate,
  PadronCertificateSchema,
} from './schemas/padron-certificate.schema';
import { ComparisonReport, ComparisonReportSchema } from './schemas/comparison-report.schema';
import { Participation, ParticipationSchema } from './schemas/participation.schema';
import { PresentialSession, PresentialSessionSchema } from './schemas/presential-session.schema';
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
import { MailModule } from '../mail/mail.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { RoledUser, RoledUserSchema } from '../auth/schemas/roledUser.schema';
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
import { PadronCertificatePdfService } from './services/core/padron-certificate-pdf.service';
import { PadronPdfParserService } from './services/core/padron-pdf-parser.service';
import { PadronGeminiImportService } from './services/core/padron-gemini-import.service';
import { FirebaseModule } from '@/core/firebase/firebase.module';
import { VoteReaderService } from './services/core/vote-reader.service';
import { PresentialSessionsService } from './services/presential/presential-sessions.service';
import { VoteWritterService } from './services/core/vote-writter.service';
import { EmitVoteService } from './services/participation/emit-vote.service';
import { EnabledSession, EnabledSessionSchema } from './schemas/enabled-session.shcema';
import { IssuerService } from './services/core/issuer.service';
import { MerkletreeModule } from '../merkletree/merkletree.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VotingEvent.name, schema: VotingEventSchema },
      { name: EventRole.name, schema: EventRoleSchema },
      { name: VotingOption.name, schema: VotingOptionSchema },
      { name: PadronVersion.name, schema: PadronVersionSchema },
      { name: PadronEntry.name, schema: PadronEntrySchema },
      { name: PadronImportJob.name, schema: PadronImportJobSchema },
      { name: PadronStagingEntry.name, schema: PadronStagingEntrySchema },
      { name: PadronCertificate.name, schema: PadronCertificateSchema },
      { name: ComparisonReport.name, schema: ComparisonReportSchema },
      { name: Participation.name, schema: ParticipationSchema },
      { name: PresentialSession.name, schema: PresentialSessionSchema },
      { name: EventResultsSnapshot.name, schema: EventResultsSnapshotSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
      { name: User.name, schema: UserSchema },
      { name: UserNotification.name, schema: UserNotificationSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
      { name: EnabledSession.name, schema: EnabledSessionSchema },
    ]),
    ZkAuthModule,
    MailModule,
    HttpModule,
    FirebaseModule,
    MerkletreeModule,
  ],
  controllers: [
    InstitutionalVotingPublicController,
    InstitutionalVotingAdminController,
    InstitutionalVotingPresentialController,
    InstitutionalVotingNewsController,
  ],
  providers: [
    InstitutionalVotingService,
    InstitutionalVotingAccessService,
    PadronUsersService,
    PadronCertificatePdfService,
    PadronPdfParserService,
    PadronGeminiImportService,
    VoteReaderService,
    VoteWritterService,
    EmitVoteService,
    VotingEventsService,
    InstitutionalVotingLifecycleService,
    InstitutionalVotingNotificationsService,
    PadronService,
    ParticipationService,
    ParticipationAnalyticsService,
    ParticipationReportPdfService,
    PresentialSessionsService,
    VotingResultsService,
    IssuerService,
  ],
  exports: [InstitutionalVotingService],
})
export class InstitutionalVotingModule {}
