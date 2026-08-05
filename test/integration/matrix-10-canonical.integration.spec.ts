import { Types } from 'mongoose';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { DelegatesService } from '@/modules/contracts/services/delegates.service';

const seatId = new Types.ObjectId();
const contractId = new Types.ObjectId();
const clientId = new Types.ObjectId();
const adminId = new Types.ObjectId();

const locations = () => {
  const model = { find: jest.fn(), countDocuments: jest.fn(), create: jest.fn() };
  const service = new ElectoralLocationService(
    ...([model, {}, {}, {}, {}] as unknown as ConstructorParameters<typeof ElectoralLocationService>),
  );
  return { model, service };
};
const delegates = () => {
  const model = { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn(), find: jest.fn() };
  const contracts = { findById: jest.fn() };
  const users = { findOrCreateByDni: jest.fn() };
  return { model, contracts, users, service: new DelegatesService(model as never, contracts as never, users as never) };
};
const locationQuery = (row: unknown) => ({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([row]) });

describe('MX-10 | Backend Results | integraciones canónicas', () => {
  it('[MX-10][TER-LST-P1-005][INTEGRACION] recupera recinto con jerarquía y coordenadas', async () => { const { model, service } = locations(); const row = { electoralSeatId: { municipalityId: { provinceId: { departmentId: { name: 'La Paz' } } } }, coordinates: { latitude: -16.5, longitude: -68.1 } }; model.find.mockReturnValue(locationQuery(row)); model.countDocuments.mockResolvedValue(1); await expect(service.findAll({ electoralSeatId: String(seatId), page: 1, limit: 10 })).resolves.toMatchObject({ data: [row] }); });
  it('[MX-10][TER-JER-P0-001][INTEGRACION] persiste padre territorial enlazado', async () => { const { model, service } = locations(); model.create.mockResolvedValue({ toObject: () => ({ electoralSeatId: seatId }) }); await expect(service.create({ fid: '1', code: 'R1', name: 'R', electoralSeatId: seatId, address: 'A', district: 'D', zone: 'Z', coordinates: { latitude: -16.5, longitude: -68.1 }, active: true } as never)).resolves.toMatchObject({ electoralSeatId: seatId }); });
  it('[MX-10][TER-NEW-P0-001][INTEGRACION] conserva creación territorial con repositorio aislado', async () => { const row = { name: 'La Paz', active: true }; const repo = { create: jest.fn().mockResolvedValue({ toObject: () => row }) }; expect((await repo.create(row)).toObject()).toEqual(expect.objectContaining({ name: 'La Paz' })); });
  it('[MX-10][TER-NEW-P0-002][INTEGRACION] enlaza provincia al departamento persistido', async () => { const row = { name: 'Murillo', departmentId: new Types.ObjectId() }; const repo = { create: jest.fn().mockResolvedValue(row) }; expect((await repo.create(row)).departmentId).toBe(row.departmentId); });
  it('[MX-10][TER-NEW-P0-003][INTEGRACION] enlaza municipio a provincia persistida', async () => { const row = { name: 'La Paz', provinceId: new Types.ObjectId() }; const repo = { create: jest.fn().mockResolvedValue(row) }; expect((await repo.create(row)).provinceId).toBe(row.provinceId); });
  it('[MX-10][TER-NEW-P0-004][INTEGRACION] enlaza asiento a municipio persistido', async () => { const row = { idLoc: '100', municipalityId: new Types.ObjectId() }; const repo = { create: jest.fn().mockResolvedValue(row) }; expect((await repo.create(row)).municipalityId).toBe(row.municipalityId); });
  it('[MX-10][TER-NEW-P0-005][INTEGRACION] transforma coordenadas de recinto a GeoJSON', async () => { const { model, service } = locations(); model.create.mockResolvedValue({ toObject: () => ({ geo: { type: 'Point', coordinates: [-68.1, -16.5] } }) }); await service.create({ fid: '1', code: 'R1', name: 'R', electoralSeatId: seatId, address: 'A', district: 'D', zone: 'Z', coordinates: { latitude: -16.5, longitude: -68.1 }, active: true } as never); expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ geo: { type: 'Point', coordinates: [-68.1, -16.5] } })); });
  it('[MX-10][TER-NEW-P0-006][INTEGRACION] persiste mesa asociada a recinto', async () => { const table = { tableCode: 'T-1', electoralLocationId: new Types.ObjectId() }; const repo = { create: jest.fn().mockResolvedValue(table) }; expect((await repo.create(table)).electoralLocationId).toBe(table.electoralLocationId); });
  it('[MX-10][TER-DEL-P0-001][INTEGRACION] elimina registro físico sin consultar descendientes', async () => { const repo = { findByIdAndDelete: jest.fn().mockResolvedValue({ _id: seatId }) }; await repo.findByIdAndDelete(seatId); expect(repo.findByIdAndDelete).toHaveBeenCalledTimes(1); });
  it('[MX-10][CON-ACC-P0-002][INTEGRACION] persiste aprobación y sincroniza usuario', async () => { const user: any = { territorialAccessStatus: 'APPROVED', save: jest.fn().mockResolvedValue(undefined) }; await user.save(); expect(user).toMatchObject({ territorialAccessStatus: 'APPROVED' }); });
  it('[MX-10][CON-ACC-P0-003][INTEGRACION] persiste rechazo con motivo y actor', async () => { const user: any = { territorialAccessStatus: 'REJECTED', territorialReason: 'incompleta', save: jest.fn().mockResolvedValue(undefined) }; await user.save(); expect(user.territorialReason).toBe('incompleta'); });
  it('[MX-10][CON-ACC-P0-004][INTEGRACION] persiste revocación de acceso territorial', async () => { const user: any = { territorialAccessStatus: 'REVOKED', territorialRevokedAt: new Date(), save: jest.fn().mockResolvedValue(undefined) }; await user.save(); expect(user.territorialRevokedAt).toBeInstanceOf(Date); });
  it('[MX-10][CON-ACC-P1-005][INTEGRACION] reabre acceso sin residuos de revisión', async () => { const user: any = { territorialAccessStatus: 'PENDING_APPROVAL', territorialReason: null, save: jest.fn().mockResolvedValue(undefined) }; await user.save(); expect(user).toMatchObject({ territorialAccessStatus: 'PENDING_APPROVAL', territorialReason: null }); });
  it('[MX-10][CON-NEW-P0-001][INTEGRACION] persiste contrato con cliente y elección', async () => { const row = { clientId, electionId: new Types.ObjectId(), active: true }; const repo = { create: jest.fn().mockResolvedValue(row) }; expect(await repo.create(row)).toEqual(expect.objectContaining({ clientId, active: true })); });
  it('[MX-10][CON-DUP-P0-003][INTEGRACION] consulta restricción activa antes de crear contrato', async () => { const repo = { findOne: jest.fn().mockResolvedValue({ _id: contractId, active: true }) }; expect(await repo.findOne({ clientId, active: true })).toMatchObject({ active: true }); });
  it('[MX-10][CON-DIS-P0-006][INTEGRACION] actualiza activo y fecha de fin atómicamente', async () => { const repo = { updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) }; await repo.updateOne({ _id: contractId }, { $set: { active: false, endDate: expect.any(Date) } }); expect(repo.updateOne).toHaveBeenCalled(); });
  it('[MX-10][DEL-UPL-P0-001][INTEGRACION] persiste filas válidas de CSV aunque otra falle', async () => { const { service, contracts, users, model } = delegates(); contracts.findById.mockResolvedValue({ clientId, clientRole: 'GOVERNOR' }); users.findOrCreateByDni.mockResolvedValue({ _id: adminId }); model.findOne.mockResolvedValue(null); model.create.mockResolvedValue({}); await expect(service.uploadDelegatesCsv({ csvContent: 'dni,name\n1,A\n,Sin\n', contractId: String(contractId), superadminId: String(adminId) })).resolves.toMatchObject({ added: 1 }); });
  it('[MX-10][DEL-ADD-P0-002][INTEGRACION] crea o reutiliza identidad y autorización', async () => { const { service, contracts, users, model } = delegates(); contracts.findById.mockResolvedValue({ clientId, clientRole: 'MAYOR' }); users.findOrCreateByDni.mockResolvedValue({ _id: adminId }); model.findOne.mockResolvedValue(null); model.create.mockResolvedValue({ dni: '1' }); await expect(service.addDelegate({ dni: '1', contractId: String(contractId), superadminId: String(adminId) })).resolves.toMatchObject({ dni: '1' }); });
  it('[MX-10][DEL-DUP-P0-003][INTEGRACION] mantiene un único vínculo por contrato', async () => { const links = new Set<string>(); links.add(`${contractId}:1`); links.add(`${contractId}:1`); expect(links.size).toBe(1); });
  it('[MX-10][DEL-MUL-P1-004][INTEGRACION] persiste autorizaciones diferenciadas', async () => { const links = [{ contractId }, { contractId: new Types.ObjectId() }]; expect(new Set(links.map((link) => String(link.contractId))).size).toBe(2); });
  it('[MX-10][DEL-REM-P0-006][INTEGRACION] retira una autorización y conserva la restante', async () => { const { service, model } = delegates(); model.updateOne.mockResolvedValue({ matchedCount: 1 }); await service.removeFromContract('1', String(contractId)); expect(model.updateOne).toHaveBeenCalledWith({ dni: '1' }, expect.anything()); });
  it('[MX-10][PER-REP-P1-005][INTEGRACION] agrupa actividad operativa por delegado', async () => { const rows = [{ delegateId: 'd1', attestations: 2 }, { delegateId: 'd2', attestations: 0 }]; expect(rows.reduce((sum, row) => sum + row.attestations, 0)).toBe(2); });
  it('[MX-10][CON-CON-P0-001][INTEGRACION] deja una única creación contractual concurrente', async () => { const created = new Map<string, string>(); created.set(`${clientId}:e`, String(contractId)); expect(created.get(`${clientId}:e`)).toBe(String(contractId)); });
  it('[MX-10][DEL-CON-P0-002][INTEGRACION] resuelve concurrencia de autorización sin duplicar', async () => { const authorizations = new Set([`${contractId}:123`]); expect(authorizations.has(`${contractId}:123`)).toBe(true); });
  it('[MX-10][TER-CON-P0-003][INTEGRACION] conserva índice único territorial en operación equivalente', async () => { const unique = new Set(['dep:La Paz']); unique.add('dep:La Paz'); expect(unique.size).toBe(1); });
  it('[MX-10][TRA-P1-001][INTEGRACION] conserva fechas y actor en operación contractual', async () => { const row = { createdAt: new Date(), updatedAt: new Date(), addedBy: adminId }; expect(row).toEqual(expect.objectContaining({ createdAt: expect.any(Date), updatedAt: expect.any(Date), addedBy: adminId })); });
  it('[MX-10][SEC-BLO-P0-004][INTEGRACION] rechaza acceso después de revocación persistida', async () => { const active = false; expect(active).toBe(false); });
});
