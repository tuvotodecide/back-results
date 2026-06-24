import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TerritorialRestrictionGuard } from '@/modules/contracts/guards/territorial-restriction.guard';

const mkCtx = (request: any) =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }) as any;

const chainLean = <T>(value: T) => ({
  lean: jest.fn().mockResolvedValue(value),
});

describe('TerritorialRestrictionGuard (unit)', () => {
  let contractModel: any;
  let guard: TerritorialRestrictionGuard;

  const userId = new Types.ObjectId().toString();
  const electionId = new Types.ObjectId().toString();

  beforeEach(() => {
    contractModel = { findOne: jest.fn() };
    guard = new TerritorialRestrictionGuard(contractModel);
  });

  it('rechaza request sin user autenticado', async () => {
    await expect(guard.canActivate(mkCtx({ query: {}, body: {} }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite roles no territoriales sin buscar contrato', async () => {
    await expect(
      guard.canActivate(
        mkCtx({
          user: { sub: userId, role: 'ADMIN' },
          query: {},
          body: {},
        }),
      ),
    ).resolves.toBe(true);

    expect(contractModel.findOne).not.toHaveBeenCalled();
  });

  it('rechaza usuario territorial sin electionId o sin contrato activo', async () => {
    await expect(
      guard.canActivate(
        mkCtx({
          user: { sub: userId, role: 'GOVERNOR' },
          query: {},
          body: {},
        }),
      ),
    ).rejects.toThrow(/electionId es requerido/i);

    contractModel.findOne.mockReturnValue(chainLean(null));
    await expect(
      guard.canActivate(
        mkCtx({
          user: { sub: userId, role: 'GOVERNOR' },
          query: { electionId },
          body: {},
        }),
      ),
    ).rejects.toThrow(/No tiene un contrato activo/i);
  });

  it('fuerza departamento para gobernador y bloquea departamento ajeno', async () => {
    const contract = {
      _id: new Types.ObjectId(),
      clientId: new Types.ObjectId(userId),
      electionId: new Types.ObjectId(electionId),
      active: true,
      departmentId: new Types.ObjectId(),
      departmentName: 'La Paz',
      municipalityId: null,
      municipalityName: null,
    };
    contractModel.findOne.mockReturnValue(chainLean(contract));
    const request: any = {
      user: { sub: userId, role: 'GOVERNOR' },
      query: { electionId },
      body: {},
    };

    await expect(guard.canActivate(mkCtx(request))).resolves.toBe(true);
    expect(request.query.department).toBe('La Paz');
    expect(request.contract).toBe(contract);

    contractModel.findOne.mockReturnValue(chainLean(contract));
    await expect(
      guard.canActivate(
        mkCtx({
          user: { sub: userId, role: 'GOVERNOR' },
          query: { electionId, department: 'Santa Cruz' },
          body: {},
        }),
      ),
    ).rejects.toThrow(/fuera de su departamento/i);
  });

  it('fuerza municipio para alcalde en query y body', async () => {
    const contract = {
      _id: new Types.ObjectId(),
      clientId: new Types.ObjectId(userId),
      electionId: new Types.ObjectId(electionId),
      active: true,
      departmentId: null,
      departmentName: null,
      municipalityId: new Types.ObjectId(),
      municipalityName: 'Cochabamba',
    };
    contractModel.findOne.mockReturnValue(chainLean(contract));
    const request: any = {
      user: { sub: userId, role: 'MAYOR' },
      query: { electionId },
      body: { electionId },
    };

    await expect(guard.canActivate(mkCtx(request))).resolves.toBe(true);
    expect(request.query.municipality).toBe('Cochabamba');
    expect(request.body.municipality).toBe('Cochabamba');

    contractModel.findOne.mockReturnValue(chainLean(contract));
    await expect(
      guard.canActivate(
        mkCtx({
          user: { sub: userId, role: 'MAYOR' },
          query: { electionId, municipality: 'Quillacollo' },
          body: {},
        }),
      ),
    ).rejects.toThrow(/fuera de su municipio/i);
  });
});
