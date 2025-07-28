import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PoliticalParty,
  PoliticalPartySchema,
} from './schemas/political-party.schema';
import { PoliticalPartyController } from './controllers/political-party.controller';
import { PoliticalPartyService } from './services/political-party.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PoliticalParty.name, schema: PoliticalPartySchema },
    ]),
  ],
  controllers: [PoliticalPartyController],
  providers: [PoliticalPartyService],
  exports: [PoliticalPartyService],
})
export class PoliticalModule {}
