import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InstitutionalAuditQueryDto } from '../dto/institutional-audit-query.dto';
import { InstitutionalAuditService } from '../services/institutional-audit.service';

@ApiTags('Institutional Audit')
@Controller('api/v1/institutional-tenants/:tenantId/audit')
export class InstitutionalAuditController {
  constructor(private readonly institutionalAuditService: InstitutionalAuditService) {}

  @Get()
  @ApiOperation({
    summary: 'Consultar auditoria institucional',
    description:
      'Lista eventos append-only de auditoria de un tenant con aislamiento por ADMIN o PRIMARY activo.',
  })
  @ApiParam({ name: 'tenantId', description: 'ID del tenant/institución.' })
  @ApiResponse({ status: 200, description: 'Listado paginado de auditoria institucional.' })
  listTenantAudit(
    @Param('tenantId') tenantId: string,
    @Query() query: InstitutionalAuditQueryDto,
    @Req() req: any,
  ) {
    return this.institutionalAuditService.listTenantAudit(tenantId, query, req.user);
  }
}
