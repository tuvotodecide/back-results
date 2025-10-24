import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ballot, BallotSchema } from './schemas/ballot.schema';
import { BallotService } from './services/ballot.service';
import { BallotController } from './controllers/ballot.controller';
import { GeographicModule } from '../geographic/geographic.module';
import { PoliticalModule } from '../political/political.module';
import { ElectionsModule } from '../elections/elections.module';
import {
  ElectoralTable,
  ElectoralTableSchema,
} from '../geographic/schemas/electoral-table.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ballot.name, schema: BallotSchema },
      { name: ElectoralTable.name, schema: ElectoralTableSchema },
    ]),
    GeographicModule,
    PoliticalModule,
    ElectionsModule,
  ],
  controllers: [BallotController],
  providers: [BallotService],
  exports: [BallotService],
})
export class BallotModule {}
