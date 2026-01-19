import { INestApplication } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ResultsController } from '../../src/modules/results/controllers/results.controller';
import { ResultsService } from '../../src/modules/results/services/results.service';

import { Ballot, BallotSchema } from '../../src/modules/ballot/schemas/ballot.schema';
import { ElectoralTable, ElectoralTableSchema } from '../../src/modules/geographic/schemas/electoral-table.schema';
import { ElectionConfig, ElectionConfigSchema } from '../../src/modules/elections/schemas/election-config.schema';
import { ElectionConfigService } from '../../src/modules/elections/services/election-config.service';
import { ResultsPeriodGuard } from '../../src/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '../../src/modules/elections/guards/preliminary-results.guard';
import { seedContracts, seedUsers } from '../utils/seeds/usersSeed';
import { seedLocations } from '../utils/seeds/locationsSeed';
import { seedElectionConfigWith } from '../utils/seeds/electionsSeed';
import { seedAttestation } from '../utils/seeds/attestationsSeed';
import { AuthController } from '@/modules/auth/controllers/auth.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RoledUser, RoledUserSchema } from '@/modules/auth/schemas/roledUser.schema';
import { Department, DepartmentSchema } from '@/modules/geographic/schemas/department.schema';
import { Municipality, MunicipalitySchema } from '@/modules/geographic/schemas/municipality.schema';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from '@/modules/auth/services/auth.service';
import { MailService } from '@/modules/mail/mail.service';
import appConfig from '@/config/app.config';
import { AttestationController } from '@/modules/attestation/controllers/attestation.controller';
import { AttestationModule } from '@/modules/attestation/attestation.module';
import { BallotModule } from '@/modules/ballot/ballot.module';
import { LoggerService } from '@/core/services/logger.service';
import { ContractsModule } from '@/modules/contracts/contracts.module';

jest.setTimeout(60_000);

