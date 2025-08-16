import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttestationService } from './services/attestation.service';
import { AttestationController } from './controllers/attestation.controller';
import { Attestation, AttestationSchema } from './schemas/attestation.schema';
import { Ballot, BallotSchema } from '../ballot/schemas/ballot.schema';
import {
  AttestationCase,
  AttestationCaseSchema,
} from './schemas/attestation-case.schema';
import { ElectionsModule } from '../elections/elections.module';
import { AttestationResolverService } from './services/attestation-resolver.service';
import { UsersModule } from '../users/users.module';
import { ElectoralTable, ElectoralTableSchema } from '../geographic/schemas/electoral-table.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attestation.name, schema: AttestationSchema },
      { name: Ballot.name, schema: BallotSchema },
      { name: AttestationCase.name, schema: AttestationCaseSchema },
      { name: ElectoralTable.name, schema: ElectoralTableSchema },
    ]),
    ElectionsModule,
     UsersModule,
  ],
  controllers: [AttestationController],
  providers: [AttestationService, AttestationResolverService],
  exports: [AttestationService],
})
export class AttestationModule {}
