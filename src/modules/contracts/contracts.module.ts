import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contract, ContractSchema } from './schemas/contract.schema';
import { Delegate, DelegateSchema } from './schemas/delegate.schema';
import { ContractsService } from './services/contracts.service';
import { DelegatesService } from './services/delegates.service';
import { ContractsController } from './controllers/contracts.controller';
import { DelegatesController } from './controllers/delegates.controller';
import { RoledUser, RoledUserSchema } from '../auth/schemas/roledUser.schema';
import {
  Department,
  DepartmentSchema,
} from '../geographic/schemas/department.schema';
import {
  Municipality,
  MunicipalitySchema,
} from '../geographic/schemas/municipality.schema';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import {
  Attestation,
  AttestationSchema,
} from '../attestation/schemas/attestation.schema';
import { Ballot, BallotSchema } from '../ballot/schemas/ballot.schema';
import { ClientReportsService } from './services/client-reports.service';
import { ClientReportsController } from './controllers/client-reports.controller';
import { ResultsModule } from '../results/results.module';
import { ClientResultsController } from './controllers/client-results.controller';
import { ClientResultsService } from './services/client-results.service';
import { ElectionsModule } from '../elections/elections.module';
import { GeographicModule } from '../geographic/geographic.module';
import { AttestationAvailabilityGuard } from '@/core/guards/attestation-availability.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contract.name, schema: ContractSchema },
      { name: Delegate.name, schema: DelegateSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Municipality.name, schema: MunicipalitySchema },
      { name: Attestation.name, schema: AttestationSchema },
      { name: Ballot.name, schema: BallotSchema },
    ]),
    UsersModule,
    AuthModule,
    ResultsModule,
    ElectionsModule,
    GeographicModule,
  ],
  controllers: [
    ContractsController,
    DelegatesController,
    ClientReportsController,
    ClientResultsController,
  ],
  providers: [
    ContractsService,
    DelegatesService,
    AttestationAvailabilityGuard,
    ClientReportsService,
    ClientResultsService,
  ],
  exports: [ContractsService, DelegatesService, AttestationAvailabilityGuard],
})
export class ContractsModule {}
