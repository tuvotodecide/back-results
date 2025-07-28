import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ResultsService } from './services/results.service';
import { ResultsController } from './controllers/results.controller';
import { Ballot, BallotSchema } from '../ballot/schemas/ballot.schema';
import {
  ElectoralTable,
  ElectoralTableSchema,
} from '../geographic/schemas/electoral-table.schema';
import { BallotModule } from '../ballot/ballot.module';
import { GeographicModule } from '../geographic/geographic.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ballot.name, schema: BallotSchema },
      { name: ElectoralTable.name, schema: ElectoralTableSchema },
    ]),
    BallotModule,
    GeographicModule,
  ],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
