import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { InstitutionalAuditModule } from '../institutional-audit/institutional-audit.module';
import { HistoryModule } from '../history/history.module';
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
  InstitutionalAdminInvitation,
  InstitutionalAdminInvitationSchema,
} from './schemas/institutional-admin-invitation.schema';
import {
  NotificationLog,
  NotificationLogSchema,
} from '../notifications/schemas/notification-log.schema';
import {
  VotingEvent,
  VotingEventSchema,
} from '../institutional-voting/schemas/voting-event.schema';
import { InstitutionalAdminApplicationsService } from './services/institutional-admin-applications.service';
import { InstitutionalAdminApplicationsController } from './controllers/institutional-admin-applications.controller';
import { InstitutionalMobileAuthController } from './controllers/institutional-mobile-auth.controller';
import { InstitutionalApplicationReviewGuard } from './guards/institutional-application-review.guard';
import { InstitutionalPublicRateLimitGuard } from './guards/institutional-public-rate-limit.guard';
import { InstitutionalMobileZkAuthGuard } from './auth/institutional-mobile-zk-auth.guard';
import { InstitutionalInvitationMobileZkAuthGuard } from './auth/institutional-invitation-mobile-zk-auth.guard';
import { InstitutionalMobileZkAuthService } from './auth/institutional-mobile-zk-auth.service';
import { INSTITUTIONAL_INVITATION_REGISTRATION_CONTINUATION } from './auth/institutional-mobile-auth.types';
import { OfficialPublicationMobileRateLimitGuard } from '../institutional-voting/auth/official-publication-mobile-rate-limit.guard';
import { InstitutionalVotingModule } from '../institutional-voting/institutional-voting.module';
import { InstitutionalMobileAuthorizationReconciliationWorker } from './services/institutional-mobile-authorization-reconciliation.worker';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstitutionalAdminApplication.name, schema: InstitutionalAdminApplicationSchema },
      { name: InstitutionalAdminInvitation.name, schema: InstitutionalAdminInvitationSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: VotingEvent.name, schema: VotingEventSchema },
    ]),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('app.jwt.secret'),
        signOptions: { expiresIn: configService.get('app.jwt.expirationTime') },
      }),
      inject: [ConfigService],
    }),
    HttpModule,
    MailModule,
    InstitutionalAuditModule,
    HistoryModule,
    InstitutionalVotingModule,
  ],
  controllers: [InstitutionalAdminApplicationsController, InstitutionalMobileAuthController],
  providers: [
    InstitutionalAdminApplicationsService,
    InstitutionalApplicationReviewGuard,
    InstitutionalPublicRateLimitGuard,
    InstitutionalMobileZkAuthGuard,
    InstitutionalInvitationMobileZkAuthGuard,
    InstitutionalMobileZkAuthService,
    {
      provide: INSTITUTIONAL_INVITATION_REGISTRATION_CONTINUATION,
      useExisting: InstitutionalMobileZkAuthService,
    },
    OfficialPublicationMobileRateLimitGuard,
    InstitutionalMobileAuthorizationReconciliationWorker,
  ],
  exports: [InstitutionalAdminApplicationsService],
})
export class InstitutionalAdminApplicationsModule {}
