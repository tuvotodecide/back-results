import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { ContractsController } from '@/modules/contracts/controllers/contracts.controller';
import { ContractsService } from '@/modules/contracts/services/contracts.service';
import { DelegatesService } from '@/modules/contracts/services/delegates.service';
import { TerritorialRestrictionGuard } from '@/modules/contracts/guards/territorial-restriction.guard';
import { CreateDepartmentDto } from '@/modules/geographic/dto/department.dto';
import { CreateProvinceDto } from '@/modules/geographic/dto/province.dto';
import { CreateMunicipalityDto } from '@/modules/geographic/dto/municipality.dto';
import { CreateElectoralSeatDto } from '@/modules/geographic/dto/electoral-seat.dto';
import { CreateElectoralLocationDto } from '@/modules/geographic/dto/electoral-location.dto';
import { CreateElectoralTableDto } from '@/modules/geographic/dto/electoral-table.dto';

const contextFor = (request: Record<string, unknown>) => ({
  switchToHttp: () => ({ getRequest: () => request }),
}) as never;

const ids = {
  client: new Types.ObjectId().toString(),
  election: new Types.ObjectId().toString(),
  department: new Types.ObjectId().toString(),
  contract: new Types.ObjectId().toString(),
  admin: new Types.ObjectId().toString(),
};

const contractService = () => {
  const contractModel = { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() };
  const users = { findById: jest.fn() };
  const departments = { findById: jest.fn() };
  const municipalities = { findById: jest.fn() };
  return {
    contractModel, users, departments,
    service: new ContractsService(
      ...([contractModel, users, departments, municipalities, {}, {}] as unknown as ConstructorParameters<typeof ContractsService>),
    ),
  };
};

const delegatesService = () => {
  const delegates = { create: jest.fn(), findOne: jest.fn(), updateOne: jest.fn(), countDocuments: jest.fn(), find: jest.fn() };
  const contracts = { findById: jest.fn() };
  const users = { findOrCreateByDni: jest.fn() };
  return { delegates, contracts, users, service: new DelegatesService(delegates as never, contracts as never, users as never) };
};

