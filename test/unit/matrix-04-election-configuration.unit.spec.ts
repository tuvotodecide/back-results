import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { VotingEventsService } from '@/modules/institutional-voting/services/events/voting-events.service';

function harness() {
  const id = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const event: any = {
    _id: id, tenantId, name: 'Elección inicial', objective: 'Objetivo institucional suficiente',
    state: 'DRAFT', isReferendum: false, votingStart: new Date('2030-07-10T08:00:00Z'),
    votingEnd: new Date('2030-07-10T10:00:00Z'), resultsPublishAt: new Date('2030-07-10T11:00:00Z'),
    publishDeadline: new Date('2030-07-10T08:00:00Z'), save: jest.fn().mockResolvedValue(undefined),
  };
  const eventRoleFind = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  const optionFind = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  const draftLean = jest.fn().mockResolvedValue(null);
  const models: any = {
    createEvent: jest.fn(), createRole: jest.fn(), findRole: jest.fn(), deleteRole: jest.fn(), createOption: jest.fn(),
    findOption: jest.fn(), replaceCandidates: jest.fn(), deleteOption: jest.fn(), exists: jest.fn(), updateMany: jest.fn(),
    eventRoleFind, optionFind, padronVersionFindOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    importFindOne: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: draftLean }) }),
    sessions: jest.fn().mockResolvedValue({ modifiedCount: 0 }), comparisonExists: jest.fn().mockResolvedValue(false),
  };
  const access: any = {
    getTenantOrThrow: jest.fn().mockResolvedValue({ _id: tenantId }), getEventOrThrow: jest.fn().mockResolvedValue(event),
    assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined),
    parseAndValidateDates: jest.fn().mockReturnValue({ votingStart: event.votingStart, votingEnd: event.votingEnd, resultsPublishAt: event.resultsPublishAt }),
    getCreateLeadHours: jest.fn(() => 1), getOfficialPublicationLeadHours: jest.fn(() => 0),
    computePublishDeadline: jest.fn(() => event.publishDeadline), normalizeName: jest.fn((value: string) => value.trim().toLowerCase()),
    canFullyEditEvent: jest.fn(() => true), canModifyPadronDuringVoting: jest.fn(() => false),
    canEnableExistingPadronEntriesPostPublication: jest.fn(() => false), resolveReadableTenantIds: jest.fn().mockResolvedValue([tenantId]),
  };
  const notifications = { notifyConvocationIfEligible: jest.fn().mockResolvedValue({ sent: 1 }), notifyVotingCancelledToCurrentPadron: jest.fn(), notifyScheduleUpdatedToCurrentPadron: jest.fn() };
  const service = new VotingEventsService(
    { create: models.createEvent } as never,
    { create: models.createRole, find: eventRoleFind, findOne: models.findRole, deleteOne: models.deleteRole } as never,
    { create: models.createOption, find: optionFind, findOne: models.findOption, findOneAndUpdate: models.replaceCandidates, findOneAndDelete: models.deleteOption, exists: models.exists, updateMany: models.updateMany } as never,
    { findOne: models.padronVersionFindOne } as never, {} as never,
    { findOne: models.importFindOne } as never, {} as never, { exists: models.comparisonExists } as never, {} as never,
    { updateMany: models.sessions } as never, {} as never, {} as never, access as never, notifications as never, {} as never,
    { updateVoteSchedule: jest.fn() } as never, {} as never, { getDidsByDnis: jest.fn() } as never,
    { materializeActiveDraftVersion: jest.fn() } as never, {} as never, {} as never, {} as never,
  );
  return { service, models, access, notifications, event, id, tenantId, draftLean };
}
const validDto = (tenantId: Types.ObjectId) => ({ tenantId: String(tenantId), name: 'Elección válida', objective: 'Objetivo institucional suficiente', votingStart: '2030-07-10T08:00:00Z', votingEnd: '2030-07-10T10:00:00Z', resultsPublishAt: '2030-07-10T11:00:00Z' });

