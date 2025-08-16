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
import { ApiKeyGuard } from './core/guards/api-key.guard';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CoreModule,
    ElectionsModule,
    GeographicModule,
    PoliticalModule,
    BallotModule,
    UsersModule,
    ResultsModule,
    AttestationModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
