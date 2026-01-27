import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PinataDataMockController,
  PinataMockController,
} from './controllers/pinata-mock.controller';
import { TestingController } from './controllers/testing.controller';
import { TestingSeederService } from './services/testing-seeder.service';
import {
  ElectionConfig,
  ElectionConfigSchema,
} from '../elections/schemas/election-config.schema';
import { Ballot, BallotSchema } from '../ballot/schemas/ballot.schema';
import {
  AttestationCase,
  AttestationCaseSchema,
} from '../attestation/schemas/attestation-case.schema';
import {
  Attestation,
  AttestationSchema,
} from '../attestation/schemas/attestation.schema';
import {
  PoliticalParty,
  PoliticalPartySchema,
} from '../political/schemas/political-party.schema';
import {
  ElectionParty,
  ElectionPartySchema,
} from '../political/schemas/election-party-schema';
import {
  RoledUser,
  RoledUserSchema,
} from '../auth/schemas/roledUser.schema';
import {
  Contract,
  ContractSchema,
} from '../contracts/schemas/contract.schema';
import {
  Department,
  DepartmentSchema,
} from '../geographic/schemas/department.schema';
import {
  Province,
  ProvinceSchema,
} from '../geographic/schemas/province.schema';
import {
  Municipality,
  MunicipalitySchema,
} from '../geographic/schemas/municipality.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Delegate,
  DelegateSchema,
} from '../contracts/schemas/delegate.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ElectionConfig.name, schema: ElectionConfigSchema },
      { name: Ballot.name, schema: BallotSchema },
      { name: AttestationCase.name, schema: AttestationCaseSchema },
      { name: Attestation.name, schema: AttestationSchema },
      { name: PoliticalParty.name, schema: PoliticalPartySchema },
      { name: ElectionParty.name, schema: ElectionPartySchema },
      { name: RoledUser.name, schema: RoledUserSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Province.name, schema: ProvinceSchema },
      { name: Municipality.name, schema: MunicipalitySchema },
      { name: Contract.name, schema: ContractSchema },
      { name: User.name, schema: UserSchema },
      { name: Delegate.name, schema: DelegateSchema },
    ]),
  ],
  controllers: [PinataMockController, PinataDataMockController, TestingController],
  providers: [TestingSeederService],
})
export class MocksModule {}
