import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';

import { ElectionsModule } from '../../src/modules/elections/elections.module';
import { PoliticalModule } from '../../src/modules/political/political.module';
import appConfig from '../../src/config/app.config';

import { InMemoryMongo } from '../utils/mongo';
import { TestLoggerModule } from '../utils/module-helpers';

jest.mock('@/core/guards/admin-only.guard', () => ({
  AdminOnlyGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

describe('Aceptación: PoliticalParties', () => {
  let app: INestApplication;
  const mongo = new InMemoryMongo();
  const baseUrl = '/api/v1/political-parties';
  const epBase = '/political/election-parties';

  const createElection = async (payload: {
    name: string;
    votingStartDate: string;
    votingEndDate: string;
    resultsStartDate: string;
    allowDataModification?: boolean;
    type?: 'presidential' | 'congress';
    round?: 1 | 2;
  }) => {
    const { body, status } = await request(app.getHttpServer())
      .post(`/api/v1/elections/config`)
      .send(payload);
    expect([200, 201]).toContain(status);
    return body;
  };

  beforeAll(async () => {
    await mongo.start();

    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRootAsync({ useFactory: async () => ({ uri: mongo.uri }) }),
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        TestLoggerModule,
        ElectionsModule,
        PoliticalModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await mongo.clear();
  });

  it('CRUD básico + colors[] + 409 por partyId duplicado', async () => {
    // Crear
    const create = await request(app.getHttpServer())
      .post(`${baseUrl}`)
      .send({
        partyId: 'LIBRE',
        fullName: 'Alianza Libre',
        shortName: 'LIBRE',
        colors: ['#2196F3', '#FFFFFF'],
        active: true,
      });
    expect([200, 201]).toContain(create.status);
    const id = create.body._id;
    expect(create.body.color).toBe('#2196F3');
    expect(create.body.colors).toEqual(['#2196F3', '#FFFFFF']);

    // Duplicado partyId a 409
    const dup = await request(app.getHttpServer())
      .post(`${baseUrl}`)
      .send({
        partyId: 'LIBRE',
        fullName: 'Copia',
        shortName: 'Copia',
        color: '#000000',
        active: true,
      });
    expect(dup.status).toBe(409);

    // Listar (search)
    const list = await request(app.getHttpServer()).get(`${baseUrl}?search=lib`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((p: any) => p.partyId === 'LIBRE')).toBe(true);

    // Obtener por id
    const one = await request(app.getHttpServer()).get(`${baseUrl}/${id}`);
    expect(one.status).toBe(200);
    expect(one.body.partyId).toBe('LIBRE');
    expect(one.body.colors).toEqual(['#2196F3', '#FFFFFF']);

    // Obtener por partyId
    const byPid = await request(app.getHttpServer()).get(`${baseUrl}/by-party-id/LIBRE`);
    expect(byPid.status).toBe(200);
    expect(byPid.body.shortName).toBe('LIBRE');

    // Update (cambia paleta y active)
    const upd = await request(app.getHttpServer())
      .patch(`${baseUrl}/${id}`)
      .send({ colors: ['#ff0000', '#000000'], active: false });
    expect(upd.status).toBe(200);
    expect(upd.body.color).toBe('#FF0000');
    expect(upd.body.colors).toEqual(['#FF0000', '#000000']);
    expect(upd.body.active).toBe(false);

    // Activos
    const onlyActive = await request(app.getHttpServer()).get(`${baseUrl}/active`);
    expect(onlyActive.status).toBe(200);
    expect(onlyActive.body.every((p: any) => p.active === true)).toBe(true);

    // Remove
    const del = await request(app.getHttpServer()).delete(`${baseUrl}/${id}`);
    expect([200, 204]).toContain(del.status);

    const notFound = await request(app.getHttpServer()).get(`${baseUrl}/${id}`);
    expect(notFound.status).toBe(404);
  });

  it('mantiene compatibilidad con payload legacy de color unico', async () => {
    const create = await request(app.getHttpServer())
      .post(`${baseUrl}`)
      .send({
        partyId: 'LEGACY',
        fullName: 'Partido Legacy',
        shortName: 'LEGACY',
        color: '#123abc',
        active: true,
      });

    expect([200, 201]).toContain(create.status);
    expect(create.body.color).toBe('#123ABC');
    expect(create.body.colors).toEqual(['#123ABC']);

    const one = await request(app.getHttpServer()).get(`${baseUrl}/${create.body._id}`);
    expect(one.status).toBe(200);
    expect(one.body.color).toBe('#123ABC');
    expect(one.body.colors).toEqual(['#123ABC']);
  });

  it('rechaza colores invalidos en create/update', async () => {
    const invalidCreate = await request(app.getHttpServer())
      .post(`${baseUrl}`)
      .send({
        partyId: 'INVALID',
        fullName: 'Partido Invalido',
        shortName: 'INVALID',
        colors: ['azul'],
      });

    expect(invalidCreate.status).toBe(400);

    const create = await request(app.getHttpServer())
      .post(`${baseUrl}`)
      .send({
        partyId: 'VALID',
        fullName: 'Partido Valido',
        shortName: 'VALID',
        color: '#111111',
      });
    expect([200, 201]).toContain(create.status);

    const invalidUpdate = await request(app.getHttpServer())
      .patch(`${baseUrl}/${create.body._id}`)
      .send({ colors: [] });

    expect(invalidUpdate.status).toBe(400);
  });

  it('ElectionParties: assign-bulk / by-election / patch / remove-bulk', async () => {
    // Crear partidos base
    const mk = async (pid: string) =>
      request(app.getHttpServer())
        .post(`${baseUrl}`)
        .send({
          partyId: pid,
          fullName: `Partido ${pid}`,
          shortName: pid,
          color: '#111111',
          active: true,
        });
    await mk('A'); await mk('B'); await mk('C');

    // Crear una elección activa
    const now = new Date();
    const election = await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 1,
    });

    // Asignar A, B
    const assign = await request(app.getHttpServer())
      .post(`${epBase}/assign-bulk`)
      .send({ electionId: election.id, partyIds: ['A', 'B'] });
    expect(assign.status).toBe(201);
    expect(assign.body.assigned).toBeGreaterThanOrEqual(2);

    // Listar por elección
    const byElection = await request(app.getHttpServer())
      .get(`${epBase}/by-election/${election.id}`);
    expect(byElection.status).toBe(200);
    expect(Array.isArray(byElection.body)).toBe(true);
    const epOne = byElection.body.find((x: any) => x.partyId === 'A');
    expect(epOne).toBeTruthy();
    expect(epOne.color).toBe('#111111');
    expect(epOne.colors).toEqual(['#111111']);
    const epId = epOne._id;

    // Patch: ballotNumber + colors + desactivar
    const patch = await request(app.getHttpServer())
      .patch(`${epBase}/${epId}`)
      .send({ ballotNumber: 10, colors: ['#00ff00', '#ffffff'], active: false });
    expect(patch.status).toBe(200);
    expect(patch.body.ballotNumber).toBe(10);
    expect(patch.body.active).toBe(false);
    expect(patch.body.color).toBe('#00FF00');
    expect(patch.body.colors).toEqual(['#00FF00', '#FFFFFF']);

    const remove = await request(app.getHttpServer())
      .delete(`${epBase}/remove-bulk`)
      .send({ electionId: election.id, partyIds: ['B', 'C'] });
    expect(remove.status).toBe(200);
    expect(remove.body.removed).toBeGreaterThanOrEqual(1);

    // Confirmar estados
    const after = await request(app.getHttpServer())
      .get(`${epBase}/by-election/${election.id}`);
    expect(after.status).toBe(200);
    const map = Object.fromEntries(after.body.map((x: any) => [x.partyId, x.active]));

    expect(map['A']).toBe(false);
    expect(map['B']).toBe(false);
  });
});
