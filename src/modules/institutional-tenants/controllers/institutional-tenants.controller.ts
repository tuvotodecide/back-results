import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import {
  AssignTenantAdminDto,
  CreateInstitutionalTenantDto,
} from '../dto/institutional-tenant.dto';
import { InstitutionalTenantsService } from '../services/institutional-tenants.service';

@ApiTags('Institutional Tenants')
@Controller('api/v1/institutional-tenants')
@UseGuards(AdminOnlyGuard, ZkAuthGuard)
export class InstitutionalTenantsController {
  constructor(private readonly institutionalTenantsService: InstitutionalTenantsService) {}

  @Post()
  createTenant(@Body() dto: CreateInstitutionalTenantDto) {
    return this.institutionalTenantsService.createTenant(dto);
  }

  @Post(':tenantId/admins')
  assignAdmin(
    @Param('tenantId') tenantId: string,
    @Body() dto: AssignTenantAdminDto,
  ) {
    return this.institutionalTenantsService.assignAdmin(tenantId, dto);
  }
}
