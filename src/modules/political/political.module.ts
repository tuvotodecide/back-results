import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PoliticalParty,
  PoliticalPartySchema,
} from './schemas/political-party.schema';
import { PoliticalPartyController } from './controllers/political-party.controller';
import { PoliticalPartyService } from './services/political-party.service';
import { ElectionPartyController } from './controllers/election-party.controller';
import { ElectionParty, ElectionPartySchema } from './schemas/election-party-schema';
import { GeographicModule } from '../geographic/geographic.module';


@Module({
  imports: [
    GeographicModule,
    MongooseModule.forFeature([
      { name: PoliticalParty.name, schema: PoliticalPartySchema },
      { name: ElectionParty.name, schema: ElectionPartySchema },
    ]),
  ],
  controllers: [PoliticalPartyController, ElectionPartyController],
  providers: [PoliticalPartyService],
  exports: [PoliticalPartyService],
})
export class PoliticalModule {}
