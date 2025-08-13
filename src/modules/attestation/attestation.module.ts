import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttestationService } from './services/attestation.service';
import { AttestationController } from './controllers/attestation.controller';
import { Attestation, AttestationSchema } from './schemas/attestation.schema';
import { Ballot, BallotSchema } from '../ballot/schemas/ballot.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attestation.name, schema: AttestationSchema },
      { name: Ballot.name, schema: BallotSchema },
    ]),
  ],
  controllers: [AttestationController],
  providers: [AttestationService],
  exports: [AttestationService],
})
export class AttestationModule {}
