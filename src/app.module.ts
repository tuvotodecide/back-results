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
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard';
import { ContractsModule } from './modules/contracts/contracts.module';
import { MocksModule } from './modules/mocks/mocks.module';
import { ZkAuthModule } from './modules/zk-auth/zk-auth.module';
import { WorksheetModule } from './modules/worksheet/worksheet.module';
import { InstitutionalVotingModule } from './modules/institutional-voting/institutional-voting.module';
import { InstitutionalTenantsModule } from './modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalAdminApplicationsModule } from './modules/institutional-admin-applications/institutional-admin-applications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    ContractsModule,
    MocksModule,
    ZkAuthModule,
    WorksheetModule,
    InstitutionalVotingModule,
    InstitutionalTenantsModule,
    InstitutionalAdminApplicationsModule,
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
