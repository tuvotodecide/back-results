import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalAdminApplication } from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';

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
  let applicationModel: {
    findOne: jest.Mock;
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
    applicationModel = {
      findOne: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue(null),
      })),
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
        {
          provide: getModelToken(InstitutionalAdminApplication.name),
          useValue: applicationModel,
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

  it('permite escritura con tenant activo y asignación aprobada activa', async () => {
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), active: true }),
    });
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ status: 'APPROVED', active: true, accountAddress: '0x1234567890abcdef1234567890abcdef12345678' }),
    });

    await expect(
      service.assertTenantWriteAccess(new Types.ObjectId(), {
        sub: String(new Types.ObjectId()),
        role: 'TENANT_ADMIN',
      }),
    ).resolves.toBeUndefined();
  });

  it('bloquea escritura mientras la regularizacion institucional espera confirmacion de red', async () => {
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), active: true }),
    });
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        status: 'APPROVED',
        active: true,
        accountAddress: '0x1234567890abcdef1234567890abcdef12345678',
      }),
    });
    applicationModel.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });

    await expect(
      service.assertTenantWriteAccess(new Types.ObjectId(), {
        sub: String(new Types.ObjectId()),
        role: 'TENANT_ADMIN',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSTITUTION_REGULARIZATION_PENDING_NETWORK_CONFIRMATION',
      }),
    });
  });

  it('rechaza escritura cuando la asignación activa no tiene wallet operativa', async () => {
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), active: true }),
    });
    assignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ status: 'APPROVED', active: true, accountAddress: null }),
    });

    await expect(
      service.assertTenantWriteAccess(new Types.ObjectId(), {
        sub: String(new Types.ObjectId()),
        role: 'TENANT_ADMIN',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rechaza escritura cuando no existe asignación activa al tenant', async () => {
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), active: true }),
    });
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

  it('rechaza escritura cuando el tenant está inactivo aunque el token exista', async () => {
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), active: false }),
    });

    await expect(
      service.assertTenantWriteAccess(new Types.ObjectId(), {
        sub: String(new Types.ObjectId()),
        role: 'TENANT_ADMIN',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(assignmentModel.findOne).not.toHaveBeenCalled();
  });

  it('rechaza escritura cuando la asignación está revocada o inactiva', async () => {
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), active: true }),
    });
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

  it('resolveAdminWalletForTenant devuelve la wallet activa del usuario en el tenant', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    });
    assignmentModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          tenantId,
          userId,
          active: true,
          status: 'APPROVED',
          accountAddress: '0x1234567890abcdef1234567890abcdef12345678',
          institutionalRole: 'PRIMARY',
        },
      ]),
    });

    await expect(
      service.resolveAdminWalletForTenant(String(userId), String(tenantId)),
    ).resolves.toEqual({
      tenantId: String(tenantId),
      userId: String(userId),
      accountAddress: '0x1234567890abcdef1234567890abcdef12345678',
      institutionalRole: 'PRIMARY',
    });
  });

  it('resolveAdminWalletForTenant rechaza assignment inactivo o tenant ajeno', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    });
    assignmentModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    await expect(
      service.resolveAdminWalletForTenant(String(userId), String(tenantId)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('resolveAdminWalletForTenant rechaza relaciones activas sin wallet', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    });
    assignmentModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { tenantId, userId, active: true, status: 'APPROVED', accountAddress: null },
      ]),
    });

    await expect(
      service.resolveAdminWalletForTenant(String(userId), String(tenantId)),
    ).rejects.toThrow(ConflictException);
  });

  it('resolveAdminWalletForTenant rechaza relaciones activas sin rol institucional', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    });
    assignmentModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          tenantId,
          userId,
          active: true,
          status: 'APPROVED',
          accountAddress: '0x1234567890abcdef1234567890abcdef12345678',
        },
      ]),
    });

    await expect(
      service.resolveAdminWalletForTenant(String(userId), String(tenantId)),
    ).rejects.toThrow(ConflictException);
  });

  it('resolveAdminWalletForTenant rechaza resultados ambiguos', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    });
    assignmentModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          tenantId,
          userId,
          active: true,
          status: 'APPROVED',
          accountAddress: '0x1234567890abcdef1234567890abcdef12345678',
          institutionalRole: 'PRIMARY',
        },
        {
          tenantId,
          userId,
          active: true,
          status: 'APPROVED',
          accountAddress: '0x9999999999999999999999999999999999999999',
          institutionalRole: 'SECONDARY',
        },
      ]),
    });

    await expect(
      service.resolveAdminWalletForTenant(String(userId), String(tenantId)),
    ).rejects.toThrow(ConflictException);
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
    const createLeadHours = service.getCreateLeadHours();

    const result = service.parseAndValidateDates(
      votingStart,
      votingEnd,
      resultsPublishAt,
      createLeadHours,
    );

    expect(result.votingStart).toBeInstanceOf(Date);
    expect(result.votingEnd).toBeInstanceOf(Date);
    expect(result.resultsPublishAt).toBeInstanceOf(Date);
  });

  it('permite fechas exactamente en el límite mínimo de 12 horas', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const createLeadHours = service.getCreateLeadHours();
    const votingStart = new Date(now + createLeadHours * 60 * 60 * 1000).toISOString();
    const votingEnd = new Date(now + (createLeadHours + 1) * 60 * 60 * 1000).toISOString();
    const resultsPublishAt = new Date(
      now + (createLeadHours + 2) * 60 * 60 * 1000,
    ).toISOString();

    const result = service.parseAndValidateDates(
      votingStart,
      votingEnd,
      resultsPublishAt,
      createLeadHours,
    );
    nowSpy.mockRestore();

    expect(result.votingStart).toBeInstanceOf(Date);
  });

  it('calcula publishDeadline exactamente 6 horas antes de votingStart', () => {
    const votingStart = new Date('2026-04-25T00:01:00.000Z');

    expect(service.computePublishDeadline(votingStart)?.toISOString()).toBe(
      '2026-04-24T18:01:00.000Z',
    );
  });

  it('permite fechas exactamente en el límite mínimo de 6 horas para publicación oficial', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const officialPublicationLeadHours = service.getOfficialPublicationLeadHours();
    const votingStart = new Date(
      now + officialPublicationLeadHours * 60 * 60 * 1000,
    ).toISOString();
    const votingEnd = new Date(
      now + (officialPublicationLeadHours + 1) * 60 * 60 * 1000,
    ).toISOString();
    const resultsPublishAt = new Date(
      now + (officialPublicationLeadHours + 2) * 60 * 60 * 1000,
    ).toISOString();

    try {
      const result = service.parseAndValidateDates(
        votingStart,
        votingEnd,
        resultsPublishAt,
        officialPublicationLeadHours,
      );

      expect(result.votingStart).toBeInstanceOf(Date);
    } finally {
      nowSpy.mockRestore();
    }
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
        service.getCreateLeadHours(),
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      service.parseAndValidateDates(
        new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 48.5 * 60 * 60 * 1000).toISOString(),
        service.getOfficialPublicationLeadHours(),
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      service.parseAndValidateDates(
        'fecha-invalida',
        'otra-fecha',
        'otra-mas',
        service.getOfficialPublicationLeadHours(),
      ),
    ).toThrow(BadRequestException);
  });

  it('bloquea edición total una vez confirmada la publicación oficial aunque falten más de 6 horas', () => {
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

  it('respeta la bandera para habilitar votantes existentes después de publicar', () => {
    jest.spyOn(service, 'canModifyPadronDuringVoting').mockReturnValue(true);

    expect(
      service.canEnableExistingPadronEntriesPostPublication({
        state: 'OFFICIALLY_PUBLISHED',
        publicationConfirmed: true,
        votingEnd: new Date('2026-01-03T14:00:00.000Z'),
        allowPostPublicationPadronEnable: true,
      } as any),
    ).toBe(true);
    expect(
      service.canEnableExistingPadronEntriesPostPublication({
        state: 'OFFICIALLY_PUBLISHED',
        publicationConfirmed: true,
        votingEnd: new Date('2026-01-03T14:00:00.000Z'),
        allowPostPublicationPadronEnable: false,
      } as any),
    ).toBe(false);
  });

  it('bloquea la habilitación post-publicación si el modo limitado no aplica', () => {
    jest.spyOn(service, 'canModifyPadronDuringVoting').mockReturnValue(false);

    expect(
      service.canEnableExistingPadronEntriesPostPublication({
        state: 'OFFICIALLY_PUBLISHED',
        publicationConfirmed: true,
        votingEnd: new Date('2026-01-03T14:00:00.000Z'),
        allowPostPublicationPadronEnable: true,
      } as any),
    ).toBe(false);
  });
});
