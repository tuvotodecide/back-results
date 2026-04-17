import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';

describe('InstitutionalVotingAccessService (unit)', () => {
  let service: InstitutionalVotingAccessService;

  let votingEventModel: {
    findById: jest.Mock;
  };
  let tenantModel: {
    findById: jest.Mock;
    find: jest.Mock;
  };
  let assignmentModel: {
    findOne: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(async () => {
    votingEventModel = {
      findById: jest.fn(),
    };
    tenantModel = {
      findById: jest.fn(),
      find: jest.fn(),
    };
    assignmentModel = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstitutionalVotingAccessService,
        { provide: getModelToken(VotingEvent.name), useValue: votingEventModel },
        {
          provide: getModelToken(InstitutionalTenant.name),
          useValue: tenantModel,
        },
        {
          provide: getModelToken(TenantAdminAssignment.name),
          useValue: assignmentModel,
        },
      ],
    }).compile();

    service = moduleRef.get(InstitutionalVotingAccessService);
  });

  it('permite escritura al administrador global sin consultar asignaciones', async () => {
    await expect(
      service.assertTenantWriteAccess(new Types.ObjectId(), { role: 'ADMIN' }),
    ).resolves.toBeUndefined();

    expect(assignmentModel.findOne).not.toHaveBeenCalled();
  });

  it('permite aprobaciones reservadas al administrador global', () => {
    expect(() =>
      service.assertGlobalAdminAccess({ role: 'ADMIN' }, 'aprobar el padrón'),
    ).not.toThrow();
  });

  it('rechaza aprobaciones reservadas para usuarios que no son administradores globales', () => {
    expect(() =>
      service.assertGlobalAdminAccess(
        { role: 'GOVERNOR', sub: String(new Types.ObjectId()) },
        'aprobar el padrón',
      ),
    ).toThrow(ForbiddenException);
  });

  it('rechaza escritura sin identidad del solicitante', async () => {
    await expect(
      service.assertTenantWriteAccess(new Types.ObjectId(), { role: 'TENANT_ADMIN' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rechaza escritura cuando no existe asignación activa al tenant', async () => {
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.assertTenantWriteAccess(new Types.ObjectId(), {
        sub: String(new Types.ObjectId()),
        role: 'TENANT_ADMIN',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('devuelve solo los tenants activos asignados a un administrador institucional', async () => {
    const requesterId = new Types.ObjectId();
    const tenantA = new Types.ObjectId();
    const tenantB = new Types.ObjectId();

    assignmentModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { tenantId: tenantA },
        { tenantId: tenantB },
      ]),
    });
    tenantModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: tenantA }]),
    });

    const result = await service.resolveReadableTenantIds({
      sub: String(requesterId),
      role: 'TENANT_ADMIN',
    });

    expect(result).toEqual([tenantA]);
  });

  it('devuelve todos los tenants activos cuando el solicitante es administrador global y no filtra', async () => {
    const tenantA = new Types.ObjectId();
    const tenantB = new Types.ObjectId();
    tenantModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: tenantA }, { _id: tenantB }]),
    });

    const result = await service.resolveReadableTenantIds({ role: 'ADMIN' });

    expect(result).toEqual([tenantA, tenantB]);
  });

  it('permite filtrar un tenant específico al administrador global', async () => {
    const tenantId = new Types.ObjectId();
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    });

    const result = await service.resolveReadableTenantIds(
      { role: 'ADMIN' },
      String(tenantId),
    );

    expect(result).toEqual([tenantId]);
  });

  it('permite leer un tenant específico cuando existe asignación activa', async () => {
    const tenantId = new Types.ObjectId();
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    });
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ tenantId }),
    });

    const result = await service.resolveReadableTenantIds(
      { sub: String(new Types.ObjectId()), role: 'TENANT_ADMIN' },
      String(tenantId),
    );

    expect(result).toEqual([tenantId]);
  });

  it('rechaza lectura de un tenant ajeno cuando no existe asignación activa', async () => {
    const tenantId = new Types.ObjectId();
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    });
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.resolveReadableTenantIds(
        { sub: String(new Types.ObjectId()), role: 'TENANT_ADMIN' },
        String(tenantId),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rechaza lectura general cuando no existe identidad del solicitante y no es admin', async () => {
    await expect(
      service.resolveReadableTenantIds({ role: 'TENANT_ADMIN' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('devuelve lista vacía cuando el administrador institucional no tiene asignaciones activas', async () => {
    assignmentModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const result = await service.resolveReadableTenantIds({
      sub: String(new Types.ObjectId()),
      role: 'TENANT_ADMIN',
    });

    expect(result).toEqual([]);
  });

  it('rechaza tenant inválido o inactivo', async () => {
    await expect(service.getTenantOrThrow('bad-id')).rejects.toThrow(
      BadRequestException,
    );

    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getTenantOrThrow(String(new Types.ObjectId()))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rechaza evento inexistente o identificador inválido', async () => {
    await expect(service.getEventOrThrow('bad-id')).rejects.toThrow(
      BadRequestException,
    );

    votingEventModel.findById.mockResolvedValue(null);

    await expect(service.getEventOrThrow(String(new Types.ObjectId()))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('valida y parsea fechas coherentes del evento', () => {
    const votingStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const votingEnd = new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString();
    const resultsPublishAt = new Date(
      Date.now() + 50 * 60 * 60 * 1000,
    ).toISOString();

    const result = service.parseAndValidateDates(
      votingStart,
      votingEnd,
      resultsPublishAt,
      true,
    );

    expect(result.votingStart).toBeInstanceOf(Date);
    expect(result.votingEnd).toBeInstanceOf(Date);
    expect(result.resultsPublishAt).toBeInstanceOf(Date);
  });

  it('permite fechas exactamente en el límite mínimo de 36 horas', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const votingStart = new Date(now + 36 * 60 * 60 * 1000).toISOString();
    const votingEnd = new Date(now + 37 * 60 * 60 * 1000).toISOString();
    const resultsPublishAt = new Date(now + 38 * 60 * 60 * 1000).toISOString();

    const result = service.parseAndValidateDates(votingStart, votingEnd, resultsPublishAt, true);
    nowSpy.mockRestore();

    expect(result.votingStart).toBeInstanceOf(Date);
  });

  it('calcula publishDeadline exactamente 24 horas antes de votingStart', () => {
    const votingStart = new Date('2026-04-25T00:01:00.000Z');

    expect(service.computePublishDeadline(votingStart)?.toISOString()).toBe(
      '2026-04-24T00:01:00.000Z',
    );
  });

  it('permite fechas cercanas cuando la regla de ventana no se exige', () => {
    const result = service.parseAndValidateDates(
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      false,
    );

    expect(result.votingStart).toBeInstanceOf(Date);
  });

  it('devuelve objeto vacío cuando no se envían fechas', () => {
    expect(service.parseAndValidateDates()).toEqual({});
  });

  it('rechaza fechas incompletas o fuera de regla operativa', () => {
    expect(() =>
      service.parseAndValidateDates(
        new Date(Date.now() + 60_000).toISOString(),
        undefined,
        undefined,
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      service.parseAndValidateDates(
        new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      service.parseAndValidateDates(
        new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        true,
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      service.parseAndValidateDates(
        new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 48.5 * 60 * 60 * 1000).toISOString(),
        false,
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      service.parseAndValidateDates('fecha-invalida', 'otra-fecha', 'otra-mas', false),
    ).toThrow(BadRequestException);
  });

  it('bloquea edición total una vez confirmada la publicación oficial aunque falten más de 24 horas', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const event = {
      state: 'OFFICIALLY_PUBLISHED',
      publicationConfirmed: true,
      publishDeadline: new Date('2026-01-02T12:00:00.000Z'),
      votingStart: new Date('2026-01-03T12:00:00.000Z'),
      votingEnd: new Date('2026-01-03T14:00:00.000Z'),
    } as any;

    expect(service.canFullyEditEvent(event, now)).toBe(false);
  });

  it('permite modo limitado de padrón después de publicar oficialmente y antes del cierre', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const event = {
      state: 'OFFICIALLY_PUBLISHED',
      publicationConfirmed: true,
      votingEnd: new Date('2026-01-03T14:00:00.000Z'),
    } as any;

    expect(service.canModifyPadronDuringVoting(event, now)).toBe(true);
  });
});
