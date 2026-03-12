// src/modules/mocks/services/testing-seeder.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import {
  ElectionConfig,
  ElectionConfigDocument,
} from '../../elections/schemas/election-config.schema';
import { Ballot, BallotDocument } from '../../ballot/schemas/ballot.schema';
import {
  AttestationCase,
  AttestationCaseDocument,
} from '../../attestation/schemas/attestation-case.schema';
import {
  Attestation,
  AttestationDocument,
} from '../../attestation/schemas/attestation.schema';
import {
  BallotComparison,
  BallotComparisonDocument,
} from '../../attestation/schemas/ballot-comparison.schema';
import {
  PoliticalParty,
  PoliticalPartyDocument,
} from '../../political/schemas/political-party.schema';
import {
  ElectionParty,
  ElectionPartyDocument,
} from '../../political/schemas/election-party-schema';
import {
  RoledUser,
  RoledUserDocument,
} from '../../auth/schemas/roledUser.schema';
import {
  Department,
  DepartmentDocument,
} from '../../geographic/schemas/department.schema';
import {
  Province,
  ProvinceDocument,
} from '../../geographic/schemas/province.schema';
import {
  Municipality,
  MunicipalityDocument,
} from '../../geographic/schemas/municipality.schema';
import {
  ElectoralSeat,
  ElectoralSeatDocument,
} from '../../geographic/schemas/electoral-seat.schema';
import {
  ElectoralLocation,
  ElectoralLocationDocument,
} from '../../geographic/schemas/electoral-location.schema';
import {
  ElectoralTable,
  ElectoralTableDocument,
} from '../../geographic/schemas/electoral-table.schema';
import {
  Contract,
  ContractDocument,
} from '../../contracts/schemas/contract.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  Delegate,
  DelegateDocument,
} from '../../contracts/schemas/delegate.schema';

// Prefijo para identificar datos de prueba
const TEST_PREFIX = 'TEST_E2E_';
const TEST_PASSWORD = 'test1234'; // Contraseña para todos los usuarios de prueba
const AUDIT_PREFIX = 'TEST_AUDIT_';
const AUDIT_PASSWORD = 'audit1234';

// Usuarios de prueba
const MOCK_USERS = [
  {
    email: 'gobernador.lapaz@test.local',
    name: 'Gobernador La Paz Test',
    dni: 'TEST_GOB_LP',
    role: 'GOVERNOR' as const,
    department: 'La Paz',
  },
  {
    email: 'gobernador.cochabamba@test.local',
    name: 'Gobernador Cochabamba Test',
    dni: 'TEST_GOB_CBB',
    role: 'GOVERNOR' as const,
    department: 'Cochabamba',
  },
  {
    email: 'alcalde.lapaz@test.local',
    name: 'Alcalde La Paz Test',
    dni: 'TEST_ALC_LP',
    role: 'MAYOR' as const,
    department: 'La Paz',
    municipality: 'Nuestra Señora de La Paz',
  },
  {
    email: 'alcalde.cochabamba@test.local',
    name: 'Alcalde Cochabamba Test',
    dni: 'TEST_ALC_CBB',
    role: 'MAYOR' as const,
    department: 'Cochabamba',
    municipality: 'Cochabamba',
  },
];

// Partidos de prueba
const MOCK_PARTIES = [
  { partyId: 'partido_azul', fullName: 'Partido Azul', shortName: 'PA', color: '#2196F3' },
  { partyId: 'partido_rojo', fullName: 'Partido Rojo', shortName: 'PR', color: '#F44336' },
  { partyId: 'partido_verde', fullName: 'Partido Verde', shortName: 'PV', color: '#4CAF50' },
  { partyId: 'partido_amarillo', fullName: 'Partido Amarillo', shortName: 'PAM', color: '#FFEB3B' },
];

// Delegados de prueba (usuarios normales que atestiguan)
const MOCK_DELEGATES = [
  // Delegados para Gobernador La Paz
  {
    dni: 'TEST_DEL_GOB_LP_1',
    name: 'Delegado 1 Gobernador La Paz',
    email: 'delegado1.gob.lapaz@test.local',
    phone: '+591 70000001',
    forClient: 'TEST_GOB_LP',
  },
  {
    dni: 'TEST_DEL_GOB_LP_2',
    name: 'Delegado 2 Gobernador La Paz',
    email: 'delegado2.gob.lapaz@test.local',
    phone: '+591 70000002',
    forClient: 'TEST_GOB_LP',
  },
  {
    dni: 'TEST_DEL_GOB_LP_3',
    name: 'Delegado 3 Gobernador La Paz',
    email: 'delegado3.gob.lapaz@test.local',
    phone: '+591 70000003',
    forClient: 'TEST_GOB_LP',
  },
  // Delegados para Gobernador Cochabamba
  {
    dni: 'TEST_DEL_GOB_CBB_1',
    name: 'Delegado 1 Gobernador Cochabamba',
    email: 'delegado1.gob.cochabamba@test.local',
    phone: '+591 70000004',
    forClient: 'TEST_GOB_CBB',
  },
  {
    dni: 'TEST_DEL_GOB_CBB_2',
    name: 'Delegado 2 Gobernador Cochabamba',
    email: 'delegado2.gob.cochabamba@test.local',
    phone: '+591 70000005',
    forClient: 'TEST_GOB_CBB',
  },
  // Delegados para Alcalde La Paz
  {
    dni: 'TEST_DEL_ALC_LP_1',
    name: 'Delegado 1 Alcalde La Paz',
    email: 'delegado1.alc.lapaz@test.local',
    phone: '+591 70000006',
    forClient: 'TEST_ALC_LP',
  },
  {
    dni: 'TEST_DEL_ALC_LP_2',
    name: 'Delegado 2 Alcalde La Paz',
    email: 'delegado2.alc.lapaz@test.local',
    phone: '+591 70000007',
    forClient: 'TEST_ALC_LP',
  },
  {
    dni: 'TEST_DEL_ALC_LP_3',
    name: 'Delegado 3 Alcalde La Paz',
    email: 'delegado3.alc.lapaz@test.local',
    phone: '+591 70000008',
    forClient: 'TEST_ALC_LP',
  },
  // Delegados para Alcalde Cochabamba
  {
    dni: 'TEST_DEL_ALC_CBB_1',
    name: 'Delegado 1 Alcalde Cochabamba',
    email: 'delegado1.alc.cochabamba@test.local',
    phone: '+591 70000009',
    forClient: 'TEST_ALC_CBB',
  },
  {
    dni: 'TEST_DEL_ALC_CBB_2',
    name: 'Delegado 2 Alcalde Cochabamba',
    email: 'delegado2.alc.cochabamba@test.local',
    phone: '+591 70000010',
    forClient: 'TEST_ALC_CBB',
  },
  // Delegados multi-contrato (trabajan para varios clientes)
  {
    dni: 'TEST_DEL_MULTI_1',
    name: 'Delegado Multi-contrato 1',
    email: 'delegado.multi1@test.local',
    phone: '+591 70000011',
    forClient: ['TEST_GOB_LP', 'TEST_ALC_LP'], // Trabaja para ambos en La Paz
  },
  {
    dni: 'TEST_DEL_MULTI_2',
    name: 'Delegado Multi-contrato 2',
    email: 'delegado.multi2@test.local',
    phone: '+591 70000012',
    forClient: ['TEST_GOB_CBB', 'TEST_ALC_CBB'], // Trabaja para ambos en Cochabamba
  },
];

