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
  Contract,
  ContractDocument,
} from '../../contracts/schemas/contract.schema';

// Prefijo para identificar datos de prueba
const TEST_PREFIX = 'TEST_E2E_';
const TEST_PASSWORD = 'test1234'; // Contraseña para todos los usuarios de prueba

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
    municipality: 'La Paz',
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

// Ubicaciones de prueba
const MOCK_LOCATIONS = [
  {
    department: 'La Paz',
    province: 'Murillo',
    municipality: 'La Paz',
    electoralSeat: 'Sede Central La Paz',
    electoralLocationName: 'U.E. Test La Paz 1',
    district: 'DISTRITO 1',
    zone: 'Zona Central',
    circunscripcion: { number: 1, type: 'Uninominal', name: 'Primera-La Paz' },
  },
  {
    department: 'La Paz',
    province: 'Murillo',
    municipality: 'El Alto',
    electoralSeat: 'Sede El Alto',
    electoralLocationName: 'U.E. Test El Alto 1',
    district: 'DISTRITO 2',
    zone: 'Zona Norte',
    circunscripcion: { number: 2, type: 'Uninominal', name: 'Segunda-El Alto' },
  },
  {
    department: 'Cochabamba',
    province: 'Cercado',
    municipality: 'Cochabamba',
    electoralSeat: 'Sede Cochabamba',
    electoralLocationName: 'U.E. Test Cochabamba 1',
    district: 'DISTRITO 1',
    zone: 'Zona Sur',
    circunscripcion: { number: 10, type: 'Uninominal', name: 'Decima-Cochabamba' },
  },
  {
    department: 'Santa Cruz',
    province: 'Andres Ibañez',
    municipality: 'Santa Cruz de la Sierra',
    electoralSeat: 'Sede Santa Cruz',
    electoralLocationName: 'U.E. Test Santa Cruz 1',
    district: 'DISTRITO 1',
    zone: 'Zona Este',
    circunscripcion: { number: 20, type: 'Uninominal', name: 'Vigesima-Santa Cruz' },
  },
];

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
    @InjectModel(Contract.name)
    private contractModel: Model<ContractDocument>,
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
  }> {
    this.logger.log('🌱 Iniciando seed de datos de prueba...');

    // 1. Crear partidos políticos de prueba
    const parties = await this.seedParties();

    // 2. Crear elecciones (departamental y municipal)
    const elections = await this.seedElections();

    // 3. Asociar partidos a elecciones
    await this.seedElectionParties(elections, parties);

    // 4. Crear ballots con resultados
    const ballots = await this.seedBallots(elections, parties);

    // 5. Crear attestation cases resueltos
    const attestationCases = await this.seedAttestationCases(elections, ballots);

    // 6. Crear geografÃ­a mÃ­nima para los usuarios de prueba
    await this.seedGeography();

    // 7. Crear usuarios de prueba (GOVERNOR y MAYOR)
    const users = await this.seedUsers();

    // 8. Crear contratos para los usuarios
    const contracts = await this.seedContracts(elections, users);

    this.logger.log('✅ Seed completado exitosamente');

    return {
      elections,
      parties,
      ballots,
      attestationCases,
      users,
      contracts,
    };
  }

  /**
   * Elimina todos los datos de prueba
   */
  async cleanupAll(): Promise<{
    deletedElections: number;
    deletedBallots: number;
    deletedAttestationCases: number;
    deletedParties: number;
    deletedElectionParties: number;
    deletedUsers: number;
    deletedContracts: number;
  }> {
    this.logger.log('🧹 Limpiando datos de prueba...');

    // Obtener IDs de elecciones de prueba
    const testElections = await this.electionConfigModel.find({
      name: { $regex: `^${TEST_PREFIX}` },
    });
    const electionIds = testElections.map((e) => e._id);

    // Obtener IDs de usuarios de prueba
    const testUsers = await this.roledUserModel.find({
      dni: { $regex: `^${TEST_PREFIX}` },
    });
    const userIds = testUsers.map((u) => u._id);

    // Eliminar en orden inverso a la creación
    const deletedContracts = await this.contractModel.deleteMany({
      $or: [
        { electionId: { $in: electionIds } },
        { clientId: { $in: userIds } },
      ],
    });

    const deletedUsers = await this.roledUserModel.deleteMany({
      dni: { $regex: `^${TEST_PREFIX}` },
    });

    const deletedAttestationCases = await this.attestationCaseModel.deleteMany({
      electionId: { $in: electionIds },
    });

    const deletedBallots = await this.ballotModel.deleteMany({
      electionId: { $in: electionIds },
    });

    const deletedElectionParties = await this.electionPartyModel.deleteMany({
      electionId: { $in: electionIds },
    });

    const deletedElections = await this.electionConfigModel.deleteMany({
      name: { $regex: `^${TEST_PREFIX}` },
    });

    const deletedParties = await this.politicalPartyModel.deleteMany({
      partyId: { $regex: `^${TEST_PREFIX.toLowerCase()}` },
    });

    this.logger.log('✅ Limpieza completada');

    return {
      deletedElections: deletedElections.deletedCount,
      deletedBallots: deletedBallots.deletedCount,
      deletedAttestationCases: deletedAttestationCases.deletedCount,
      deletedParties: deletedParties.deletedCount,
      deletedElectionParties: deletedElectionParties.deletedCount,
      deletedUsers: deletedUsers.deletedCount,
      deletedContracts: deletedContracts.deletedCount,
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
  ): Promise<BallotDocument[]> {
    const ballots: BallotDocument[] = [];
    const fakeLocationId = new Types.ObjectId();

    for (const election of elections) {
      // Crear múltiples ballots por ubicación
      for (let locIdx = 0; locIdx < MOCK_LOCATIONS.length; locIdx++) {
        const location = MOCK_LOCATIONS[locIdx];

        // 3 mesas por ubicación
        for (let tableNum = 1; tableNum <= 3; tableNum++) {
          const tableCode = `${TEST_PREFIX}${election.type?.toUpperCase().slice(0, 3)}_${locIdx}_${tableNum}`;

          // Generar votos aleatorios pero realistas
          const partyVotes = parties.map((party) => ({
            partyId: party.partyId,
            votes: Math.floor(Math.random() * 100) + 10,
          }));

          const validVotes = partyVotes.reduce((sum, p) => sum + p.votes, 0);
          const nullVotes = Math.floor(Math.random() * 10) + 1;
          const blankVotes = Math.floor(Math.random() * 5) + 1;

          const ballotData = {
            tableNumber: `${tableNum}`,
            tableCode,
            electionId: election._id,
            electoralLocationId: fakeLocationId,
            location,
            votes: {
              parties: {
                validVotes,
                nullVotes,
                blankVotes,
                partyVotes,
                totalVotes: validVotes + nullVotes + blankVotes,
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

  private async seedGeography(): Promise<void> {
    let createdDepartments = 0;
    let createdProvinces = 0;
    let createdMunicipalities = 0;

    const departmentIds = new Map<string, Types.ObjectId>();
    const provinceIds = new Map<string, Types.ObjectId>();

    for (const location of MOCK_LOCATIONS) {
      const departmentName = location.department.trim();
      const provinceName = location.province.trim();
      const municipalityName = location.municipality.trim();

      let departmentId = departmentIds.get(departmentName);
      if (!departmentId) {
        let department = await this.departmentModel.findOne({ name: departmentName });
        if (!department) {
          department = await this.departmentModel.create({
            name: departmentName,
            active: true,
          });
          createdDepartments += 1;
        }
        departmentId = department._id as Types.ObjectId;
        departmentIds.set(departmentName, departmentId);
      }

      const provinceKey = `${departmentId.toString()}::${provinceName}`;
      let provinceId = provinceIds.get(provinceKey);
      if (!provinceId) {
        let province = await this.provinceModel.findOne({
          name: provinceName,
          departmentId,
        });
        if (!province) {
          province = await this.provinceModel.create({
            name: provinceName,
            departmentId,
            active: true,
          });
          createdProvinces += 1;
        }
        provinceId = province._id as Types.ObjectId;
        provinceIds.set(provinceKey, provinceId);
      }

      const municipality = await this.municipalityModel.findOne({
        name: municipalityName,
        provinceId,
      });
      if (!municipality) {
        await this.municipalityModel.create({
          name: municipalityName,
          provinceId,
          active: true,
        });
        createdMunicipalities += 1;
      }
    }

    this.logger.log(
      `âœ… GeografÃ­a lista (departamentos: ${createdDepartments}, provincias: ${createdProvinces}, municipios: ${createdMunicipalities})`,
    );
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
   * Obtiene estadísticas de los datos de prueba existentes
   */
  async getTestDataStats(): Promise<{
    elections: number;
    ballots: number;
    attestationCases: number;
    parties: number;
    users: number;
    contracts: number;
  }> {
    const testElections = await this.electionConfigModel.countDocuments({
      name: { $regex: `^${TEST_PREFIX}` },
    });

    const electionDocs = await this.electionConfigModel.find({
      name: { $regex: `^${TEST_PREFIX}` },
    });
    const electionIds = electionDocs.map((e) => e._id);

    const ballots = await this.ballotModel.countDocuments({
      electionId: { $in: electionIds },
    });

    const attestationCases = await this.attestationCaseModel.countDocuments({
      electionId: { $in: electionIds },
    });

    const parties = await this.politicalPartyModel.countDocuments({
      partyId: { $regex: `^${TEST_PREFIX.toLowerCase()}` },
    });

    const users = await this.roledUserModel.countDocuments({
      dni: { $regex: `^${TEST_PREFIX}` },
    });

    const contracts = await this.contractModel.countDocuments({
      electionId: { $in: electionIds },
    });

    return {
      elections: testElections,
      ballots,
      attestationCases,
      parties,
      users,
      contracts,
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
