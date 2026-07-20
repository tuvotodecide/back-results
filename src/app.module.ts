import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { GeographicModule } from './modules/geographic/geographic.module';
import { PoliticalModule } from './modules/political/political.module';
import { BallotModule } from './modules/ballot/ballot.module';
import { ResultsModule } from './modules/results/results.module';
import { ElectionsModule } from './modules/elections/elections.module';
import { AttestationModule } from './modules/attestation/attestation.module';
import { UsersModule } from './modules/users/users.module';
import { APP_GUARD } from '@nestjs/core';
import { FirebaseModule } from './core/firebase/firebase.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard';
import { ContractsModule } from './modules/contracts/contracts.module';
import { MocksModule } from './modules/mocks/mocks.module';
import { PinataMockModule } from './modules/mocks/pinata-mock.module';
import { ZkAuthModule } from './modules/zk-auth/zk-auth.module';
import { WorksheetModule } from './modules/worksheet/worksheet.module';
import { InstitutionalVotingModule } from './modules/institutional-voting/institutional-voting.module';
import { InstitutionalTenantsModule } from './modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalAdminApplicationsModule } from './modules/institutional-admin-applications/institutional-admin-applications.module';
import { InstitutionalAccessRecoveryRequestsModule } from './modules/institutional-access-recovery-requests/institutional-access-recovery-requests.module';
import { InstitutionalAuditModule } from './modules/institutional-audit/institutional-audit.module';
import { HealthChecksModule } from './modules/health-checks/health-checks.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TvdModule } from './modules/tvd/tvd.module';
import { HistoryModule } from './modules/history/history.module';
import { MerkletreeModule } from './modules/merkletree/merkletree.module';

const mockModules =
  process.env.ENABLE_MOCKS?.toLowerCase() === 'true' ? [MocksModule] : [];

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'assets'),
      serveStaticOptions: {
        redirect: false,
        fallthrough: false,
      },
      serveRoot: '/assets',
    }),
    CoreModule,
    ElectionsModule,
    GeographicModule,
    PoliticalModule,
    BallotModule,
    UsersModule,
    ResultsModule,
    AttestationModule,
    FirebaseModule,
    NotificationsModule,
    AuthModule,
    MailModule,
    HealthChecksModule,
    ContractsModule,
    PinataMockModule,
    ...mockModules,
    ZkAuthModule,
    WorksheetModule,
    InstitutionalVotingModule,
    InstitutionalTenantsModule,
    InstitutionalAdminApplicationsModule,
    InstitutionalAccessRecoveryRequestsModule,
    InstitutionalAuditModule,
    PaymentsModule,
    TvdModule,
    HistoryModule,
    MerkletreeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // {
    //   provide: APP_GUARD,
    //   useClass: JwtAuthGuard,
    // },
  ],
})
export class AppModule {}
