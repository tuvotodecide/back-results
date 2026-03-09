import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import {
  AssignTenantAdminDto,
  CreateInstitutionalTenantDto,
} from '../dto/institutional-tenant.dto';
import { InstitutionalTenantsService } from '../services/institutional-tenants.service';

@ApiTags('Institutional Tenants')
@Controller('api/v1/institutional-tenants')
@UseGuards(AdminOnlyGuard)
export class InstitutionalTenantsController {
  constructor(private readonly institutionalTenantsService: InstitutionalTenantsService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear tenant/institución',
    description:
      'Crea una nueva institución (tenant) para gestión de votaciones institucionales.',
  })
  @ApiBody({ type: CreateInstitutionalTenantDto })
  @ApiResponse({ status: 201, description: 'Tenant creado correctamente.' })
  createTenant(@Body() dto: CreateInstitutionalTenantDto) {
    return this.institutionalTenantsService.createTenant(dto);
  }

  @Post(':tenantId/admins')
  @ApiOperation({
    summary: 'Asignar administrador a tenant',
    description:
      'Vincula un usuario administrador existente a una institución (tenant) determinada.',
  })
  @ApiParam({ name: 'tenantId', description: 'ID del tenant/institución.' })
  @ApiBody({ type: AssignTenantAdminDto })
  @ApiResponse({ status: 201, description: 'Administrador asignado correctamente al tenant.' })
  assignAdmin(
    @Param('tenantId') tenantId: string,
    @Body() dto: AssignTenantAdminDto,
  ) {
    return this.institutionalTenantsService.assignAdmin(tenantId, dto);
  }
}
