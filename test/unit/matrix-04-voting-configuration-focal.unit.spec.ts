import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { VotingEventsService } from '@/modules/institutional-voting/services/events/voting-events.service';

type Models = Record<string, jest.Mock>;

function focalService() {
  const id = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const models: Models = {
    createEvent: jest.fn(), createRole: jest.fn(), findRole: jest.fn(), findRoles: jest.fn(), deleteRole: jest.fn(),
    createOption: jest.fn(), findOption: jest.fn(), replaceCandidates: jest.fn(), updateMany: jest.fn(),
    deleteOption: jest.fn(), exists: jest.fn(), save: jest.fn(),
    eventRoleFind: jest.fn(), votingOptionFind: jest.fn(), padronVersionFindOne: jest.fn(), padronImportJobFindOne: jest.fn(),
    presentialSessionUpdateMany: jest.fn().mockResolvedValue({ acknowledged: true, matchedCount: 0, modifiedCount: 0 }),
    deleteEvent: jest.fn(), deleteRoles: jest.fn(), deleteOptions: jest.fn(), deletePadron: jest.fn(), deletePadronEntries: jest.fn(),
    deleteImportJobs: jest.fn(), deleteStaging: jest.fn(), deleteComparisonReports: jest.fn(), deleteParticipation: jest.fn(), deleteSessions: jest.fn(), deleteResults: jest.fn(),
  };
  const roleLean = jest.fn().mockResolvedValue([]);
  const optionLean = jest.fn().mockResolvedValue([]);
  const currentPadronLean = jest.fn().mockResolvedValue(null);
  const activeDraftLean = jest.fn().mockResolvedValue(null);
  models.eventRoleFind.mockReturnValue({ lean: roleLean });
  models.votingOptionFind.mockReturnValue({ lean: optionLean });
  models.padronVersionFindOne.mockReturnValue({ lean: currentPadronLean });
  models.padronImportJobFindOne.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: activeDraftLean }) });
  const event = { _id: id, tenantId, name: 'Elección inicial', objective: 'Objetivo inicial suficiente', state: 'DRAFT', isReferendum: false, votingStart: new Date('2030-07-10T08:00:00Z'), votingEnd: new Date('2030-07-10T10:00:00Z'), resultsPublishAt: new Date('2030-07-10T11:00:00Z'), publishDeadline: new Date('2030-07-10T08:00:00Z'), save: models.save };
  const access = {
    getTenantOrThrow: jest.fn().mockResolvedValue({ _id: tenantId }), getEventOrThrow: jest.fn().mockResolvedValue(event),
    assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined), parseAndValidateDates: jest.fn().mockReturnValue({ votingStart: new Date('2030-07-10T08:00:00Z'), votingEnd: new Date('2030-07-10T10:00:00Z'), resultsPublishAt: new Date('2030-07-10T11:00:00Z') }),
    getCreateLeadHours: jest.fn(() => 1), getOfficialPublicationLeadHours: jest.fn(() => 0), computePublishDeadline: jest.fn(() => new Date('2030-07-10T08:00:00Z')), normalizeName: jest.fn((value: string) => value.trim().toLowerCase()), canFullyEditEvent: jest.fn(() => true), canModifyPadronDuringVoting: jest.fn(() => false), canEnableExistingPadronEntriesPostPublication: jest.fn(() => false), hasPublicationWindowExpired: jest.fn(() => false), resolveReadableTenantIds: jest.fn().mockResolvedValue([tenantId]),
  };
  const eventModel = { create: models.createEvent, find: jest.fn(), deleteOne: models.deleteEvent };
  const roleModel = { create: models.createRole, find: models.eventRoleFind, findOne: models.findRole, deleteOne: models.deleteRole, deleteMany: models.deleteRoles };
  const optionModel = { create: models.createOption, find: models.votingOptionFind, findOne: models.findOption, findOneAndUpdate: models.replaceCandidates, findOneAndDelete: models.deleteOption, exists: models.exists, updateMany: models.updateMany, deleteMany: models.deleteOptions };
  const padronVersionModel = { findOne: models.padronVersionFindOne, deleteMany: models.deletePadron };
  const padronEntryModel = { deleteMany: models.deletePadronEntries };
  const padronImportJobModel = { findOne: models.padronImportJobFindOne, deleteMany: models.deleteImportJobs };
  const padronStagingEntryModel = { deleteMany: models.deleteStaging };
  const comparisonReportModel = { exists: jest.fn(), deleteMany: models.deleteComparisonReports };
  const participationModel = { deleteMany: models.deleteParticipation };
  const presentialSessionModel = { updateMany: models.presentialSessionUpdateMany, deleteMany: models.deleteSessions };
  const resultsSnapshotModel = { deleteMany: models.deleteResults };
  const notifications = { notifyConvocationIfEligible: jest.fn(), notifyVotingCancelledToCurrentPadron: jest.fn(), notifyScheduleUpdatedToCurrentPadron: jest.fn() };
  const service = new VotingEventsService(eventModel as never, roleModel as never, optionModel as never, padronVersionModel as never, padronEntryModel as never, padronImportJobModel as never, padronStagingEntryModel as never, comparisonReportModel as never, participationModel as never, presentialSessionModel as never, resultsSnapshotModel as never, {} as never, access as never, notifications as never, {} as never, { updateVoteSchedule: jest.fn() } as never, {} as never, {} as never, { materializeActiveDraftVersion: jest.fn() } as never, {} as never, {} as never, {} as never);
  return { service, models, access, notifications, event, id, tenantId };
}