describe('MX-04 Backend Results — unitarias canónicas', () => {
  it('[MX-04][ELE-NEW-P0-001][UNITARIA] asocia creación autorizada al tenant y la deja en DRAFT', async () => {
    const h = harness(); h.models.createEvent.mockResolvedValue(h.event);
    await expect(h.service.createEvent(validDto(h.tenantId), { sub: 'admin-1' })).resolves.toMatchObject({ tenantId: String(h.tenantId), state: 'DRAFT' });
    expect(h.models.createEvent).toHaveBeenCalledWith(expect.objectContaining({ tenantId: h.tenantId, state: 'DRAFT' }));
  });
  it('[MX-04][ELE-TIM-P0-001][UNITARIA] valida fechas reales, orden y anticipación mínima de una hora', () => {
    const access = new InstitutionalVotingAccessService({} as never, {} as never, {} as never, {} as never);
    const valid = access.parseAndValidateDates('2030-07-10T08:00:00Z', '2030-07-10T10:00:00Z', '2030-07-10T11:00:00Z', 1);
    expect(valid.votingStart).toBeInstanceOf(Date);
    expect(() => access.parseAndValidateDates('2030-07-10T10:00:00Z', '2030-07-10T08:00:00Z', '2030-07-10T11:00:00Z', 1)).toThrow(BadRequestException);
    expect(() => access.parseAndValidateDates('2030-07-10T08:00:00Z', undefined, undefined, 1)).toThrow(BadRequestException);
  });
  it('[MX-04][ELE-TIM-P1-003][UNITARIA] actualiza cronograma editable y recalcula deadline', async () => {
    const h = harness(); await h.service.updateSchedule(String(h.id), { votingStart: '2030-07-10T08:00:00Z', votingEnd: '2030-07-10T10:00:00Z', resultsPublishAt: '2030-07-10T11:00:00Z' }, {});
    expect(h.access.computePublishDeadline).toHaveBeenCalled(); expect(h.event.save).toHaveBeenCalled();
  });
  it('[MX-04][ELE-REF-P0-001][UNITARIA] persiste elección normal con isReferendum falso', async () => {
    const h = harness(); h.models.createEvent.mockResolvedValue(h.event);
    await expect(h.service.createEvent({ ...validDto(h.tenantId), isReferendum: false }, {})).resolves.toMatchObject({ isReferendum: false, state: 'DRAFT' });
  });
  it('[MX-04][ELE-REF-P0-002][UNITARIA] persiste referéndum, crea CONSULTA y conserva su tipo al actualizar', async () => {
    const h = harness(); const referendum = { ...h.event, isReferendum: true }; h.models.createEvent.mockResolvedValue(referendum);
    await h.service.createEvent({ ...validDto(h.tenantId), isReferendum: true }, {});
    expect(h.models.createEvent).toHaveBeenCalledWith(expect.objectContaining({ isReferendum: true }));
    expect(h.models.createRole).toHaveBeenCalledWith(expect.objectContaining({ name: 'CONSULTA', maxWinners: 1 }));
    h.event.isReferendum = true; await expect(h.service.updateEvent(String(h.id), { isReferendum: false } as never, {})).resolves.toMatchObject({ isReferendum: true });
  });
  it('[MX-04][ELE-REF-P1-003][UNITARIA] guarda opción referéndum con paleta y candidato CONSULTA', async () => {
    const h = harness(); h.event.isReferendum = true; const row: any = { _id: new Types.ObjectId(), eventId: h.id, tenantId: h.tenantId, name: 'Sí', color: '#008000', colors: ['#008000'], candidates: [{ name: 'Sí', roleName: 'CONSULTA' }], active: true, toObject() { return this; } }; h.models.createOption.mockResolvedValue(row);
    await expect(h.service.createOption(String(h.id), { name: 'Sí', colors: ['#008000'], candidates: row.candidates }, {})).resolves.toMatchObject({ color: '#008000', candidates: row.candidates });
  });
  it('[MX-04][ELE-OPT-P1-002][UNITARIA] normaliza color principal y paleta al editar opción', async () => {
    const h = harness(); const option: any = { _id: new Types.ObjectId(), eventId: h.id, name: 'Lista', color: '#000000', colors: ['#000000'], active: true, save: jest.fn(), toObject() { return this; } }; h.models.findOption.mockResolvedValue(option);
    await expect(h.service.updateOption(String(h.id), String(option._id), { colors: ['#00ff00', '#ffffff'] }, {})).resolves.toMatchObject({ color: '#00FF00', colors: ['#00FF00', '#FFFFFF'] });
  });
  it('[MX-04][ELE-OPT-P0-003][UNITARIA] rechaza paleta inválida y nombre duplicado', async () => {
    const h = harness(); await expect(h.service.createOption(String(h.id), { name: 'Lista', colors: ['azul'] }, {})).rejects.toThrow(BadRequestException);
    h.models.createOption.mockRejectedValueOnce({ code: 11000 }); await expect(h.service.createOption(String(h.id), { name: 'Lista', colors: ['#0057FF'] }, {})).rejects.toThrow(ConflictException);
  });
  it('[MX-04][ELE-CAN-P0-002][UNITARIA] rechaza candidato con cargo fuera del evento', async () => {
    const h = harness(); h.models.eventRoleFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ name: 'Presidencia' }]) });
    await expect(h.service.replaceOptionCandidates(String(h.id), String(new Types.ObjectId()), { candidates: [{ name: 'Ana', roleName: 'Tesorería', photoUrl: 'data:image/jpeg;base64,eA==' }] }, {})).rejects.toThrow(BadRequestException);
    expect(h.models.replaceCandidates).not.toHaveBeenCalled();
  });
  it('[MX-04][ELE-PRV-P1-002][UNITARIA] devuelve paleta y candidato técnico en respuesta de opción', async () => {
    const h = harness(); const row: any = { _id: new Types.ObjectId(), eventId: h.id, tenantId: h.tenantId, name: 'No', color: '#FF0000', colors: ['#FF0000'], candidates: [{ name: 'No', roleName: 'CONSULTA' }], active: true, toObject() { return this; } }; h.models.createOption.mockResolvedValue(row);
    await expect(h.service.createOption(String(h.id), { name: 'No', colors: ['#FF0000'], candidates: row.candidates }, {})).resolves.toMatchObject({ color: '#FF0000', colors: ['#FF0000'], candidates: row.candidates });
  });
  it('[MX-04][ELE-RDY-P1-001][UNITARIA] informa pendientes cuando la estructura está incompleta', async () => {
    const h = harness(); await expect(h.service.markReadyForReview(String(h.id), {})).rejects.toThrow(BadRequestException); expect(h.event.save).not.toHaveBeenCalled();
  });
  it('[MX-04][ELE-RDY-P0-002][UNITARIA] lleva elección normal completa a READY_FOR_REVIEW', async () => {
    const h = harness(); h.models.eventRoleFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ name: 'Presidencia' }]) }); h.models.optionFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ name: 'Ana', roleName: 'Presidencia' }] }]) }); h.draftLean.mockResolvedValue({ _id: new Types.ObjectId(), summary: { stagingCount: 1, invalidCount: 0, duplicateCount: 0, missingIdentityCount: 0, enabledCount: 1 } });
    await expect(h.service.markReadyForReview(String(h.id), {})).resolves.toMatchObject({ state: 'READY_FOR_REVIEW' }); expect(h.notifications.notifyConvocationIfEligible).toHaveBeenCalledWith(h.event);
  });
  it('[MX-04][ELE-RDY-P0-003][UNITARIA] lleva referéndum completo a READY_FOR_REVIEW', async () => {
    const h = harness(); h.event.isReferendum = true; h.models.eventRoleFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ name: 'CONSULTA' }]) }); h.models.optionFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ active: true, candidates: [{ name: 'Sí', roleName: 'CONSULTA' }] }]) }); h.draftLean.mockResolvedValue({ _id: new Types.ObjectId(), summary: { stagingCount: 1, invalidCount: 0, duplicateCount: 0, missingIdentityCount: 0, enabledCount: 1 } });
    await expect(h.service.markReadyForReview(String(h.id), {})).resolves.toMatchObject({ state: 'READY_FOR_REVIEW' }); expect(h.event.isReferendum).toBe(true);
  });
  it('[MX-04][ELE-EDT-P0-001][UNITARIA] guarda datos estructurales mientras el evento es editable', async () => {
    const h = harness(); await expect(h.service.updateEvent(String(h.id), { name: ' Elección editada ' }, {})).resolves.toMatchObject({ name: 'Elección editada' }); expect(h.event.save).toHaveBeenCalled();
  });
  it('[MX-04][ELE-EDT-P0-002][UNITARIA] no persiste edición si la ventana estructural cerró', async () => {
    const h = harness(); h.access.canFullyEditEvent.mockReturnValue(false); await expect(h.service.updateEvent(String(h.id), { name: 'No guardar' }, {})).rejects.toThrow(BadRequestException); expect(h.event.save).not.toHaveBeenCalled();
  });
  it('[MX-04][ELE-CANCL-P0-001][UNITARIA] cancela lógicamente sin borrar recursos', async () => {
    const h = harness(); await expect(h.service.deleteEvent(String(h.id), { sub: 'admin-1' })).resolves.toMatchObject({ deleted: true, state: 'CANCELLED' }); expect(h.models.sessions).toHaveBeenCalled(); expect(h.event.save).toHaveBeenCalled();
  });
  it('[MX-04][ELE-HTTP-P0-002][UNITARIA] conserva configuración cuando cargo usado no puede eliminarse', async () => {
    const h = harness(); const role: any = { _id: new Types.ObjectId(), eventId: h.id, name: 'Presidencia' }; h.models.findRole.mockResolvedValue(role); h.models.exists.mockResolvedValue({ _id: new Types.ObjectId() });
    await expect(h.service.deleteRole(String(h.id), String(role._id), {})).rejects.toThrow(ConflictException); expect(h.models.deleteRole).not.toHaveBeenCalled();
  });
});