// Ubicaciones de prueba
const MOCK_LOCATIONS = [
  {
    department: 'La Paz',
    province: 'Murillo',
    municipality: 'Nuestra Señora de La Paz',
    electoralSeat: 'Nuestra Señora de La Paz',
    electoralLocationName: 'U. E. Club de Leones Nro. 2',
    district: 'DISTRITO 1',
    zone: 'Zona Central',
    circunscripcion: { number: 1, type: 'Uninominal', name: 'Primera-La Paz' },
    coordinates: { latitude: -16.5, longitude: -68.15 },
  },
  {
    department: 'La Paz',
    province: 'Murillo',
    municipality: 'El Alto',
    electoralSeat: 'El Alto',
    electoralLocationName: 'U. E. Brasil',
    district: 'DISTRITO 2',
    zone: 'Zona Norte',
    circunscripcion: { number: 2, type: 'Uninominal', name: 'Segunda-El Alto' },
    coordinates: { latitude: -16.52, longitude: -68.17 },
  },
  {
    department: 'Cochabamba',
    province: 'Cercado',
    municipality: 'Cochabamba',
    electoralSeat: 'Cochabamba',
    electoralLocationName: 'Colegio Abaroa',
    district: 'DISTRITO 1',
    zone: 'Zona Sur',
    circunscripcion: { number: 10, type: 'Uninominal', name: 'Decima-Cochabamba' },
    coordinates: { latitude: -17.38, longitude: -66.16 },
  },
  {
    department: 'Santa Cruz',
    province: 'Andrés Ibáñez',
    municipality: 'Santa Cruz de la Sierra',
    electoralSeat: 'Santa Cruz de la Sierra',
    electoralLocationName: '16 de Julio',
    district: 'DISTRITO 1',
    zone: 'Zona Este',
    circunscripcion: { number: 20, type: 'Uninominal', name: 'Vigesima-Santa Cruz' },
    coordinates: { latitude: -17.78, longitude: -63.18 },
  },
];

type SeededGeography = {
  departmentId: Types.ObjectId;
  provinceId: Types.ObjectId;
  municipalityId: Types.ObjectId;
  electoralSeatId: Types.ObjectId;
  electoralLocationId: Types.ObjectId;
  tables: Array<{
    tableId: Types.ObjectId;
    tableCode: string;
    tableNumber: string;
  }>;
};

@Injectable()
export class TestingSeederService {
  private readonly logger = new Logger(TestingSeederService.name);

  constructor(
    @InjectModel(ElectionConfig.name)
    private electionConfigModel: Model<ElectionConfigDocument>,
    @InjectModel(Ballot.name)
    private ballotModel: Model<BallotDocument>,
    @InjectModel(AttestationCase.name)
    private attestationCaseModel: Model<AttestationCaseDocument>,
    @InjectModel(PoliticalParty.name)
    private politicalPartyModel: Model<PoliticalPartyDocument>,
    @InjectModel(ElectionParty.name)
    private electionPartyModel: Model<ElectionPartyDocument>,
    @InjectModel(RoledUser.name)
    private roledUserModel: Model<RoledUserDocument>,
    @InjectModel(Department.name)
    private departmentModel: Model<DepartmentDocument>,
    @InjectModel(Province.name)
    private provinceModel: Model<ProvinceDocument>,
    @InjectModel(Municipality.name)
    private municipalityModel: Model<MunicipalityDocument>,
    @InjectModel(ElectoralSeat.name)
    private electoralSeatModel: Model<ElectoralSeatDocument>,
    @InjectModel(ElectoralLocation.name)
    private electoralLocationModel: Model<ElectoralLocationDocument>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTableDocument>,
    @InjectModel(Contract.name)
    private contractModel: Model<ContractDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(Delegate.name)
    private delegateModel: Model<DelegateDocument>,
    @InjectModel(Attestation.name)
    private attestationModel: Model<AttestationDocument>,
    @InjectModel(BallotComparison.name)
    private ballotComparisonModel: Model<BallotComparisonDocument>,
  ) {}

  /**
   * Crea todos los datos de prueba para e2e testing
   */
  async seedAll(): Promise<{
    elections: any[];
    parties: any[];
    ballots: any[];
    attestationCases: any[];
    users: any[];
    contracts: any[];
    delegateUsers: any[];
    delegates: any[];
    attestations: any[];
  }> {
    this.logger.log('🌱 Iniciando seed de datos de prueba...');

    // 1. Crear partidos políticos de prueba
    const parties = await this.seedParties();

    // 2. Crear elecciones (departamental y municipal)
    const elections = await this.seedElections();

    // 3. Asociar partidos a elecciones
    await this.seedElectionParties(elections, parties);

    // 4. Validar geografia existente para los usuarios de prueba
    const geography = await this.seedGeography();

    // 5. Crear ballots con resultados
    const ballots = await this.seedBallots(elections, parties, geography);

    // 6. Crear attestation cases resueltos
    const attestationCases = await this.seedAttestationCases(elections, ballots);

    // 7. Crear usuarios de prueba (GOVERNOR y MAYOR)
    const users = await this.seedUsers();

    // 8. Crear contratos para los usuarios
    const contracts = await this.seedContracts(elections, users);

    // 9. Crear usuarios delegados (User collection)
    const delegateUsers = await this.seedDelegateUsers();

    // 10. Crear delegados asociados a contratos
    const delegates = await this.seedDelegates(delegateUsers, contracts, users);

    // 11. Crear attestations (votos de delegados sobre ballots)
    const attestations = await this.seedAttestations(
      elections,
      ballots,
      delegateUsers,
      delegates,
      contracts,
    );

    this.logger.log('✅ Seed completado exitosamente');

    return {
      elections,
      parties,
      ballots,
      attestationCases,
      users,
      contracts,
      delegateUsers,
      delegates,
      attestations,
    };
  }

