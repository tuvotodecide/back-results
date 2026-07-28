import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { OfficialPublicationMobileRateLimitGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-rate-limit.guard';
import { AcceptInstitutionalAdminInvitationDto } from '../dto/accept-institutional-admin-invitation.dto';
import { CreateInstitutionalAdminApplicationDto } from '../dto/create-institutional-admin-application.dto';
import { CreateInstitutionalAdminInvitationDto } from '../dto/create-institutional-admin-invitation.dto';
import { ReviewInstitutionalAdminApplicationDto } from '../dto/review-institutional-admin-application.dto';
import { VerifyInstitutionalAdminApplicationDto } from '../dto/verify-institutional-admin-application.dto';
import { InstitutionalMobileZkAuthGuard } from '../auth/institutional-mobile-zk-auth.guard';
import { InstitutionalApplicationReviewGuard } from '../guards/institutional-application-review.guard';
import { InstitutionalPublicRateLimitGuard } from '../guards/institutional-public-rate-limit.guard';
import { InstitutionalAdminApplicationsService } from '../services/institutional-admin-applications.service';

@ApiTags('Institutional Admin Applications')
@Controller('api/v1/institutional-admin-applications')
export class InstitutionalAdminApplicationsController {
  constructor(
    private readonly institutionalAdminApplicationsService: InstitutionalAdminApplicationsService,
  ) {}

  @Post()
  @Public()
  @UseGuards(InstitutionalPublicRateLimitGuard)
  @ApiOperation({
    summary: 'Crear solicitud de alta institucional',
    description:
      'Registra solicitud de usuario institucional con datos básicos y estado inicial pendiente de verificación de correo.',
  })
  @ApiBody({ type: CreateInstitutionalAdminApplicationDto })
  @ApiResponse({ status: 201, description: 'Solicitud creada correctamente.' })
  createApplication(@Body() dto: CreateInstitutionalAdminApplicationDto) {
    return this.institutionalAdminApplicationsService.createApplication(dto);
  }

  @Post('verify-email')
  @Public()
  @UseGuards(InstitutionalPublicRateLimitGuard)
  @ApiOperation({
    summary: 'Verificar correo de solicitud institucional',
    description:
      'Confirma token de verificación enviado al correo y cambia la solicitud a pendiente de aprobación.',
  })
  @ApiBody({ type: VerifyInstitutionalAdminApplicationDto })
  @ApiResponse({ status: 200, description: 'Correo verificado correctamente.' })
  verifyEmail(@Body() dto: VerifyInstitutionalAdminApplicationDto) {
    return this.institutionalAdminApplicationsService.verifyEmail(dto.token);
  }

  @Get()
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Listar solicitudes institucionales',
    description: 'Lista solicitudes institucionales con filtro opcional por estado.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      'Filtra por estado de solicitud (PENDING_EMAIL_VERIFICATION, PENDING_APPROVAL, APPROVED, etc.).',
  })
  @ApiResponse({ status: 200, description: 'Listado de solicitudes institucionales.' })
  listApplications(@Query('status') status?: string) {
    return this.institutionalAdminApplicationsService.listApplications(status);
  }

  @Get('pending')
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Listar solicitudes institucionales pendientes',
    description: 'Retorna solo solicitudes en estado pendiente de aprobación.',
  })
  @ApiResponse({ status: 200, description: 'Listado de solicitudes pendientes.' })
  listPendingApplications() {
    return this.institutionalAdminApplicationsService.listPendingApplications();
  }

  @Get('tenants/:tenantId/invitations')
  @UseGuards(InstitutionalApplicationReviewGuard)
  @ApiOperation({
    summary: 'Listar invitaciones de administradores institucionales',
    description:
      'Lista invitaciones históricas y vigentes de un tenant para la vista Cuenta institucional.',
  })
  @ApiParam({ name: 'tenantId', description: 'ID del tenant/institución.' })
  @ApiResponse({ status: 200, description: 'Listado de invitaciones institucionales.' })
  listInvitations(
    @Param('tenantId') tenantId: string,
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.listInvitations(
      tenantId,
      req.user,
    );
  }

  @Post('tenants/:tenantId/invitations')
  @UseGuards(InstitutionalApplicationReviewGuard)
  @ApiOperation({
    summary: 'Invitar administrador a una institución existente',
    description:
      'Crea una invitación pendiente para una persona registrada en Identity y vinculada con billetera.',
  })
  createInvitation(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateInstitutionalAdminInvitationDto,
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.createInvitation(
      tenantId,
      dto,
      req.user,
    );
  }

  @Post('invitations/:invitationId/accept')
  @Public()
  @UseGuards(InstitutionalPublicRateLimitGuard)
  @ApiOperation({
    summary: 'Aceptar invitación institucional',
    description:
      'Valida token vigente, crea o reutiliza cuenta administrativa y genera solicitud pendiente de revisión.',
  })
  acceptInvitation(
    @Param('invitationId') invitationId: string,
    @Body() dto: AcceptInstitutionalAdminInvitationDto,
  ) {
    return this.institutionalAdminApplicationsService.acceptInvitation(
      invitationId,
      dto,
    );
  }

  @Post('invitations/:invitationId/reject')
  @Public()
  @UseGuards(InstitutionalPublicRateLimitGuard)
  @ApiOperation({
    summary: 'Rechazar invitación institucional',
    description: 'Cierra una invitación vigente sin crear solicitud ni acceso.',
  })
  rejectInvitation(
    @Param('invitationId') invitationId: string,
    @Body() dto: ReviewInstitutionalAdminApplicationDto = {},
  ) {
    return this.institutionalAdminApplicationsService.rejectInvitation(
      invitationId,
      dto.reason,
    );
  }

  @Post('invitations/:invitationId/cancel')
  @UseGuards(InstitutionalApplicationReviewGuard)
  @ApiOperation({
    summary: 'Cancelar invitación institucional',
    description: 'Permite al administrador principal cancelar una invitación pendiente.',
  })
  cancelInvitation(
    @Param('invitationId') invitationId: string,
    @Body() dto: ReviewInstitutionalAdminApplicationDto = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.cancelInvitation(
      invitationId,
      req.user,
      dto.reason,
    );
  }

  @Post('invitations/:invitationId/resend')
  @UseGuards(InstitutionalApplicationReviewGuard)
  @ApiOperation({
    summary: 'Reenviar aviso de invitación institucional',
    description:
      'Registra un nuevo aviso sin crear otra invitación ni extender el vencimiento.',
  })
  resendInvitation(
    @Param('invitationId') invitationId: string,
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.resendInvitation(
      invitationId,
      req.user,
    );
  }

  @Post('tenants/:tenantId/admins/:assignmentId/removal-authorizations')
  @UseGuards(InstitutionalApplicationReviewGuard)
  @ApiOperation({
    summary: 'Solicitar eliminación definitiva de wallet institucional',
    description:
      'Crea una autorización móvil para quitar la wallet de un administrador secundario después de confirmación de red.',
  })
  createRemovalAuthorization(
    @Param('tenantId') tenantId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: ReviewInstitutionalAdminApplicationDto = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.createRemovalAuthorization(
      tenantId,
      assignmentId,
      req.user,
      dto.reason,
    );
  }

  @Get('mobile/authorizations/:applicationId')
  @Public()
  @UseGuards(OfficialPublicationMobileRateLimitGuard, InstitutionalMobileZkAuthGuard)
  @ApiOperation({
    summary: 'Consultar autorización móvil institucional',
    description: 'Devuelve el detalle seguro de una autorización móvil vigente o su estado final.',
  })
  getMobileAuthorization(
    @Param('applicationId') applicationId: string,
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.getMobileAuthorizationRequest(
      applicationId,
      req.user,
    );
  }

  @Post('mobile/authorizations/:applicationId/claim')
  @Public()
  @UseGuards(OfficialPublicationMobileRateLimitGuard, InstitutionalMobileZkAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preparar paquete de autorización institucional para firma móvil' })
  claimMobileAuthorization(
    @Param('applicationId') applicationId: string,
    @Body() dto: any = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.claimMobileAuthorization(applicationId, dto, req.user);
  }

  @Post('mobile/authorizations/:applicationId/signing')
  @Public()
  @UseGuards(OfficialPublicationMobileRateLimitGuard, InstitutionalMobileZkAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar inicio de firma móvil institucional' })
  markMobileAuthorizationSigning(
    @Param('applicationId') applicationId: string,
    @Body() dto: any = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.markMobileAuthorizationSigning(applicationId, dto, req.user);
  }

  @Post('mobile/authorizations/:applicationId/reject')
  @Public()
  @UseGuards(OfficialPublicationMobileRateLimitGuard, InstitutionalMobileZkAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar autorización móvil institucional' })
  rejectMobileAuthorization(
    @Param('applicationId') applicationId: string,
    @Body() dto: any = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.rejectMobileAuthorization(applicationId, dto, req.user);
  }

  @Post('mobile/authorizations/:applicationId/submission')
  @Public()
  @UseGuards(OfficialPublicationMobileRateLimitGuard, InstitutionalMobileZkAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar operación firmada desde el teléfono' })
  submitMobileAuthorization(
    @Param('applicationId') applicationId: string,
    @Body() dto: any = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.submitMobileAuthorization(applicationId, dto, req.user);
  }

  @Get(':applicationId')
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Ver detalle de solicitud institucional',
    description: 'Retorna el detalle de una solicitud institucional por ID.',
  })
  @ApiParam({ name: 'applicationId', description: 'ID de la solicitud institucional.' })
  @ApiResponse({ status: 200, description: 'Detalle de solicitud institucional.' })
  getApplicationDetail(@Param('applicationId') applicationId: string) {
    return this.institutionalAdminApplicationsService.getApplicationDetail(applicationId);
  }

  @Post(':applicationId/approve')
  @UseGuards(InstitutionalApplicationReviewGuard)
  @ApiOperation({
    summary: 'Aprobar solicitud institucional',
    description:
      'Aprueba una solicitud pendiente, activa/crea usuario admin y lo asigna al tenant institucional correspondiente.',
  })
  @ApiParam({ name: 'applicationId', description: 'ID de la solicitud institucional.' })
  @ApiResponse({ status: 200, description: 'Solicitud aprobada correctamente.' })
  approve(@Param('applicationId') applicationId: string, @Req() req: any) {
    return this.institutionalAdminApplicationsService.approveApplication(applicationId, req.user);
  }

  @Post(':applicationId/reject')
  @UseGuards(InstitutionalApplicationReviewGuard)
  @ApiOperation({
    summary: 'Rechazar solicitud institucional',
    description: 'Marca la solicitud como rechazada y deja el membership tenant en REJECTED cuando exista.',
  })
  @ApiParam({ name: 'applicationId', description: 'ID de la solicitud institucional.' })
  @ApiBody({ type: ReviewInstitutionalAdminApplicationDto })
  reject(
    @Param('applicationId') applicationId: string,
    @Body() dto: ReviewInstitutionalAdminApplicationDto = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.rejectApplication(
      applicationId,
      req.user,
      dto.reason,
    );
  }

  @Post(':applicationId/revoke')
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Revocar acceso institucional',
    description: 'Revoca un acceso tenant previamente aprobado.',
  })
  @ApiParam({ name: 'applicationId', description: 'ID de la solicitud institucional.' })
  @ApiBody({ type: ReviewInstitutionalAdminApplicationDto })
  revoke(
    @Param('applicationId') applicationId: string,
    @Body() dto: ReviewInstitutionalAdminApplicationDto = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.revokeApplication(
      applicationId,
      req.user,
      dto.reason,
    );
  }

  @Post(':applicationId/reopen')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({
    summary: 'Reabrir solicitud institucional',
    description: 'Regresa una solicitud rechazada o revocada al estado pendiente.',
  })
  @ApiParam({ name: 'applicationId', description: 'ID de la solicitud institucional.' })
  @ApiBody({ type: ReviewInstitutionalAdminApplicationDto })
  reopen(
    @Param('applicationId') applicationId: string,
    @Body() dto: ReviewInstitutionalAdminApplicationDto = {},
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.reopenApplication(
      applicationId,
      req.user,
      dto.reason,
    );
  }

  @Post('test/approved-admin')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({
    summary: 'Crear admin institucional de prueba ya aprobado',
    description:
      'Crea usuario ADMIN activo, crea o reutiliza tenant, registra la solicitud como APPROVED y asigna el usuario al tenant para pruebas E2E.',
  })
  @ApiBody({ type: CreateInstitutionalAdminApplicationDto })
  @ApiResponse({ status: 201, description: 'Admin institucional de prueba creado.' })
  createApprovedTestAdmin(
    @Body() dto: CreateInstitutionalAdminApplicationDto,
    @Req() req: any,
  ) {
    return this.institutionalAdminApplicationsService.createApprovedTestAdmin(
      dto,
      req.user,
    );
  }

  @Delete('test/by-email/:email')
  @UseGuards(AdminOnlyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Eliminar datos de prueba institucionales por correo',
    description:
      'Elimina solicitud, usuario y asignaciones del admin institucional. Si el tenant queda vacio, tambien lo elimina.',
  })
  @ApiParam({ name: 'email', description: 'Correo del admin institucional de prueba.' })
  @ApiResponse({ status: 200, description: 'Datos de prueba eliminados.' })
  cleanupTestAdminByEmail(@Param('email') email: string) {
    return this.institutionalAdminApplicationsService.cleanupTestAdminByEmail(email);
  }
}
