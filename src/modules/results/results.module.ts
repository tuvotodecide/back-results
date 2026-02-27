import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ResultsService } from './services/results.service';
import { ResultsController } from './controllers/results.controller';
import { Ballot, BallotSchema } from '../ballot/schemas/ballot.schema';
import {
  ElectoralTable,
  ElectoralTableSchema,
} from '../geographic/schemas/electoral-table.schema';
import {
  Department,
  DepartmentSchema,
} from '../geographic/schemas/department.schema';
import {
  Municipality,
  MunicipalitySchema,
} from '../geographic/schemas/municipality.schema';
import { Province, ProvinceSchema } from '../geographic/schemas/province.schema';
import {
  ElectoralSeat,
  ElectoralSeatSchema,
} from '../geographic/schemas/electoral-seat.schema';
import {
  ElectoralLocation,
  ElectoralLocationSchema,
} from '../geographic/schemas/electoral-location.schema';
import { BallotModule } from '../ballot/ballot.module';
import { GeographicModule } from '../geographic/geographic.module';
import { ElectionsModule } from '../elections/elections.module';
import { CanonicalCacheInterceptor } from '@/core/interceptors/canonical-cache.interceptor';
import {
  LiveEffectiveBallot,
  LiveEffectiveBallotSchema,
} from './schemas/live-effective-ballot.schema';
import { LiveProjectionService } from './services/live-projection.service';
import {
  LiveProjectionMeta,
  LiveProjectionMetaSchema,
} from './schemas/live-projection-meta.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ballot.name, schema: BallotSchema },
      { name: ElectoralTable.name, schema: ElectoralTableSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Municipality.name, schema: MunicipalitySchema },
      { name: Province.name, schema: ProvinceSchema },
      { name: ElectoralSeat.name, schema: ElectoralSeatSchema },
      { name: ElectoralLocation.name, schema: ElectoralLocationSchema },
      { name: LiveEffectiveBallot.name, schema: LiveEffectiveBallotSchema },
      { name: LiveProjectionMeta.name, schema: LiveProjectionMetaSchema },
    ]),
    BallotModule,
    GeographicModule,
    ElectionsModule,
  ],
  controllers: [ResultsController],
  providers: [ResultsService, CanonicalCacheInterceptor, LiveProjectionService],
  exports: [ResultsService],
})
export class ResultsModule {}
