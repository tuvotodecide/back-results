import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { GeographicModule } from './modules/geographic/geographic.module';
import { PoliticalModule } from './modules/political/political.module';
import { BallotModule } from './modules/ballot/ballot.module';
import { ResultsModule } from './modules/results/results.module';
import { ElectionsModule } from './modules/elections/elections.module';

@Module({
  imports: [
    CoreModule,
    ElectionsModule,
    GeographicModule,
    PoliticalModule,
    BallotModule,
    ResultsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