  async seedAuditDemo(): Promise<{
    election: any;
    admin: any;
    client: any;
    delegateUser: any;
    delegate: any;
    contract: any;
    ballots: any[];
  }> {
    this.logger.log('🌱 Creando demo de auditoría TSE...');

    const hashedPassword = await bcrypt.hash(AUDIT_PASSWORD, 10);
    const now = new Date();
    const auditElectionName = 'Elección Gobernadores 2026';
    const auditElectionType = 'presidential';

    await this.electionConfigModel.updateMany(
      {
        type: auditElectionType,
        isActive: true,
        name: { $ne: auditElectionName },
      },
      {
        $set: {
          isActive: false,
        },
      },
    );

    const election = await this.electionConfigModel.findOneAndUpdate(
      { name: auditElectionName },
      {
        $set: {
          name: auditElectionName,
          votingStartDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          votingEndDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          resultsStartDate: new Date(now.getTime() - 60 * 60 * 1000),
          isActive: true,
          allowDataModification: false,
          timezone: 'America/La_Paz',
          type: auditElectionType,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const department = await this.departmentModel.findOneAndUpdate(
      { name: 'La Paz' },
      { $setOnInsert: { name: 'La Paz' } },
      { upsert: true, new: true },
    );
    const province = await this.provinceModel.findOneAndUpdate(
      { name: 'Murillo', departmentId: department._id },
      { $setOnInsert: { name: 'Murillo', departmentId: department._id } },
      { upsert: true, new: true },
    );
    const municipality = await this.municipalityModel.findOneAndUpdate(
      { name: 'Nuestra Señora de La Paz', provinceId: province._id },
      {
        $setOnInsert: {
          name: 'Nuestra Señora de La Paz',
          provinceId: province._id,
        },
      },
      { upsert: true, new: true },
    );
    const seat = await this.electoralSeatModel.findOneAndUpdate(
      {
        municipalityId: municipality._id,
        idLoc: 'AUDIT_SEAT_001',
      },
      {
        $set: {
          idLoc: 'AUDIT_SEAT_001',
          name: 'Centro de Votacion San Miguel',
          municipalityId: municipality._id,
        },
      },
      { upsert: true, new: true },
    );
    const location = await this.electoralLocationModel.findOneAndUpdate(
      {
        electoralSeatId: seat._id,
        code: 'AUDIT_REC_001',
      },
      {
        $set: {
          fid: 'AUDIT_FID_001',
          code: 'AUDIT_REC_001',
          name: 'Unidad Educativa San Miguel',
          address: 'Av. Costanera Nro. 2450',
          district: 'Distrito 2',
          zone: 'San Miguel',
          circunscripcion: {
            number: 1,
            type: 'Uninominal',
            name: 'Circunscripcion 1',
          },
          coordinates: {
            latitude: -16.5405,
            longitude: -68.0893,
          },
          geo: {
            type: 'Point',
            coordinates: [-68.0893, -16.5405],
          },
          electoralSeatId: seat._id,
        },
      },
      { upsert: true, new: true },
    );

    const admin = await this.roledUserModel.findOneAndUpdate(
      { email: 'audit.admin@test.local' },
      {
        $set: {
          dni: '10203040',
          email: 'audit.admin@test.local',
          name: 'Ana Torres',
          password: hashedPassword,
          role: 'ADMIN',
          active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const client = await this.roledUserModel.findOneAndUpdate(
      { email: 'audit.governor@test.local' },
      {
        $set: {
          dni: '49876540',
          email: 'audit.governor@test.local',
          name: 'Carlos Mendoza',
          password: hashedPassword,
          role: 'GOVERNOR',
          active: true,
          votingDepartmentId: department._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const contract = await this.contractModel.findOneAndUpdate(
      {
        clientId: client._id,
        electionId: election._id,
      },
      {
        $set: {
          active: true,
          clientId: client._id,
          clientRole: 'GOVERNOR',
          departmentId: department._id,
          departmentName: 'La Paz',
          municipalityId: null,
          municipalityName: null,
          electionId: election._id,
          startDate: new Date(now.getTime() - 12 * 60 * 60 * 1000),
          endDate: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const delegateUser = await this.userModel.findOneAndUpdate(
      { dni: '8045123' },
      {
        $set: {
          dni: '8045123',
          active: true,
          votingLocationId: location._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const delegate = await this.delegateModel.findOneAndUpdate(
      { dni: '8045123' },
      {
        $set: {
          dni: '8045123',
          userId: delegateUser._id,
          active: true,
          name: 'Mariela Rojas',
          email: 'mariela.rojas.demo@test.local',
          phone: '+59171234567',
          authorizedContracts: [
            {
              contractId: contract._id,
              clientId: client._id,
              clientRole: 'GOVERNOR',
              addedAt: new Date(),
              addedBy: admin._id,
            },
          ],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await this.politicalPartyModel.findOneAndUpdate(
      { partyId: `${AUDIT_PREFIX.toLowerCase()}pdc` },
      {
        $set: {
          partyId: `${AUDIT_PREFIX.toLowerCase()}pdc`,
          fullName: 'Partido Demócrata Cristiano',
          shortName: 'PDC',
          color: '#0055AA',
          active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await this.politicalPartyModel.findOneAndUpdate(
      { partyId: `${AUDIT_PREFIX.toLowerCase()}libre` },
      {
        $set: {
          partyId: `${AUDIT_PREFIX.toLowerCase()}libre`,
          fullName: 'Alianza Libre',
          shortName: 'LIBRE',
          color: '#228B22',
          active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await this.electionPartyModel.findOneAndUpdate(
      {
        electionId: election._id,
        partyId: `${AUDIT_PREFIX.toLowerCase()}pdc`,
        departmentId: null,
        municipalityId: null,
      },
      {
        $set: {
          electionId: election._id,
          partyId: `${AUDIT_PREFIX.toLowerCase()}pdc`,
          active: true,
          ballotNumber: 1,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await this.electionPartyModel.findOneAndUpdate(
      {
        electionId: election._id,
        partyId: `${AUDIT_PREFIX.toLowerCase()}libre`,
        departmentId: null,
        municipalityId: null,
      },
      {
        $set: {
          electionId: election._id,
          partyId: `${AUDIT_PREFIX.toLowerCase()}libre`,
          active: true,
          ballotNumber: 2,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const tableCodes = ['2010701', '2010691'];
    for (const tableCode of tableCodes) {
      await this.electoralTableModel.findOneAndUpdate(
        { tableCode },
        {
          $set: {
            tableCode,
            tableNumber: tableCode,
            electoralLocationId: location._id,
            active: true,
            observedByElection: {},
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    const commonLocation = {
      department: 'La Paz',
      departmentId: department._id,
      province: 'Murillo',
      provinceId: province._id,
      municipality: 'Nuestra Señora de La Paz',
      municipalityId: municipality._id,
      electoralSeat: seat.name,
      electoralLocationName: location.name,
      district: 'Distrito 2',
      zone: 'San Miguel',
      circunscripcion: {
        number: 1,
        type: 'Uninominal',
        name: 'Circunscripcion 1',
      },
    };

    const ballotSpecs = [
      {
        tableCode: '2010701',
        tableNumber: '2010701',
        votes: {
          validVotes: 208,
          blankVotes: 0,
          nullVotes: 11,
          totalVotes: 219,
          partyVotes: [
            { partyId: `${AUDIT_PREFIX.toLowerCase()}pdc`, votes: 110 },
            { partyId: `${AUDIT_PREFIX.toLowerCase()}libre`, votes: 98 },
          ],
        },
      },
      {
        tableCode: '2010691',
        tableNumber: '2010691',
        votes: {
          validVotes: 208,
          blankVotes: 1,
          nullVotes: 6,
          totalVotes: 215,
          partyVotes: [
            { partyId: `${AUDIT_PREFIX.toLowerCase()}pdc`, votes: 100 },
            { partyId: `${AUDIT_PREFIX.toLowerCase()}libre`, votes: 108 },
          ],
        },
      },
    ];

    const ballots: any[] = [];
    for (const spec of ballotSpecs) {
      const ballot = await this.ballotModel.findOneAndUpdate(
        {
          electionId: election._id,
          tableCode: spec.tableCode,
          version: 1,
        },
        {
          $set: {
            electionId: election._id,
            tableCode: spec.tableCode,
            tableNumber: spec.tableNumber,
            electoralLocationId: location._id,
            location: commonLocation,
            votes: { parties: spec.votes },
            ipfsUri: `ipfs://${AUDIT_PREFIX.toLowerCase()}${spec.tableCode}`,
            ipfsCid: `${AUDIT_PREFIX.toLowerCase()}${spec.tableCode}`,
            image: `https://example.com/${spec.tableCode}.jpg`,
            recordId: `${AUDIT_PREFIX}${spec.tableCode}`,
            tableIdIpfs: spec.tableCode,
            hasObservation: false,
            status: 'processed',
            valuable: true,
            version: 1,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      ballots.push(ballot);

      await this.attestationCaseModel.findOneAndUpdate(
        { electionId: election._id, tableCode: spec.tableCode },
        {
          $set: {
            electionId: election._id,
            tableCode: spec.tableCode,
            status: 'CONSENSUAL',
            winningBallotId: ballot._id,
            resolvedAt: new Date(),
            summary: {},
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      await this.attestationModel.findOneAndUpdate(
        { userId: delegateUser._id, ballotId: ballot._id },
        {
          $set: {
            support: true,
            electionId: election._id,
            ballotId: ballot._id,
            isJury: false,
            userId: delegateUser._id,
            validForContractId: contract._id,
            isValidForClientReport: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    this.logger.log('✅ Demo de auditoría creada');

    return {
      election,
      admin,
      client,
      delegateUser,
      delegate,
      contract,
      ballots,
    };
  }

  /**
   * Elimina todos los datos de prueba
   */
  async cleanupAll(): Promise<{
    deletedElections: number;
    deletedBallots: number;
    deletedAttestationCases: number;
    deletedAttestations: number;
    deletedParties: number;
    deletedElectionParties: number;
    deletedUsers: number;
    deletedContracts: number;
    deletedDelegateUsers: number;
    deletedDelegates: number;
    deletedElectoralTables: number;
    deletedElectoralLocations: number;
    deletedElectoralSeats: number;
  }> {
    this.logger.log('🧹 Limpiando datos de prueba...');
    const testNameRegex = new RegExp(`^(${TEST_PREFIX}|${AUDIT_PREFIX})`);
    const testPartyRegex = new RegExp(
      `^(${TEST_PREFIX.toLowerCase()}|${AUDIT_PREFIX.toLowerCase()})`,
    );
    const auditElectionNames = ['Elección Gobernadores 2026'];
    const auditRoledUserEmails = [
      'audit.admin@test.local',
      'audit.governor@test.local',
    ];
    const auditDelegateDnis = ['8045123'];

    // Obtener IDs de elecciones de prueba
    const testElections = await this.electionConfigModel.find({
      $or: [
        { name: { $regex: testNameRegex } },
        { name: { $in: auditElectionNames } },
      ],
    });
    const electionIds = testElections.map((e) => e._id);

    // Obtener IDs de usuarios de prueba (RoledUser - candidatos)
    const testRoledUsers = await this.roledUserModel.find({
      $or: [
        { dni: { $regex: testNameRegex } },
        { email: { $in: auditRoledUserEmails } },
      ],
    });
    const roledUserIds = testRoledUsers.map((u) => u._id);

    // Obtener IDs de usuarios delegados (User collection)
    const testDelegateUsers = await this.userModel.find({
      $or: [
        { dni: { $regex: testNameRegex } },
        { dni: { $in: auditDelegateDnis } },
      ],
    });
    const delegateUserIds = testDelegateUsers.map((u) => u._id);

    // Eliminar en orden inverso a la creación

    // 1. Eliminar attestations (votos de delegados)
    const deletedAttestations = await this.attestationModel.deleteMany({
      $or: [
        { electionId: { $in: electionIds } },
        { userId: { $in: delegateUserIds } },
      ],
    });
    await this.ballotComparisonModel.deleteMany({
      electionId: { $in: electionIds },
    });

    // 2. Eliminar delegates
    const deletedDelegates = await this.delegateModel.deleteMany({
      $or: [
        { dni: { $regex: testNameRegex } },
        { dni: { $in: auditDelegateDnis } },
      ],
    });

    // 3. Eliminar usuarios delegados (User collection)
    const deletedDelegateUsers = await this.userModel.deleteMany({
      $or: [
        { dni: { $regex: testNameRegex } },
        { dni: { $in: auditDelegateDnis } },
      ],
    });

    // 4. Eliminar contratos
    const deletedContracts = await this.contractModel.deleteMany({
      $or: [
        { electionId: { $in: electionIds } },
        { clientId: { $in: roledUserIds } },
      ],
    });

    // 5. Eliminar usuarios candidatos (RoledUser)
    const deletedUsers = await this.roledUserModel.deleteMany({
      $or: [
        { dni: { $regex: testNameRegex } },
        { email: { $in: auditRoledUserEmails } },
      ],
    });

    // 6. Eliminar attestation cases
    const deletedAttestationCases = await this.attestationCaseModel.deleteMany({
      electionId: { $in: electionIds },
    });

    // 7. Eliminar ballots
    const deletedBallots = await this.ballotModel.deleteMany({
      electionId: { $in: electionIds },
    });

    // 7b. No eliminar geografÃ­a existente (mesas/recintos/asientos)
    const deletedElectoralTables = 0;
    const deletedElectoralLocations = 0;
    const deletedElectoralSeats = 0;

    // 8. Eliminar election parties
    const deletedElectionParties = await this.electionPartyModel.deleteMany({
      electionId: { $in: electionIds },
    });

    // 9. Eliminar elecciones
    const deletedElections = await this.electionConfigModel.deleteMany({
      $or: [
        { name: { $regex: testNameRegex } },
        { name: { $in: auditElectionNames } },
      ],
    });

    // 10. Eliminar partidos
    const deletedParties = await this.politicalPartyModel.deleteMany({
      partyId: { $regex: testPartyRegex },
    });

    this.logger.log('✅ Limpieza completada');

    return {
      deletedElections: deletedElections.deletedCount,
      deletedBallots: deletedBallots.deletedCount,
      deletedAttestationCases: deletedAttestationCases.deletedCount,
      deletedAttestations: deletedAttestations.deletedCount,
      deletedParties: deletedParties.deletedCount,
      deletedElectionParties: deletedElectionParties.deletedCount,
      deletedUsers: deletedUsers.deletedCount,
      deletedContracts: deletedContracts.deletedCount,
      deletedDelegateUsers: deletedDelegateUsers.deletedCount,
      deletedDelegates: deletedDelegates.deletedCount,
      deletedElectoralTables,
      deletedElectoralLocations,
      deletedElectoralSeats,
    };
  }

  private async seedParties(): Promise<PoliticalPartyDocument[]> {
    const parties: PoliticalPartyDocument[] = [];

    for (const party of MOCK_PARTIES) {
      const testPartyId = `${TEST_PREFIX.toLowerCase()}${party.partyId}`;

      // Usar upsert para evitar duplicados
      const doc = await this.politicalPartyModel.findOneAndUpdate(
        { partyId: testPartyId },
        {
          $set: {
            partyId: testPartyId,
            fullName: `${TEST_PREFIX}${party.fullName}`,
            shortName: party.shortName,
            color: party.color,
            active: true,
          },
        },
        { upsert: true, new: true },
      );
      parties.push(doc);
    }

    this.logger.log(`✅ ${parties.length} partidos creados/actualizados`);
    return parties;
  }

  private async seedElections(): Promise<Array<ElectionConfigDocument & { _id: Types.ObjectId }>> {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Ayer

    const electionsData = [
      {
        name: `${TEST_PREFIX}Eleccion_Gobernadores_2025`,
        type: 'departamental',
        votingStartDate: pastDate,
        votingEndDate: pastDate,
        resultsStartDate: pastDate,
        isActive: true,
        allowDataModification: false,
        timezone: 'America/La_Paz',
        round: 1,
      },
      {
        name: `${TEST_PREFIX}Eleccion_Alcaldes_2025`,
        type: 'municipal',
        votingStartDate: pastDate,
        votingEndDate: pastDate,
        resultsStartDate: pastDate,
        isActive: true,
        allowDataModification: false,
        timezone: 'America/La_Paz',
        round: 1,
      },
    ];

    const elections: Array<ElectionConfigDocument & { _id: Types.ObjectId }> = [];

    // Paso 1: Crear/actualizar elecciones de prueba como INACTIVAS primero
    for (const electionData of electionsData) {
      const doc = await this.electionConfigModel.findOneAndUpdate(
        { name: electionData.name },
        { $set: { ...electionData, isActive: false } },
        { upsert: true, new: true },
      );
      if (doc) {
        elections.push(doc as ElectionConfigDocument & { _id: Types.ObjectId });
      }
    }

    // Paso 2: Desactivar TODAS las otras elecciones de los mismos tipos
    const testElectionNames = electionsData.map((e) => e.name);
    for (const electionData of electionsData) {
      await this.electionConfigModel.updateMany(
        {
          type: electionData.type,
          isActive: true,
          name: { $nin: testElectionNames },
        },
        { $set: { isActive: false } },
      );
    }

    // Paso 3: Ahora activar las elecciones de prueba
    for (const election of elections) {
      await this.electionConfigModel.updateOne(
        { _id: election._id },
        { $set: { isActive: true } },
      );
      election.isActive = true;
    }

    this.logger.log(`✅ ${elections.length} elecciones creadas/actualizadas`);
    return elections;
  }

  private async seedElectionParties(
    elections: Array<ElectionConfigDocument & { _id: Types.ObjectId }>,
    parties: PoliticalPartyDocument[],
  ): Promise<void> {
    for (const election of elections) {
      for (let i = 0; i < parties.length; i++) {
        const party = parties[i];
        await this.electionPartyModel.findOneAndUpdate(
          {
            electionId: election._id,
            partyId: party.partyId,
            departmentId: null,
            municipalityId: null,
          },
          {
            $set: {
              electionId: election._id,
              partyId: party.partyId,
              active: true,
              ballotNumber: i + 1,
              color: party.color,
            },
          },
          { upsert: true },
        );
      }
    }

    this.logger.log(`✅ Partidos asociados a elecciones`);
  }

  private async seedBallots(
    elections: Array<ElectionConfigDocument & { _id: Types.ObjectId }>,
    parties: PoliticalPartyDocument[],
    geography: SeededGeography[],
  ): Promise<BallotDocument[]> {
    const ballots: BallotDocument[] = [];

    for (const election of elections) {
      // Crear múltiples ballots por ubicación
      for (let locIdx = 0; locIdx < MOCK_LOCATIONS.length; locIdx++) {
        const location = MOCK_LOCATIONS[locIdx];
        const geo = geography[locIdx];
        if (!geo) {
          this.logger.warn(`Geografia faltante para locIdx=${locIdx}, omitiendo ballots`);
          continue;
        }
        const locationData: any = {
          ...location,
          departmentId: geo.departmentId,
          provinceId: geo.provinceId,
          municipalityId: geo.municipalityId,
        };

        // Mesas existentes por ubicacion
        if (!geo.tables || geo.tables.length === 0) {
          this.logger.warn(
            `No hay mesas activas para locIdx=${locIdx} (${location.electoralLocationName})`,
          );
          continue;
        }

        for (const table of geo.tables) {
          const tableCode = table.tableCode?.toString().trim();
          const tableNumber = table.tableNumber?.toString().trim();

          if (!tableCode) {
            throw new Error(
              `Mesa sin tableCode en recinto ${location.electoralLocationName}`,
            );
          }

          if (!tableNumber) {
            throw new Error(
              `Mesa sin tableNumber en recinto ${location.electoralLocationName}`,
            );
          }

          // Generar votos aleatorios pero realistas
          const partyVotes = parties.map((party) => ({
            partyId: party.partyId,
            votes: Math.floor(Math.random() * 100) + 10,
          }));

          const validVotes = partyVotes.reduce((sum, p) => sum + p.votes, 0);
          const nullVotes = Math.floor(Math.random() * 10) + 1;
          const blankVotes = Math.floor(Math.random() * 5) + 1;

          // Generar votos secundarios (diputados/asambleístas/concejales)
          // En la misma acta van los candidatos secundarios
          const deputyVotes = parties.map((party) => ({
            partyId: party.partyId,
            votes: Math.floor(Math.random() * 80) + 5,
          }));
          const deputyValidVotes = deputyVotes.reduce((sum, p) => sum + p.votes, 0);
          const deputyNullVotes = Math.floor(Math.random() * 8) + 1;
          const deputyBlankVotes = Math.floor(Math.random() * 4) + 1;

          const ballotData = {
            tableNumber,
            tableCode,
            electionId: election._id,
            electoralLocationId: geo.electoralLocationId,
            location: locationData,
            votes: {
              // Votos principales: presidente/gobernador/alcalde
              parties: {
                validVotes,
                nullVotes,
                blankVotes,
                partyVotes,
                totalVotes: validVotes + nullVotes + blankVotes,
              },
              // Votos secundarios: diputados/asambleístas/concejales
              deputies: {
                validVotes: deputyValidVotes,
                nullVotes: deputyNullVotes,
                blankVotes: deputyBlankVotes,
                partyVotes: deputyVotes,
                totalVotes: deputyValidVotes + deputyNullVotes + deputyBlankVotes,
              },
            },
            ipfsUri: `https://ipfs.io/ipfs/TEST_CID_${tableCode}`,
            ipfsCid: `TEST_CID_${tableCode}`,
            image: `https://placeholder.com/ballot_${tableCode}.png`,
            recordId: `TEST_RECORD_${tableCode}`,
            tableIdIpfs: `TEST_TABLE_${tableCode}`,
            status: 'processed',
            valuable: true,
            version: 1,
          };

          try {
            const ballot = await this.ballotModel.findOneAndUpdate(
              { electionId: election._id, tableCode, version: 1 },
              { $set: ballotData },
              { upsert: true, new: true },
            );
            ballots.push(ballot);
          } catch (err) {
            this.logger.warn(`Ballot ${tableCode} ya existe, omitiendo...`);
          }
        }
      }
    }

    this.logger.log(`✅ ${ballots.length} ballots creados/actualizados`);
    return ballots;
  }

  private async seedAttestationCases(
    elections: Array<ElectionConfigDocument & { _id: Types.ObjectId }>,
    ballots: BallotDocument[],
  ): Promise<AttestationCaseDocument[]> {
    const cases: AttestationCaseDocument[] = [];

    for (const election of elections) {
      const electionBallots = ballots.filter(
        (b) => b.electionId.toString() === election._id.toString(),
      );

      for (const ballot of electionBallots) {
        try {
          const caseData = {
            tableCode: ballot.tableCode,
            electionId: election._id,
            status: 'CONSENSUAL' as const,
            winningBallotId: ballot._id,
            resolvedAt: new Date(),
            summary: {
              totalVotes: ballot.votes?.parties?.totalVotes || 0,
              method: 'TEST_SEED',
            },
          };

          const attestCase = await this.attestationCaseModel.findOneAndUpdate(
            { electionId: election._id, tableCode: ballot.tableCode },
            { $set: caseData },
            { upsert: true, new: true },
          );
          cases.push(attestCase);
        } catch (err) {
          this.logger.warn(`AttestationCase para ${ballot.tableCode} ya existe`);
        }
      }
    }

    this.logger.log(`✅ ${cases.length} attestation cases creados/actualizados`);
    return cases;
  }

  /**
   * Crea usuarios de prueba (GOVERNOR y MAYOR)
   */
  private async seedUsers(): Promise<RoledUserDocument[]> {
    const users: RoledUserDocument[] = [];
    const hashedPassword = bcrypt.hashSync(TEST_PASSWORD, 10);

    for (const userData of MOCK_USERS) {
      const departmentId = userData.department
        ? await this.findDepartmentIdByName(userData.department)
        : null;
      const municipalityId = userData.municipality
        ? await this.findMunicipalityIdByName(
            userData.municipality,
            departmentId,
          )
        : null;

      if (userData.role === 'GOVERNOR' && !departmentId) {
        throw new Error(
          `Departamento no encontrado para gobernador ${userData.email}: ${userData.department}`,
        );
      }

      if (userData.role === 'MAYOR' && !municipalityId) {
        throw new Error(
          `Municipio no encontrado para alcalde ${userData.email}: ${userData.municipality}`,
        );
      }

      const doc = await this.roledUserModel.findOneAndUpdate(
        { dni: userData.dni },
        {
          $set: {
            dni: userData.dni,
            email: userData.email,
            name: userData.name,
            password: hashedPassword,
            role: userData.role,
            votingDepartmentId: departmentId,
            votingMunicipalityId: municipalityId,
            active: true,
          },
        },
        { upsert: true, new: true },
      );
      if (doc) {
        users.push(doc);
      }
    }

    this.logger.log(`✅ ${users.length} usuarios creados/actualizados`);
    return users;
  }

  private async seedGeography(): Promise<SeededGeography[]> {
    const seeded: SeededGeography[] = [];
    let resolvedLocations = 0;
    let resolvedTables = 0;

    for (let locIdx = 0; locIdx < MOCK_LOCATIONS.length; locIdx++) {
      const location = MOCK_LOCATIONS[locIdx];
      const departmentName = location.department.trim();
      const provinceName = location.province.trim();
      const municipalityName = location.municipality.trim();

      const department = await this.departmentModel.findOne({
        name: {
          $regex: new RegExp(`^${this.escapeRegex(departmentName)}$`, 'i'),
        },
      });
      if (!department) {
        throw new Error(`Departamento no encontrado: ${departmentName}`);
      }

      const province = await this.provinceModel.findOne({
        name: { $regex: new RegExp(`^${this.escapeRegex(provinceName)}$`, 'i') },
        departmentId: department._id,
      });
      if (!province) {
        throw new Error(`Provincia no encontrada: ${provinceName} (${departmentName})`);
      }

      const municipality = await this.municipalityModel.findOne({
        name: {
          $regex: new RegExp(`^${this.escapeRegex(municipalityName)}$`, 'i'),
        },
        provinceId: province._id,
      });
      if (!municipality) {
        throw new Error(
          `Municipio no encontrado: ${municipalityName} (${provinceName})`,
        );
      }

      const seat = await this.electoralSeatModel.findOne({
        name: {
          $regex: new RegExp(
            `^${this.escapeRegex(location.electoralSeat)}$`,
            'i',
          ),
        },
        municipalityId: municipality._id,
      });
      if (!seat) {
        throw new Error(
          `Asiento electoral no encontrado: ${location.electoralSeat} (${municipalityName})`,
        );
      }

      const electoralLocation = await this.electoralLocationModel.findOne({
        name: {
          $regex: new RegExp(
            `^${this.escapeRegex(location.electoralLocationName)}$`,
            'i',
          ),
        },
        electoralSeatId: seat._id,
      });
      if (!electoralLocation) {
        throw new Error(
          `Recinto no encontrado: ${location.electoralLocationName} (${location.electoralSeat})`,
        );
      }

      const tables = await this.electoralTableModel
        .find({ electoralLocationId: electoralLocation._id, active: true })
        .sort({ tableNumber: 1 })
        .limit(3)
        .lean();

      if (!tables.length) {
        throw new Error(
          `No hay mesas activas para el recinto ${location.electoralLocationName}`,
        );
      }

      resolvedLocations += 1;
      resolvedTables += tables.length;

      seeded[locIdx] = {
        departmentId: department._id as Types.ObjectId,
        provinceId: province._id as Types.ObjectId,
        municipalityId: municipality._id as Types.ObjectId,
        electoralSeatId: seat._id as Types.ObjectId,
        electoralLocationId: electoralLocation._id as Types.ObjectId,
        tables: tables.map((t: any) => ({
          tableId: t._id as Types.ObjectId,
          tableCode: t.tableCode,
          tableNumber: t.tableNumber,
        })),
      };
    }

    this.logger.log(
      `Geografia validada (recintos: ${resolvedLocations}, mesas: ${resolvedTables})`,
    );
    return seeded;
  }

  /**
   * Crea contratos para los usuarios de prueba
   */
  private async seedContracts(
    elections: Array<ElectionConfigDocument & { _id: Types.ObjectId }>,
    users: RoledUserDocument[],
  ): Promise<ContractDocument[]> {
    const contracts: ContractDocument[] = [];
    const now = new Date();

    for (const user of users) {
      // Obtener datos del usuario mock correspondiente
      const mockUser = MOCK_USERS.find((m) => m.dni === user.dni);
      if (!mockUser) continue;

      // Determinar qué elección corresponde
      const electionType = mockUser.role === 'GOVERNOR' ? 'departamental' : 'municipal';
      const election = elections.find((e) => e.type === electionType);
      if (!election) continue;

      const contractData: any = {
        active: true,
        clientId: user._id,
        clientRole: mockUser.role,
        electionId: election._id,
        startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // Hace 30 días
        endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // En 30 días
        departmentName: mockUser.department,
      };

      // Si es MAYOR, agregar municipio
      if (mockUser.role === 'MAYOR' && mockUser.municipality) {
        contractData.municipalityName = mockUser.municipality;
      }

      try {
        const doc = await this.contractModel.findOneAndUpdate(
          { clientId: user._id, electionId: election._id },
          { $set: contractData },
          { upsert: true, new: true },
        );
        if (doc) {
          contracts.push(doc);
        }
      } catch (err) {
        this.logger.warn(`Contrato para ${user.email} ya existe`);
      }
    }

    this.logger.log(`✅ ${contracts.length} contratos creados/actualizados`);
    return contracts;
  }

  /**
   * Crea usuarios delegados en la colección User
   */
  private async seedDelegateUsers(): Promise<UserDocument[]> {
    const users: UserDocument[] = [];

    for (const delegateData of MOCK_DELEGATES) {
      const doc = await this.userModel.findOneAndUpdate(
        { dni: delegateData.dni },
        {
          $set: {
            dni: delegateData.dni,
            active: true,
          },
        },
        { upsert: true, new: true },
      );
      if (doc) {
        users.push(doc);
      }
    }

    this.logger.log(`✅ ${users.length} usuarios delegados creados/actualizados`);
    return users;
  }

  /**
   * Crea delegados asociados a contratos
   */
  private async seedDelegates(
    delegateUsers: UserDocument[],
    contracts: ContractDocument[],
    roledUsers: RoledUserDocument[],
  ): Promise<DelegateDocument[]> {
    const delegates: DelegateDocument[] = [];

    for (const delegateData of MOCK_DELEGATES) {
      const user = delegateUsers.find((u) => u.dni === delegateData.dni);
      if (!user) continue;

      // Determinar los clientes para este delegado
      const clientDnis = Array.isArray(delegateData.forClient)
        ? delegateData.forClient
        : [delegateData.forClient];

      const authorizedContracts: Array<{
        contractId: Types.ObjectId;
        clientId: Types.ObjectId;
        clientRole: 'MAYOR' | 'GOVERNOR';
        addedAt: Date;
      }> = [];

      for (const clientDni of clientDnis) {
        const client = roledUsers.find((u) => u.dni === clientDni);
        if (!client) continue;

        const contract = contracts.find(
          (c) => c.clientId.toString() === client._id.toString(),
        );
        if (!contract) continue;

        authorizedContracts.push({
          contractId: contract._id as Types.ObjectId,
          clientId: client._id as Types.ObjectId,
          clientRole: client.role as 'MAYOR' | 'GOVERNOR',
          addedAt: new Date(),
        });
      }

      if (authorizedContracts.length === 0) continue;

      const doc = await this.delegateModel.findOneAndUpdate(
        { dni: delegateData.dni },
        {
          $set: {
            dni: delegateData.dni,
            userId: user._id,
            name: delegateData.name,
            email: delegateData.email,
            phone: delegateData.phone,
            authorizedContracts,
            active: true,
          },
        },
        { upsert: true, new: true },
      );
      if (doc) {
        delegates.push(doc);
      }
    }

    this.logger.log(`✅ ${delegates.length} delegados creados/actualizados`);
    return delegates;
  }

  /**
   * Crea attestations (votos de delegados sobre ballots)
   */
  private async seedAttestations(
    elections: Array<ElectionConfigDocument & { _id: Types.ObjectId }>,
    ballots: BallotDocument[],
    delegateUsers: UserDocument[],
    delegates: DelegateDocument[],
    contracts: ContractDocument[],
  ): Promise<AttestationDocument[]> {
    const attestations: AttestationDocument[] = [];

    for (const election of elections) {
      const electionBallots = ballots.filter(
        (b) => b.electionId.toString() === election._id.toString(),
      );

      // Obtener contratos para esta elección
      const electionContracts = contracts.filter(
        (c) => c.electionId.toString() === election._id.toString(),
      );

      for (const ballot of electionBallots) {
        // Determinar qué delegados pueden atestiguar este ballot según la ubicación
        const ballotDepartment = ballot.location?.department;
        const ballotMunicipality = ballot.location?.municipality;

        for (const delegate of delegates) {
          const user = delegateUsers.find(
            (u) => u._id.toString() === delegate.userId.toString(),
          );
          if (!user) continue;

          // Verificar si el delegado tiene un contrato válido para esta elección
          for (const authContract of delegate.authorizedContracts) {
            const contract = electionContracts.find(
              (c) => c._id.toString() === authContract.contractId.toString(),
            );
            if (!contract) continue;

            // Verificar que el contrato corresponde a la ubicación del ballot
            const contractDept = (contract as any).departmentName;
            const contractMuni = (contract as any).municipalityName;

            // Para GOVERNOR: debe coincidir el departamento
            // Para MAYOR: debe coincidir departamento y municipio
            let canAttest = false;
            if (authContract.clientRole === 'GOVERNOR') {
              canAttest = contractDept === ballotDepartment;
            } else if (authContract.clientRole === 'MAYOR') {
              canAttest =
                contractDept === ballotDepartment &&
                contractMuni === ballotMunicipality;
            }

            if (!canAttest) continue;

            // Crear attestation con soporte aleatorio (80% de soporte)
            const support = Math.random() > 0.2;

            try {
              const attestation = await this.attestationModel.findOneAndUpdate(
                {
                  userId: user._id,
                  ballotId: ballot._id,
                },
                {
                  $set: {
                    support,
                    electionId: election._id,
                    ballotId: ballot._id,
                    isJury: false,
                    userId: user._id,
                    validForContractId: contract._id,
                    isValidForClientReport: true,
                  },
                },
                { upsert: true, new: true },
              );
              attestations.push(attestation);
            } catch (err) {
              // Ignorar duplicados
            }
          }
        }

        // Agregar algunos jurados (usuarios que no son delegados pero atestiguaron como jurados)
        // Crear 1-2 jurados por ballot
        const juryCount = Math.floor(Math.random() * 2) + 1;
        for (let j = 0; j < juryCount; j++) {
          const juryDni = `${TEST_PREFIX}JURY_${ballot.tableCode}_${j}`;

          // Crear usuario jurado
          const juryUser = await this.userModel.findOneAndUpdate(
            { dni: juryDni },
            { $set: { dni: juryDni, active: true } },
            { upsert: true, new: true },
          );

          try {
            const attestation = await this.attestationModel.findOneAndUpdate(
              {
                userId: juryUser._id,
                ballotId: ballot._id,
              },
              {
                $set: {
                  support: true, // Jurados siempre apoyan
                  electionId: election._id,
                  ballotId: ballot._id,
                  isJury: true,
                  userId: juryUser._id,
                  validForContractId: null,
                  isValidForClientReport: false,
                },
              },
              { upsert: true, new: true },
            );
            attestations.push(attestation);
          } catch (err) {
            // Ignorar duplicados
          }
        }
      }
    }

    this.logger.log(`✅ ${attestations.length} attestations creados/actualizados`);
    return attestations;
  }

  /**
   * Obtiene estadísticas de los datos de prueba existentes
   */
  async getTestDataStats(): Promise<{
    elections: number;
    ballots: number;
    attestationCases: number;
    attestations: number;
    parties: number;
    users: number;
    contracts: number;
    delegateUsers: number;
    delegates: number;
  }> {
    const testNameRegex = new RegExp(`^(${TEST_PREFIX}|${AUDIT_PREFIX})`);
    const testPartyRegex = new RegExp(
      `^(${TEST_PREFIX.toLowerCase()}|${AUDIT_PREFIX.toLowerCase()})`,
    );
    const auditElectionNames = ['Elección Gobernadores 2026'];
    const auditRoledUserEmails = [
      'audit.admin@test.local',
      'audit.governor@test.local',
    ];
    const auditDelegateDnis = ['8045123'];
    const testElections = await this.electionConfigModel.countDocuments({
      $or: [
        { name: { $regex: testNameRegex } },
        { name: { $in: auditElectionNames } },
      ],
    });

    const electionDocs = await this.electionConfigModel.find({
      $or: [
        { name: { $regex: testNameRegex } },
        { name: { $in: auditElectionNames } },
      ],
    });
    const electionIds = electionDocs.map((e) => e._id);

    const ballots = await this.ballotModel.countDocuments({
      electionId: { $in: electionIds },
    });

    const attestationCases = await this.attestationCaseModel.countDocuments({
      electionId: { $in: electionIds },
    });

    const attestations = await this.attestationModel.countDocuments({
      electionId: { $in: electionIds },
    });

    const parties = await this.politicalPartyModel.countDocuments({
      partyId: { $regex: testPartyRegex },
    });

    const users = await this.roledUserModel.countDocuments({
      $or: [
        { dni: { $regex: testNameRegex } },
        { email: { $in: auditRoledUserEmails } },
      ],
    });

    const contracts = await this.contractModel.countDocuments({
      electionId: { $in: electionIds },
    });

    const delegateUsers = await this.userModel.countDocuments({
      $or: [
        { dni: { $regex: testNameRegex } },
        { dni: { $in: auditDelegateDnis } },
      ],
    });

    const delegates = await this.delegateModel.countDocuments({
      $or: [
        { dni: { $regex: testNameRegex } },
        { dni: { $in: auditDelegateDnis } },
      ],
    });

    return {
      elections: testElections,
      ballots,
      attestationCases,
      attestations,
      parties,
      users,
      contracts,
      delegateUsers,
      delegates,
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async findDepartmentIdByName(
    departmentName: string,
  ): Promise<Types.ObjectId | null> {
    const department = await this.departmentModel.findOne({
      name: { $regex: new RegExp(`^${this.escapeRegex(departmentName)}$`, 'i') },
    });
    return department ? (department._id as Types.ObjectId) : null;
  }

  private async findMunicipalityIdByName(
    municipalityName: string,
    departmentId: Types.ObjectId | null,
  ): Promise<Types.ObjectId | null> {
    if (departmentId) {
      const provinces = await this.provinceModel
        .find({ departmentId }, { _id: 1 })
        .lean();
      const provinceIds = provinces.map((p) => p._id);
      if (provinceIds.length > 0) {
        const municipality = await this.municipalityModel.findOne({
          provinceId: { $in: provinceIds },
          name: {
            $regex: new RegExp(
              `^${this.escapeRegex(municipalityName)}$`,
              'i',
            ),
          },
        });
        if (municipality) {
          return municipality._id as Types.ObjectId;
        }
      }
    }

    const municipality = await this.municipalityModel.findOne({
      name: { $regex: new RegExp(`^${this.escapeRegex(municipalityName)}$`, 'i') },
    });
    return municipality ? (municipality._id as Types.ObjectId) : null;
  }
}
