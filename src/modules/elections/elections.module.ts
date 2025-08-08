import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ElectionConfig,
  ElectionConfigSchema,
} from './schemas/election-config.schema';
import { ElectionConfigService } from './services/election-config.service';
import { ElectionConfigController } from './controllers/election-config.controller';
import { VotingPeriodGuard } from './guards/voting-period.guard';
import { ResultsPeriodGuard } from './guards/results-period.guard';
import { ElectionConfigGuard } from './guards/election-config.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ElectionConfig.name, schema: ElectionConfigSchema },
    ]),
  ],
  controllers: [ElectionConfigController],
  providers: [
    ElectionConfigService,
    VotingPeriodGuard,
    ResultsPeriodGuard,
    ElectionConfigGuard,
  ],
  exports: [
    ElectionConfigService,
    VotingPeriodGuard,
    ResultsPeriodGuard,
    ElectionConfigGuard,
  ],
})
export class ElectionsModule {}