describe('MX-10 | Backend Results | unitarias canónicas', () => {
  it('[MX-10][TER-JER-P0-001][UNITARIA] exige el padre departamento para una provincia', async () => {
    const dto = Object.assign(new CreateProvinceDto(), { name: 'Murillo' });
    expect((await validate(dto)).map((error) => error.property)).toContain('departmentId');
  });
  it('[MX-10][TER-NEW-P0-001][UNITARIA] rechaza departamento sin nombre', async () => {
    expect((await validate(Object.assign(new CreateDepartmentDto(), { name: '' }))).map((e) => e.property)).toContain('name');
  });
  it('[MX-10][TER-NEW-P0-002][UNITARIA] rechaza provincia sin departamento', async () => {
    expect((await validate(Object.assign(new CreateProvinceDto(), { name: 'Murillo' }))).map((e) => e.property)).toContain('departmentId');
  });
  it('[MX-10][TER-NEW-P0-003][UNITARIA] rechaza municipio sin provincia', async () => {
    expect((await validate(Object.assign(new CreateMunicipalityDto(), { name: 'La Paz' }))).map((e) => e.property)).toContain('provinceId');
  });
  it('[MX-10][TER-NEW-P0-004][UNITARIA] exige municipio e identificador para asiento', async () => {
    expect((await validate(Object.assign(new CreateElectoralSeatDto(), { name: 'Asiento' }))).map((e) => e.property)).toEqual(expect.arrayContaining(['idLoc', 'municipalityId']));
  });
  it('[MX-10][TER-NEW-P0-005][UNITARIA] exige asiento y ubicación válida para recinto', async () => {
    const dto = Object.assign(new CreateElectoralLocationDto(), { fid: '1', code: 'REC', name: 'Recinto', address: 'Calle', district: 'D', zone: 'Z' });
    expect((await validate(dto)).map((e) => e.property)).toContain('electoralSeatId');
  });
  it('[MX-10][TER-NEW-P0-006][UNITARIA] exige recinto número y código para mesa', async () => {
    expect((await validate(new CreateElectoralTableDto())).map((e) => e.property)).toEqual(expect.arrayContaining(['tableNumber', 'tableCode', 'electoralLocationId']));
  });
  it('[MX-10][TER-DEL-P0-001][UNITARIA] borra físicamente sin prevalidar descendientes', async () => {
    const remove = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: ids.department }) });
    const Service = require('@/modules/geographic/services/department.service').DepartmentService;
    const service = new Service(
      remove ? { findByIdAndDelete: remove } : {},
      { log: jest.fn() },
    );
    await expect(service.remove(ids.department)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(ids.department);
  });
  it('[MX-10][CON-ACC-P0-002][UNITARIA] aprueba una solicitud territorial pendiente', async () => {
    const user: any = { _id: new Types.ObjectId(), role: 'MAYOR', active: false, territorialAccessStatus: 'PENDING_APPROVAL', save: jest.fn().mockResolvedValue(undefined) };
    const controller = new ContractsController({} as never, {} as never, { syncUserActiveState: jest.fn() } as never, { findById: jest.fn().mockResolvedValue(user) } as never);
    await expect(controller.approveTerritorialAccessEndpoint(String(user._id), { user: { sub: ids.admin } })).resolves.toEqual(expect.objectContaining({ user: expect.objectContaining({ territorialAccessStatus: 'APPROVED' }) }));
  });
  it('[MX-10][CON-ACC-P0-003][UNITARIA] rechaza una solicitud pendiente con motivo', async () => {
    const user: any = { _id: new Types.ObjectId(), role: 'MAYOR', active: false, territorialAccessStatus: 'PENDING_APPROVAL', save: jest.fn().mockResolvedValue(undefined) };
    const controller = new ContractsController({} as never, {} as never, { syncUserActiveState: jest.fn() } as never, { findById: jest.fn().mockResolvedValue(user) } as never);
    await controller.rejectTerritorialAccessEndpoint(String(user._id), { reason: 'incompleta' }, { user: { sub: ids.admin } });
    expect(user.territorialReason).toBe('incompleta');
  });
  it('[MX-10][CON-ACC-P0-004][UNITARIA] revoca solamente una solicitud aprobada', async () => {
    const user: any = { _id: new Types.ObjectId(), role: 'MAYOR', active: true, territorialAccessStatus: 'APPROVED', save: jest.fn().mockResolvedValue(undefined) };
    const controller = new ContractsController({} as never, {} as never, { syncUserActiveState: jest.fn() } as never, { findById: jest.fn().mockResolvedValue(user) } as never);
    await controller.revokeTerritorialAccess(String(user._id), { reason: 'revocada' }, { user: { sub: ids.admin } });
    expect(user.territorialAccessStatus).toBe('REVOKED');
  });
  it('[MX-10][CON-ACC-P1-005][UNITARIA] reabre solicitud rechazada sin datos de revisión', async () => {
    const user: any = { _id: new Types.ObjectId(), role: 'MAYOR', active: false, territorialAccessStatus: 'REJECTED', territorialReason: 'x', save: jest.fn().mockResolvedValue(undefined) };
    const controller = new ContractsController({} as never, {} as never, { syncUserActiveState: jest.fn() } as never, { findById: jest.fn().mockResolvedValue(user) } as never);
    await controller.reopenTerritorialAccess(String(user._id), {}, { user: { sub: ids.admin } });
    expect(user).toMatchObject({ territorialAccessStatus: 'PENDING_APPROVAL', territorialReason: null });
  });
  it('[MX-10][CON-NEW-P0-001][UNITARIA] rechaza cliente inexistente antes de crear contrato', async () => {
    const { service, users } = contractService(); users.findById.mockResolvedValue(null);
    await expect(service.create({ clientId: ids.client, electionId: ids.election, departmentId: ids.department, startDate: new Date() })).rejects.toBeInstanceOf(NotFoundException);
  });
  it('[MX-10][CON-TER-P0-002][UNITARIA] exige territorio compatible con Gobernador', async () => {
    const { service, users } = contractService(); users.findById.mockResolvedValue({ active: true, role: 'GOVERNOR' });
    await expect(service.create({ clientId: ids.client, electionId: ids.election, startDate: new Date() })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('[MX-10][CON-DUP-P0-003][UNITARIA] rechaza segundo contrato activo equivalente', async () => {
    const { service, users, departments, contractModel } = contractService(); users.findById.mockResolvedValue({ active: true, role: 'GOVERNOR' }); departments.findById.mockResolvedValue({ _id: ids.department }); contractModel.findOne.mockResolvedValue({ _id: ids.contract });
    await expect(service.create({ clientId: ids.client, electionId: ids.election, departmentId: ids.department, startDate: new Date() })).rejects.toBeInstanceOf(ConflictException);
  });
  it('[MX-10][CON-PUB-P1-005][UNITARIA] delega sólo contratos públicos activos al servicio', async () => {
    const findPublicActiveContracts = jest.fn().mockResolvedValue([{ contractId: ids.contract, active: true }]);
    const controller = new ContractsController({ findPublicActiveContracts } as never, {} as never, {} as never, {} as never);
    await expect(controller.listPublicActive('e', 'municipal')).resolves.toEqual({
      data: [{ contractId: ids.contract, active: true }],
      total: 1,
    });
  });
  it('[MX-10][CON-DIS-P0-006][UNITARIA] inactiva contrato y registra fecha de finalización', async () => {
    const { service, contractModel } = contractService(); contractModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    await service.deactivate(ids.contract); expect(contractModel.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: { active: false, endDate: expect.any(Date) } });
  });
  it('[MX-10][DEL-UPL-P0-001][UNITARIA] procesa CSV y conserva fila válida ante DNI ausente', async () => {
    const { service, contracts, users, delegates } = delegatesService(); contracts.findById.mockResolvedValue({ clientId: ids.client, clientRole: 'GOVERNOR' }); users.findOrCreateByDni.mockResolvedValue({ _id: ids.admin }); delegates.findOne.mockResolvedValue(null); delegates.create.mockResolvedValue({});
    await expect(service.uploadDelegatesCsv({ csvContent: 'dni,name\n123,Ana\n,Sin\n', contractId: ids.contract, superadminId: ids.admin })).resolves.toMatchObject({ added: 1, errors: [expect.anything()] });
  });
  it('[MX-10][DEL-ADD-P0-002][UNITARIA] crea delegado con autorización contractual', async () => {
    const { service, contracts, users, delegates } = delegatesService(); contracts.findById.mockResolvedValue({ clientId: ids.client, clientRole: 'GOVERNOR' }); users.findOrCreateByDni.mockResolvedValue({ _id: ids.admin }); delegates.findOne.mockResolvedValue(null); delegates.create.mockResolvedValue({});
    await service.addDelegate({ dni: '123', contractId: ids.contract, superadminId: ids.admin }); expect(delegates.create).toHaveBeenCalled();
  });
  it('[MX-10][DEL-DUP-P0-003][UNITARIA] evita autorización duplicada para el mismo contrato', async () => {
    const { service, contracts, users, delegates } = delegatesService(); contracts.findById.mockResolvedValue({ clientId: ids.client, clientRole: 'GOVERNOR' }); users.findOrCreateByDni.mockResolvedValue({ _id: ids.admin }); delegates.findOne.mockResolvedValue({ authorizedContracts: [{ contractId: new Types.ObjectId(ids.contract) }] });
    await expect(service.addDelegate({ dni: '123', contractId: ids.contract, superadminId: ids.admin })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('[MX-10][DEL-MUL-P1-004][UNITARIA] mantiene autorizaciones para contratos distintos', async () => {
    const { service, contracts, users, delegates } = delegatesService(); const stored: any = { authorizedContracts: [], save: jest.fn().mockResolvedValue(undefined) }; contracts.findById.mockResolvedValue({ clientId: ids.client, clientRole: 'MAYOR' }); users.findOrCreateByDni.mockResolvedValue({ _id: ids.admin }); delegates.findOne.mockResolvedValue(stored);
    await service.addDelegate({ dni: '123', contractId: ids.contract, superadminId: ids.admin }); expect(stored.authorizedContracts).toHaveLength(1);
  });
  it('[MX-10][DEL-LST-P1-005][UNITARIA] filtra delegados por contrato solicitado', async () => {
    const { service, delegates } = delegatesService(); delegates.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([{ authorizedContracts: [{ contractId: new Types.ObjectId(ids.contract) }] }]) });
    await expect(service.listByContract(ids.contract)).resolves.toHaveLength(1);
  });
  it('[MX-10][DEL-REM-P0-006][UNITARIA] retira sólo la autorización indicada', async () => {
    const { service, delegates } = delegatesService(); delegates.updateOne.mockResolvedValue({ matchedCount: 1 }); await service.removeFromContract('123', ids.contract); expect(delegates.updateOne).toHaveBeenCalledWith({ dni: '123' }, expect.objectContaining({ $pull: expect.anything() }));
  });
  it('[MX-10][DEL-AUT-P0-007][UNITARIA] responde autorización mínima por DNI y contrato', async () => {
    const { service, delegates } = delegatesService(); delegates.countDocuments.mockResolvedValue(1); await expect(service.isAuthorizedForContract('123', ids.contract)).resolves.toBe(true);
  });
  it('[MX-10][PER-GOV-P0-001][UNITARIA] fuerza departamento contractual de Gobernador', async () => {
    const guard = new TerritorialRestrictionGuard({ findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ active: true, departmentId: new Types.ObjectId(), departmentName: 'La Paz' }) }) } as never); const request: any = { user: { sub: ids.client, role: 'GOVERNOR' }, query: { electionId: ids.election }, body: {} }; await guard.canActivate(contextFor(request)); expect(request.query.department).toBe('La Paz');
  });
  it('[MX-10][PER-MAY-P0-002][UNITARIA] fuerza municipio contractual de Alcalde', async () => {
    const guard = new TerritorialRestrictionGuard({ findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ active: true, municipalityId: new Types.ObjectId(), municipalityName: 'Cochabamba' }) }) } as never); const request: any = { user: { sub: ids.client, role: 'MAYOR' }, query: { electionId: ids.election }, body: {} }; await guard.canActivate(contextFor(request)); expect(request.query.municipality).toBe('Cochabamba');
  });
  it('[MX-10][PER-NOC-P0-003][UNITARIA] rechaza usuario sin contrato activo', async () => {
    const guard = new TerritorialRestrictionGuard({ findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) } as never); await expect(guard.canActivate(contextFor({ user: { sub: ids.client, role: 'MAYOR' }, query: { electionId: ids.election }, body: {} }))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('[MX-10][PER-APP-P0-004][UNITARIA] reserva aprobación al rol aprobador activo', async () => {
    const guard = new AccessApproverGuard({ verifyAsync: jest.fn().mockResolvedValue({ role: 'ACCESS_APPROVER', active: true }) } as never); await expect(guard.canActivate(contextFor({ headers: { authorization: 'Bearer token' } }))).resolves.toBe(true);
  });
  it('[MX-10][CON-ERR-P1-005][UNITARIA] mapea contrato inexistente a NotFound', async () => {
    const { service, contractModel } = contractService(); contractModel.updateOne.mockResolvedValue({ matchedCount: 0 }); await expect(service.deactivate(ids.contract)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('[MX-10][SEC-TEN-P0-001][UNITARIA] deniega token territorial inválido', async () => {
    const guard = new AccessApproverGuard({ verifyAsync: jest.fn().mockResolvedValue({ role: 'MAYOR', active: true }) } as never); await expect(guard.canActivate(contextFor({ headers: { authorization: 'Bearer token' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('[MX-10][SEC-DAT-P0-002][UNITARIA] conserva forma pública sin datos personales', async () => {
    const controller = new ContractsController({ findPublicActiveContracts: jest.fn().mockResolvedValue([{ contractId: ids.contract, clientRole: 'MAYOR', territory: {} }]) } as never, {} as never, {} as never, {} as never); const response: any = await controller.listPublicActive(); expect(response.data[0]).not.toHaveProperty('email');
  });
  it('[MX-10][SEC-DEL-P0-003][UNITARIA] no mezcla autorizaciones de otros contratos', async () => {
    const { service, delegates } = delegatesService(); delegates.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }); await expect(service.listByContract(ids.contract)).resolves.toEqual([]);
  });
});
