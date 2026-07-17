import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  InstitutionalAuditAction,
  InstitutionalAuditEvent,
  InstitutionalAuditEventDocument,
  InstitutionalAuditTargetType,
} from '../schemas/institutional-audit-event.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { InstitutionalAuditQueryDto } from '../dto/institutional-audit-query.dto';

type AuditState = Record<string, unknown> | null | undefined;

export type RecordInstitutionalAuditEvent = {
  tenantId?: Types.ObjectId | string | null;
  actor?: any;
  actorInstitutionalRole?: 'PRIMARY' | 'SECONDARY' | null;
  action: InstitutionalAuditAction;
  targetType: InstitutionalAuditTargetType;
  targetId?: Types.ObjectId | string | null;
  targetUserId?: Types.ObjectId | string | null;
  applicationId?: Types.ObjectId | string | null;
  assignmentId?: Types.ObjectId | string | null;
  recoveryRequestId?: Types.ObjectId | string | null;
  previousState?: AuditState;
  newState?: AuditState;
  reason?: string | null;
  correlationId?: string | null;
  session?: ClientSession;
};

@Injectable()
export class InstitutionalAuditService {
  constructor(
    @InjectModel(InstitutionalAuditEvent.name)
    private readonly auditEventModel: Model<InstitutionalAuditEventDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
  ) {}

  async record(event: RecordInstitutionalAuditEvent) {
    const document = {
      tenantId: this.toOptionalObjectId(event.tenantId),
      actorUserId: this.resolveActorId(event.actor),
      actorGlobalRole: event.actor?.role ?? null,
      actorInstitutionalRole: event.actorInstitutionalRole ?? null,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ? String(event.targetId) : null,
      targetUserId: this.toOptionalObjectId(event.targetUserId),
      applicationId: this.toOptionalObjectId(event.applicationId),
      assignmentId: this.toOptionalObjectId(event.assignmentId),
      recoveryRequestId: this.toOptionalObjectId(event.recoveryRequestId),
      previousState: this.sanitizeState(event.previousState),
      newState: this.sanitizeState(event.newState),
      reason: event.reason?.trim() || null,
      correlationId: event.correlationId?.trim() || null,
      createdAt: new Date(),
    };

    if (event.session) {
      const [created] = await this.auditEventModel.create([document], {
        session: event.session,
      });
      return created;
    }
    return this.auditEventModel.create(document);
  }

  async resolveActorInstitutionalRole(
    tenantId: Types.ObjectId | string | null | undefined,
    actor: any,
    session?: ClientSession,
  ): Promise<'PRIMARY' | 'SECONDARY' | null> {
    if (!tenantId || !actor?.sub || !Types.ObjectId.isValid(String(actor.sub))) {
      return null;
    }

    let query = this.assignmentModel.findOne({
      tenantId: this.toOptionalObjectId(tenantId),
      userId: new Types.ObjectId(String(actor.sub)),
      status: 'APPROVED',
      active: true,
      institutionalRole: { $in: ['PRIMARY', 'SECONDARY'] },
    });
    if (session) {
      query = query.session(session);
    }
    const assignment = await query.lean();
    return assignment?.institutionalRole ?? null;
  }

  async listTenantAudit(tenantId: string, queryDto: InstitutionalAuditQueryDto, requester: any) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('tenantId invalido');
    }
    const tenantObjectId = new Types.ObjectId(tenantId);
    const tenant = await this.tenantModel.findById(tenantObjectId, { active: 1 }).lean();
    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }

    await this.assertCanReadTenantAudit(tenantObjectId, requester);

    const query: Record<string, any> = { tenantId: tenantObjectId };
    if (queryDto.action) {
      query.action = queryDto.action;
    }
    if (queryDto.actorUserId) {
      query.actorUserId = new Types.ObjectId(queryDto.actorUserId);
    }
    if (queryDto.targetUserId) {
      query.targetUserId = new Types.ObjectId(queryDto.targetUserId);
    }
    if (queryDto.correlationId) {
      query.correlationId = queryDto.correlationId.trim();
    }
    const createdAt: Record<string, Date> = {};
    if (queryDto.from) {
      createdAt.$gte = new Date(queryDto.from);
    }
    if (queryDto.to) {
      createdAt.$lte = new Date(queryDto.to);
    }
    if (Object.keys(createdAt).length) {
      query.createdAt = createdAt;
    }

    const page = Math.max(1, Number(queryDto.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(queryDto.limit ?? 50)));
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.auditEventModel
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.auditEventModel.countDocuments(query),
    ]);

    return {
      data: rows.map((row) => this.toResponse(row)),
      total,
      page,
      limit,
    };
  }

  private async assertCanReadTenantAudit(tenantId: Types.ObjectId, requester: any) {
    if (requester?.role === 'ADMIN') {
      return;
    }
    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('No autorizado para consultar auditoria institucional');
    }
    const primary = await this.assignmentModel
      .findOne({
        tenantId,
        userId: new Types.ObjectId(requesterId),
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      })
      .lean();
    if (!primary) {
      throw new ForbiddenException('No autorizado para consultar auditoria institucional');
    }
  }

  private sanitizeState(value: AuditState): Record<string, unknown> | null {
    if (!value) {
      return null;
    }
    return this.sanitizeValue(value) as Record<string, unknown>;
  }

  private sanitizeValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }
    if (value instanceof Date) {
      return value;
    }
    if (value instanceof Types.ObjectId) {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (this.isSensitiveKey(key)) {
          continue;
        }
        result[key] = this.sanitizeValue(nested);
      }
      return result;
    }
    return value;
  }

  private isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return [
      'password',
      'passwordhash',
      'passwordresettoken',
      'verificationtoken',
      'token',
      'jwt',
      'apikey',
      'api_key',
      'x-api-key',
      'dni',
      'discoverablehash',
      'identityresponse',
      'phonenumber',
      'supervisorphonenumber',
      'email',
      'newemail',
      'currentemail',
      'resetlink',
      'privatekey',
      'secret',
      'stack',
      'body',
    ].includes(normalized);
  }

  private toOptionalObjectId(value?: Types.ObjectId | string | null): Types.ObjectId | null {
    if (!value) {
      return null;
    }
    if (value instanceof Types.ObjectId) {
      return value;
    }
    return Types.ObjectId.isValid(String(value)) ? new Types.ObjectId(String(value)) : null;
  }

  private resolveActorId(actor: any): Types.ObjectId | null {
    const actorId = actor?.sub ? String(actor.sub) : '';
    return actorId && Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : null;
  }

  private toResponse(row: any) {
    return {
      id: String(row._id),
      tenantId: row.tenantId ? String(row.tenantId) : null,
      actorUserId: row.actorUserId ? String(row.actorUserId) : null,
      actorGlobalRole: row.actorGlobalRole ?? null,
      actorInstitutionalRole: row.actorInstitutionalRole ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      targetUserId: row.targetUserId ? String(row.targetUserId) : null,
      applicationId: row.applicationId ? String(row.applicationId) : null,
      assignmentId: row.assignmentId ? String(row.assignmentId) : null,
      recoveryRequestId: row.recoveryRequestId ? String(row.recoveryRequestId) : null,
      previousState: row.previousState ?? null,
      newState: row.newState ?? null,
      reason: row.reason ?? null,
      correlationId: row.correlationId ?? null,
      createdAt: row.createdAt,
    };
  }
}