describe('Results E2E (role filtering)', () => {
	const resultsByLocationUrl = '/api/v1/client-results/by-location';
	const resultsLive = '/api/v1/client-results/live/by-location';
	const searchByTableUrl = '/api/v1/attestations/cases/';
	const searchByImageUrl = '/api/v1/ballots/';

	let app: INestApplication;
	let moduleRef: TestingModule;
	let mongod: MongoMemoryServer;
	let mongoUri: string;
	let conn: Connection;

	let users: Map<string, any>;
	let laPazToken: string;
	let cbbaMayorToken: string;

	beforeAll(async () => {
		mongod = await MongoMemoryServer.create();
		mongoUri = mongod.getUri();

		moduleRef = await Test.createTestingModule({
			imports: [
				CacheModule.register({ isGlobal: true }),
				ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
				MongooseModule.forRoot(mongoUri),
				MongooseModule.forFeature([
					{ name: RoledUser.name, schema: RoledUserSchema },
					{ name: Department.name, schema: DepartmentSchema  },
					{ name: Municipality.name, schema: MunicipalitySchema },
					{ name: Ballot.name, schema: BallotSchema },
					{ name: ElectoralTable.name, schema: ElectoralTableSchema },
					{ name: ElectionConfig.name, schema: ElectionConfigSchema },
				]),
				JwtModule.registerAsync({
					global: true,
					useFactory: (configService: ConfigService) => ({
						secret: configService.get('app.jwt.secret'),
						signOptions: {
							expiresIn: configService.get('app.jwt.expirationTime'),
						},
					}),
					inject: [ConfigService],
				}),
				{
					global: true,
					providers: [LoggerService],
					exports: [LoggerService],
					module: class LoggerModule {},
				},
				AttestationModule,
				BallotModule,
				ContractsModule,
			],
			controllers: [
				ResultsController,
				AuthController,
				AttestationController,
			],
			providers: [
				AuthService,
				{
					provide: MailService,
					useValue: {
						sendEmail: jest.fn(),
						createEmail: jest.fn(),
						getTemplate: jest.fn(),
					},
				},
				ResultsService,
				ElectionConfigService,
				ResultsPeriodGuard,
				PreliminaryResultsGuard,
			],
		}).compile();

		app = moduleRef.createNestApplication();
		await app.init();

		conn = moduleRef.get<Connection>(getConnectionToken());

		await seedLocations(conn);
		users = await seedUsers(conn);
		const governorLaPaz = users.get('governorLaPaz');
		let res = await request(app.getHttpServer())
			.post('/api/v1/auth/login')
			.send({
				email: governorLaPaz.email,
				password: 'secret123',
			})
			.expect(200);

		laPazToken = res.body?.accessToken;
		
		const mayorCbba = users.get('mayorCbba');
		res = await request(app.getHttpServer())
			.post('/api/v1/auth/login')
			.send({
				email: mayorCbba.email,
				password: 'secret123',
			})
			.expect(200);

		cbbaMayorToken = res.body?.accessToken;
	});

	afterAll(async () => {
		await app?.close();
		await conn?.close();
		await mongod?.stop();
	});

	it('denies results when no election config', async () => {
		await conn.collection('election_configs').deleteMany({});

		const res = await request(app.getHttpServer())
			.get(resultsByLocationUrl)
			.auth(laPazToken, { type: 'bearer' })
			.expect(403);

		expect(res.body?.error).toBe('NO_ELECTION_CONFIG');
	});

	describe('Results by location', () => {
		let electionId: string;
		let laPazTableCode: string;
		let cbbaTableCode: string;
		let quillacolloTableCode: string;

		let laPazBallotId: string;
		let cbbaBallotId: string;
		let quillacolloBallotId: string;
		let cbbaBallot: any

		beforeAll(async () => {
			const election = await seedElectionConfigWith(conn, 'pastElection');
			electionId = election.insertedId.toHexString();

			await seedContracts(conn, users, 'pastElection');

			const laPazAtt = await seedAttestation(conn, electionId, 'La Paz', 'Achocalla', { 'MAS': 60, 'CC': 40 });
			laPazTableCode = laPazAtt.ballot.tableCode;
			laPazBallotId = laPazAtt.ballot._id.toString();

			const cbbaAtt = await seedAttestation(conn, electionId, 'Cochabamba', 'Cochabamba', { 'MAS': 120, 'CC': 80 });
			cbbaTableCode = cbbaAtt.ballot.tableCode;
			cbbaBallotId = cbbaAtt.ballot._id.toString();
			cbbaBallot = cbbaAtt.ballot;

			const quillacolloAtt = await seedAttestation(conn, electionId, 'Cochabamba', 'Quillacollo', { 'MAS': 10, 'CC': 10 });
			quillacolloTableCode = quillacolloAtt.ballot.tableCode;
			quillacolloBallotId = quillacolloAtt.ballot._id.toString();
		});

		afterAll(async () => {
			await conn.collection('election_configs').deleteMany({});
			await conn.collection('attestations').deleteMany({});
			await conn.collection('ballots').deleteMany({});
			await conn.collection('attestation_cases').deleteMany({});
		});

		it('with La Paz governor, returns only La Paz results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(200);
			
			expect(res.body?.summary).toBeDefined();
			expect(res.body.summary.validVotes).toEqual(100);
			expect(res.body.summary.tablesProcessed).toEqual(1);
		});

		it('with La Paz governor, returns La Paz sub-filter results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', municipality: 'Achocalla' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(200);
			
			expect(res.body?.summary).toBeDefined();
			expect(res.body.summary.validVotes).toEqual(100);
			expect(res.body.summary.tablesProcessed).toEqual(1);
		});

		it('with La Paz governor, denies access to Cochabamba results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', department: 'Cochabamba' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with La Paz governor, denies access to provinces in Cochabamba', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', province: 'Cercado' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with La Paz governor, denies access to municipalities in Cochabamba', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', municipality: 'Cochabamba' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with Cbba mayor, returns only Cochabamba municipality results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(200);
			
			expect(res.body?.summary).toBeDefined();
			expect(res.body.summary.validVotes).toEqual(200);
			expect(res.body.summary.tablesProcessed).toEqual(1);
		});

		it('with Cbba mayor, returns Cochabamba municipality sub-filter results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', electoralSeat: cbbaBallot.location.electoralSeat })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(200);
			
			expect(res.body?.summary).toBeDefined();
			expect(res.body.summary.validVotes).toEqual(200);
			expect(res.body.summary.tablesProcessed).toEqual(1);
		});

		it('with Cbba mayor, denies access to Quillacollo results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', municipality: 'Quillacollo' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with Cbba mayor, denies access to Quillacollo electoral seat results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', electoralSeat: 'Bella Vista' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with Cbba mayor, denies access to Cochabamba department results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', department: 'Cochabamba' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with Cbba mayor, denies access to Murillo-La Paz province results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsByLocationUrl)
				.query({ electionId: electionId, electionType: 'presidential', province: 'Murillo' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with La Paz governor, can search La Paz tables', async () => {
			const res = await request(app.getHttpServer())
				.get(searchByTableUrl + laPazTableCode)
				.query({ electionId: electionId })
				.auth(laPazToken, { type: 'bearer' })
				.expect(200);

			expect(res.body).toBeDefined();
			expect(res.body.tableCode).toBe(laPazTableCode);
		});

		it('with La Paz governor, cannot search Cochabamba tables', async () => {
			await request(app.getHttpServer())
				.get(searchByTableUrl + cbbaTableCode)
				.query({ electionId: electionId })
				.auth(laPazToken, { type: 'bearer' })
				.expect(404);
		});

		it('with Cbba mayor, can search Cochabamba municipality tables', async () => {
			const res = await request(app.getHttpServer())
				.get(searchByTableUrl + cbbaTableCode)
				.query({ electionId: electionId })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(200);

			expect(res.body).toBeDefined();
			expect(res.body.tableCode).toBe(cbbaTableCode);
		});

		it('with Cbba mayor, cannot search Quillacollo tables', async () => {
			await request(app.getHttpServer())
				.get(searchByTableUrl + quillacolloTableCode)
				.query({ electionId: electionId })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(404);
		});

		it('with La Paz governor, can search La Paz images', async () => {
			const res = await request(app.getHttpServer())
				.get(searchByImageUrl + laPazBallotId)
				.auth(laPazToken, { type: 'bearer' })
				.expect(200);

			expect(res.body).toBeDefined();
			expect(res.body._id).toBe(laPazBallotId);
		});

		it('with La Paz governor, cannot search Cochabamba images', async () => {
			await request(app.getHttpServer())
				.get(searchByImageUrl + cbbaBallotId)
				.auth(laPazToken, { type: 'bearer' })
				.expect(404);
		});

		it('with Cbba mayor, can search Cochabamba municipality images', async () => {
			const res = await request(app.getHttpServer())
				.get(searchByImageUrl + cbbaBallotId)
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(200);

			expect(res.body).toBeDefined();
			expect(res.body._id).toBe(cbbaBallotId);
		});

		it('with Cbba mayor, cannot search Quillacollo images', async () => {
			await request(app.getHttpServer())
				.get(searchByImageUrl + quillacolloBallotId)
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(404);
		});
	});

	describe('Live results by location', () => {
		let electionId: string;
		let cbbaBallot: any;

		beforeAll(async () => {
			const election = await seedElectionConfigWith(conn, 'activeElection');
			electionId = election.insertedId.toHexString();

			await seedContracts(conn, users, 'activeElection');
			await seedAttestation(conn, electionId, 'La Paz', 'Achocalla', { 'MAS': 60, 'CC': 40 });
			const cbbaAtt = await seedAttestation(conn, electionId, 'Cochabamba', 'Cochabamba', { 'MAS': 120, 'CC': 80 });
			cbbaBallot = cbbaAtt.ballot;

			await seedAttestation(conn, electionId, 'Cochabamba', 'Quillacollo', { 'MAS': 10, 'CC': 10 });
		});

		afterAll(async () => {
			await conn.collection('election_configs').deleteMany({});
			await conn.collection('attestations').deleteMany({});
			await conn.collection('ballots').deleteMany({});
			await conn.collection('attestation_cases').deleteMany({});
		});

		it('with La Paz governor, returns only La Paz results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(200);
			
			expect(res.body?.summary).toBeDefined();
			expect(res.body.summary.validVotes).toEqual(100);
			expect(res.body.summary.tablesProcessed).toEqual(1);
		});

		it('with La Paz governor, returns La Paz sub-filter results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', municipality: 'Achocalla' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(200);
			
			expect(res.body?.summary).toBeDefined();
			expect(res.body.summary.validVotes).toEqual(100);
			expect(res.body.summary.tablesProcessed).toEqual(1);
		});

		it('with La Paz governor, denies access to Cochabamba results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', department: 'Cochabamba' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with La Paz governor, denies access to provinces in Cochabamba', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', province: 'Cercado' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with La Paz governor, denies access to municipalities in Cochabamba', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', municipality: 'Cochabamba' })
				.auth(laPazToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with Cbba mayor, returns only Cochabamba municipality results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(200);
			
			expect(res.body?.summary).toBeDefined();
			expect(res.body.summary.validVotes).toEqual(200);
			expect(res.body.summary.tablesProcessed).toEqual(1);
		});

		it('with Cbba mayor, returns Cochabamba municipality sub-filter results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', electoralSeat: cbbaBallot.location.electoralSeat })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(200);
			
			expect(res.body?.summary).toBeDefined();
			expect(res.body.summary.validVotes).toEqual(200);
			expect(res.body.summary.tablesProcessed).toEqual(1);
		});

		it('with Cbba mayor, denies access to Quillacollo results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', municipality: 'Quillacollo' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with Cbba mayor, denies access to Quillacollo electoral seat results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', electoralSeat: 'Bella Vista' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with Cbba mayor, denies access to Cochabamba department results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', department: 'Cochabamba' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});

		it('with Cbba mayor, denies access to Murillo-La Paz province results', async () => {
			const res = await request(app.getHttpServer())
				.get(resultsLive)
				.query({ electionId: electionId, electionType: 'presidential', province: 'Murillo' })
				.auth(cbbaMayorToken, { type: 'bearer' })
				.expect(403);
			
			expect(res.body?.error).toBe('Forbidden');
		});
	});
});
