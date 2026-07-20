import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import {
  AssignTenantAdminDto,
  CreateInstitutionalTenantDto,
  InstitutionalTenantListQueryDto,
  RegularizeTenantAdminWalletDto,
  TransferTenantPrimaryDto,
  UpdateTenantAdminStatusDto,
} from '../dto/institutional-tenant.dto';
import { InstitutionalTenantAdminGuard } from '../guards/institutional-tenant-admin.guard';
import { InstitutionalTenantsService } from '../services/institutional-tenants.service';

@ApiTags('Institutional Tenants')
@Controller('api/v1/institutional-tenants')
export class InstitutionalTenantsController {
  constructor(private readonly institutionalTenantsService: InstitutionalTenantsService) {}

  @Get('public')
  @Public()
  @ApiOperation({
    summary: 'Catálogo público de instituciones activas',
    description: 'Lista instituciones activas para el formulario de registro institucional.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Catálogo público de instituciones.' })
  listPublicTenants(@Query() query: InstitutionalTenantListQueryDto) {
    return this.institutionalTenantsService.listPublicTenants(query);
  }

  @Get()
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({
    summary: 'Listado global de instituciones para ADMIN',
    description: 'Lista instituciones con administradores y wallets asociadas.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Listado administrativo global de instituciones.' })
  listTenantsForAdmin(@Query() query: InstitutionalTenantListQueryDto) {
    return this.institutionalTenantsService.listTenantsForAdmin(query);
  }

  @Post()
  @UseGuards(AdminOnlyGuard)
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
  @UseGuards(AdminOnlyGuard)
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

  @Get(':tenantId/admins')
  @UseGuards(InstitutionalTenantAdminGuard)
  @ApiOperation({
    summary: 'Listar administradores institucionales',
    description: 'Lista assignments administrativos seguros de un tenant institucional.',
  })
  @ApiParam({ name: 'tenantId', description: 'ID del tenant/institución.' })
  @ApiResponse({ status: 200, description: 'Listado de administradores del tenant.' })
  listAdmins(@Param('tenantId') tenantId: string, @Req() req: any) {
    return this.institutionalTenantsService.listAdmins(tenantId, req.user);
  }

  @Patch(':tenantId/admins/:assignmentId/status')
  @UseGuards(InstitutionalTenantAdminGuard)
  @ApiOperation({
    summary: 'Cambiar estado de administrador secundario',
    description: 'Deshabilita o rehabilita un administrador SECONDARY del tenant.',
  })
  @ApiParam({ name: 'tenantId', description: 'ID del tenant/institución.' })
  @ApiParam({ name: 'assignmentId', description: 'ID del assignment administrativo.' })
  @ApiBody({ type: UpdateTenantAdminStatusDto })
  @ApiResponse({ status: 200, description: 'Estado actualizado correctamente.' })
  updateAdminStatus(
    @Param('tenantId') tenantId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: UpdateTenantAdminStatusDto,
    @Req() req: any,
  ) {
    return this.institutionalTenantsService.updateAdminStatus(
      tenantId,
      assignmentId,
      dto,
      req.user,
    );
  }

  @Post(':tenantId/primary/transfer')
  @UseGuards(InstitutionalTenantAdminGuard)
  @ApiOperation({
    summary: 'Transferir administrador principal institucional',
    description:
      'Transfiere PRIMARY a un SECONDARY elegible del mismo tenant mediante transacción.',
  })
  @ApiParam({ name: 'tenantId', description: 'ID del tenant/institución.' })
  @ApiBody({ type: TransferTenantPrimaryDto })
  @ApiResponse({ status: 201, description: 'Principal transferido correctamente.' })
  transferPrimary(
    @Param('tenantId') tenantId: string,
    @Body() dto: TransferTenantPrimaryDto,
    @Req() req: any,
  ) {
    return this.institutionalTenantsService.transferPrimary(tenantId, dto, req.user);
  }

  @Post(':tenantId/admins/me/wallet-regularization')
  @UseGuards(InstitutionalTenantAdminGuard)
  @ApiOperation({
    summary: 'Regularizar wallet de administrador institucional heredado',
    description:
      'Valida contra Identity y persiste la wallet del assignment autenticado cuando no tenia wallet.',
  })
  @ApiParam({ name: 'tenantId', description: 'ID del tenant/institución.' })
  @ApiBody({ type: RegularizeTenantAdminWalletDto })
  @ApiResponse({ status: 201, description: 'Wallet regularizada correctamente.' })
  regularizeOwnWallet(
    @Param('tenantId') tenantId: string,
    @Body() dto: RegularizeTenantAdminWalletDto,
    @Req() req: any,
  ) {
    return this.institutionalTenantsService.regularizeOwnWallet(tenantId, dto, req.user);
  }
}
