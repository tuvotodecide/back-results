import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import request from 'supertest';

import { ElectionsModule } from '../../src/modules/elections/elections.module';
import { PoliticalModule } from '../../src/modules/political/political.module';

import { InMemoryMongo } from '../utils/mongo';

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
        ElectionsModule,
        PoliticalModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await mongo.clear();
  });

  it('CRUD básico + 409 por partyId duplicado', async () => {
    // Crear
    const create = await request(app.getHttpServer())
      .post(`${baseUrl}`)
      .send({
        partyId: 'LIBRE',
        fullName: 'Alianza Libre',
        shortName: 'LIBRE',
        color: '#2196F3',
        active: true,
      });
    expect([200, 201]).toContain(create.status);
    const id = create.body._id;

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

    // Obtener por partyId
    const byPid = await request(app.getHttpServer()).get(`${baseUrl}/by-party-id/LIBRE`);
    expect(byPid.status).toBe(200);
    expect(byPid.body.shortName).toBe('LIBRE');

    // Update (cambia color y active)
    const upd = await request(app.getHttpServer())
      .patch(`${baseUrl}/${id}`)
      .send({ color: '#ff0000', active: false });
    expect(upd.status).toBe(200);
    expect(upd.body.color).toBe('#ff0000');
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
    const epId = epOne._id;

    // Patch: ballotNumber + color + desactivar
    const patch = await request(app.getHttpServer())
      .patch(`${epBase}/${epId}`)
      .send({ ballotNumber: 10, color: '#00ff00', active: false });
    expect(patch.status).toBe(200);
    expect(patch.body.ballotNumber).toBe(10);
    expect(patch.body.active).toBe(false);

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