describe('MX-04 Backend Results — unitarias focales de configuración', () => {
  it('[MX-04][ELE-NEW-P0-001][UNITARIA] asocia la creación al tenant autorizado y la deja en DRAFT', async () => {
    const ctx = focalService();
    ctx.models.createEvent.mockResolvedValue({ ...ctx.event, votingStart: new Date(), votingEnd: new Date(), resultsPublishAt: new Date() });
    const result = await ctx.service.createEvent({ tenantId: String(ctx.tenantId), name: 'Elección válida', objective: 'Objetivo suficientemente descriptivo' }, { sub: 'admin-1' });
    expect(ctx.models.createEvent).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ctx.tenantId, state: 'DRAFT' }));
    expect(result).toMatchObject({ tenantId: String(ctx.tenantId), state: 'DRAFT' });
  });

  it('[MX-04][ELE-TIM-P0-001][UNITARIA] entrega al servicio solamente el cronograma previamente validado con anticipación de una hora', async () => {
    const ctx = focalService(); ctx.models.createEvent.mockResolvedValue({ ...ctx.event, votingStart: new Date(), votingEnd: new Date(), resultsPublishAt: new Date() });
    await ctx.service.createEvent({ tenantId: String(ctx.tenantId), name: 'Elección válida', objective: 'Objetivo suficientemente descriptivo', votingStart: '2030-07-10T08:00:00Z', votingEnd: '2030-07-10T10:00:00Z', resultsPublishAt: '2030-07-10T11:00:00Z' }, { sub: 'admin-1' });
    expect(ctx.access.parseAndValidateDates).toHaveBeenCalledWith('2030-07-10T08:00:00Z', '2030-07-10T10:00:00Z', '2030-07-10T11:00:00Z', 1);
  });

  it('[MX-04][ELE-TIM-P1-003][UNITARIA] recalcula deadline al actualizar el cronograma editable', async () => {
    const ctx = focalService();
    await ctx.service.updateSchedule(String(ctx.id), { votingStart: '2030-07-10T08:00:00Z', votingEnd: '2030-07-10T10:00:00Z', resultsPublishAt: '2030-07-10T11:00:00Z' }, { sub: 'admin-1' });
    expect(ctx.access.computePublishDeadline).toHaveBeenCalled(); expect(ctx.models.save).toHaveBeenCalled();
  });

  it('[MX-04][ELE-REF-P0-001][UNITARIA] conserva falso el tipo de referéndum de una votación normal', async () => { const ctx = focalService(); ctx.models.createEvent.mockResolvedValue({ ...ctx.event, votingStart: new Date(), votingEnd: new Date(), resultsPublishAt: new Date() }); const result = await ctx.service.createEvent({ tenantId: String(ctx.tenantId), name: 'Normal', objective: 'Objetivo suficientemente descriptivo', isReferendum: false }, {}); expect(result.isReferendum).toBe(false); });
  it('[MX-04][ELE-REF-P0-002][UNITARIA] crea el cargo técnico CONSULTA al persistir un referéndum', async () => { const ctx = focalService(); ctx.models.createEvent.mockResolvedValue({ ...ctx.event, isReferendum: true, votingStart: new Date(), votingEnd: new Date(), resultsPublishAt: new Date() }); await ctx.service.createEvent({ tenantId: String(ctx.tenantId), name: 'Consulta', objective: '¿Aprueba la propuesta?', isReferendum: true }, {}); expect(ctx.models.createRole).toHaveBeenCalledWith(expect.objectContaining({ name: 'CONSULTA', maxWinners: 1 })); });
  it('[MX-04][ELE-REF-P1-003][UNITARIA] conserva candidatos internos de opciones de referéndum', async () => { const ctx = focalService(); const option = { _id: new Types.ObjectId(), eventId: ctx.id, name: 'Sí', color: '#008000', colors: ['#008000'], candidates: [{ name: 'Sí', roleName: 'CONSULTA' }], active: true, toObject() { return this; } }; ctx.models.createOption.mockResolvedValue(option); const created = await ctx.service.createOption(String(ctx.id), { name: 'Sí', color: '#008000', candidates: option.candidates }, {}); expect(created.candidates).toEqual(option.candidates); });
  it('[MX-04][ELE-OPT-P1-002][UNITARIA] normaliza color principal y paleta al editar una opción', async () => { const ctx = focalService(); const option = { _id: new Types.ObjectId(), eventId: ctx.id, name: 'Lista', color: '#000000', colors: ['#000000'], active: true, save: jest.fn(), toObject() { return this; } }; ctx.models.findOption.mockResolvedValue(option); const updated = await ctx.service.updateOption(String(ctx.id), String(option._id), { colors: ['#00ff00', '#ffffff'] }, {}); expect(updated).toMatchObject({ color: '#00FF00', colors: ['#00FF00', '#FFFFFF'] }); });
  it('[MX-04][ELE-OPT-P0-003][UNITARIA] rechaza una paleta inválida antes de crear una opción', async () => { const ctx = focalService(); await expect(ctx.service.createOption(String(ctx.id), { name: 'Lista', colors: ['azul'] }, {})).rejects.toThrow(BadRequestException); expect(ctx.models.createOption).not.toHaveBeenCalled(); });
  it('[MX-04][ELE-CAN-P0-002][UNITARIA] rechaza candidatos cuyo cargo no pertenece al evento', async () => { const ctx = focalService(); ctx.models.findRoles.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ name: 'Presidencia' }]) }); await expect(ctx.service.replaceOptionCandidates(String(ctx.id), String(new Types.ObjectId()), { candidates: [{ name: 'Ana', roleName: 'Tesorería', photoUrl: 'data:image/jpeg;base64,dGVzdA==' }] }, {})).rejects.toThrow(BadRequestException); expect(ctx.models.replaceCandidates).not.toHaveBeenCalled(); });
  it('[MX-04][ELE-PRV-P1-002][UNITARIA] devuelve la paleta y candidatos internos de la opción para consumo de la papeleta', async () => { const ctx = focalService(); const option = { _id: new Types.ObjectId(), eventId: ctx.id, name: 'No', color: '#FF0000', colors: ['#FF0000'], candidates: [{ roleName: 'CONSULTA', name: 'No' }], active: true, toObject() { return this; } }; ctx.models.createOption.mockResolvedValue(option); expect(await ctx.service.createOption(String(ctx.id), { name: 'No', color: '#FF0000', candidates: option.candidates }, {})).toMatchObject({ name: 'No', candidates: option.candidates }); });
  it('[MX-04][ELE-RDY-P1-001][UNITARIA] informa pendientes cuando la estructura no está completa', async () => { const ctx = focalService(); await expect(ctx.service.markReadyForReview(String(ctx.id), {})).rejects.toThrow(BadRequestException); try { await ctx.service.markReadyForReview(String(ctx.id), {}); } catch (error) { if (!(error instanceof BadRequestException)) throw error; const response = error.getResponse(); expect(response).toEqual(expect.objectContaining({ pending: expect.any(Array) })); if (typeof response === 'object' && response !== null && 'pending' in response) expect(response.pending).not.toHaveLength(0); } expect(ctx.models.eventRoleFind).toHaveBeenCalledWith({ eventId: ctx.id }); expect(ctx.models.votingOptionFind).toHaveBeenCalledWith({ eventId: ctx.id, active: true }); expect(ctx.models.padronVersionFindOne).toHaveBeenCalledWith({ eventId: ctx.id, isCurrent: true }); expect(ctx.models.save).not.toHaveBeenCalled(); });
  it('[MX-04][ELE-RDY-P0-002][UNITARIA] mantiene el cambio a revisión sujeto a todas las precondiciones estructurales', async () => { const ctx = focalService(); const previousState = ctx.event.state; await expect(ctx.service.markReadyForReview(String(ctx.id), {})).rejects.toThrow(BadRequestException); expect(ctx.event.state).toBe(previousState); expect(ctx.models.save).not.toHaveBeenCalled(); expect(ctx.notifications.notifyConvocationIfEligible).not.toHaveBeenCalled(); });
  it('[MX-04][ELE-RDY-P0-003][UNITARIA] aplica la misma validación estructural al referéndum antes de revisión', async () => { const ctx = focalService(); ctx.event.isReferendum = true; ctx.models.eventRoleFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ name: 'CONSULTA', maxWinners: 1 }]) }); const previousState = ctx.event.state; await expect(ctx.service.markReadyForReview(String(ctx.id), {})).rejects.toThrow(BadRequestException); expect(ctx.event.state).toBe(previousState); expect(ctx.models.save).not.toHaveBeenCalled(); expect(ctx.notifications.notifyConvocationIfEligible).not.toHaveBeenCalled(); });
  it('[MX-04][ELE-EDT-P0-001][UNITARIA] guarda datos estructurales cuando el evento sigue editable', async () => { const ctx = focalService(); const result = await ctx.service.updateEvent(String(ctx.id), { name: ' Elección editada ' }, {}); expect(result.name).toBe('Elección editada'); expect(ctx.models.save).toHaveBeenCalled(); });
  it('[MX-04][ELE-EDT-P0-002][UNITARIA] no persiste cambios si la ventana estructural está cerrada', async () => { const ctx = focalService(); ctx.access.canFullyEditEvent.mockReturnValue(false); await expect(ctx.service.updateEvent(String(ctx.id), { name: 'No guardar' }, {})).rejects.toThrow(BadRequestException); expect(ctx.models.save).not.toHaveBeenCalled(); });
  it('[MX-04][ELE-CANCL-P0-001][UNITARIA] marca la cancelación sin borrar recursos', async () => { const ctx = focalService(); const result = await ctx.service.deleteEvent(String(ctx.id), { sub: 'admin-1' }); expect(result).toMatchObject({ deleted: true, state: 'CANCELLED' }); expect(ctx.event.state).toBe('CANCELLED'); expect(ctx.models.save).toHaveBeenCalled(); expect(ctx.models.presentialSessionUpdateMany).toHaveBeenCalledWith({ eventId: ctx.id, status: { $in: ['READY', 'CLAIMED'] } }, { $set: { status: 'CANCELLED', expiresAt: expect.any(Date) } }); expect(ctx.models.deleteEvent).not.toHaveBeenCalled(); expect(ctx.models.deleteRoles).not.toHaveBeenCalled(); expect(ctx.models.deleteOptions).not.toHaveBeenCalled(); expect(ctx.models.deletePadron).not.toHaveBeenCalled(); });
  it('[MX-04][ELE-HTTP-P0-002][UNITARIA] conserva configuración previa cuando un cargo usado no puede eliminarse', async () => { const ctx = focalService(); const role = { _id: new Types.ObjectId(), eventId: ctx.id, name: 'Presidencia' }; ctx.models.findRole.mockResolvedValue(role); ctx.models.exists.mockResolvedValue({ _id: new Types.ObjectId() }); await expect(ctx.service.deleteRole(String(ctx.id), String(role._id), {})).rejects.toThrow(ConflictException); expect(ctx.models.deleteRole).not.toHaveBeenCalled(); });
});
