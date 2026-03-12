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
import {
  ElectoralTable,
  ElectoralTableSchema,
} from '../geographic/schemas/electoral-table.schema';
import { OracleResolverService } from './services/oracle-resolver.service';
import { LocksService } from './services/locks.services';
import { ResolverRunsService } from './services/resolver-runs.service';
import { LockSchema } from './schemas/lock.schema';
import { ContractsModule } from '../contracts/contracts.module';
import { ZkAuthModule } from '../zk-auth/zk-auth.module';
import { GeographicModule } from '../geographic/geographic.module';
import {
  BallotComparison,
  BallotComparisonSchema,
} from './schemas/ballot-comparison.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attestation.name, schema: AttestationSchema },
      { name: Ballot.name, schema: BallotSchema },
      { name: AttestationCase.name, schema: AttestationCaseSchema },
      { name: ElectoralTable.name, schema: ElectoralTableSchema },
      { name: BallotComparison.name, schema: BallotComparisonSchema },
      { name: 'Lock', schema: LockSchema, collection: 'locks' },
    ]),
    ElectionsModule,
    UsersModule,
    ContractsModule,
    ZkAuthModule,
    GeographicModule
  ],
  controllers: [AttestationController],
  providers: [
    AttestationService,
    AttestationResolverService,
    OracleResolverService,
    LocksService,
    ResolverRunsService,
  ],
  exports: [AttestationService],
})
export class AttestationModule {}
