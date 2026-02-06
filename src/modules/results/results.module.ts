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
import { BallotModule } from '../ballot/ballot.module';
import { GeographicModule } from '../geographic/geographic.module';
import { ElectionsModule } from '../elections/elections.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ballot.name, schema: BallotSchema },
      { name: ElectoralTable.name, schema: ElectoralTableSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Municipality.name, schema: MunicipalitySchema },
    ]),
    BallotModule,
    GeographicModule,
    ElectionsModule,
  ],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
