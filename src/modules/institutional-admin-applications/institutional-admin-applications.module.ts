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
  VotingEvent,
  VotingEventSchema,
} from '../institutional-voting/schemas/voting-event.schema';
import { InstitutionalAdminApplicationsService } from './services/institutional-admin-applications.service';
import { InstitutionalAdminApplicationsController } from './controllers/institutional-admin-applications.controller';
import { InstitutionalApplicationReviewGuard } from './guards/institutional-application-review.guard';
import { InstitutionalPublicRateLimitGuard } from './guards/institutional-public-rate-limit.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstitutionalAdminApplication.name, schema: InstitutionalAdminApplicationSchema },
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
  ],
  controllers: [InstitutionalAdminApplicationsController],
  providers: [
    InstitutionalAdminApplicationsService,
    InstitutionalApplicationReviewGuard,
    InstitutionalPublicRateLimitGuard,
  ],
  exports: [InstitutionalAdminApplicationsService],
})
export class InstitutionalAdminApplicationsModule {}
