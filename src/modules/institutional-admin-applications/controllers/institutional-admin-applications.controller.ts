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
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { CreateInstitutionalAdminApplicationDto } from '../dto/create-institutional-admin-application.dto';
import { VerifyInstitutionalAdminApplicationDto } from '../dto/verify-institutional-admin-application.dto';
import { InstitutionalAdminApplicationsService } from '../services/institutional-admin-applications.service';

@ApiTags('Institutional Admin Applications')
@Controller('api/v1/institutional-admin-applications')
export class InstitutionalAdminApplicationsController {
  constructor(
    private readonly institutionalAdminApplicationsService: InstitutionalAdminApplicationsService,
  ) {}

  @Post()
  @Public()
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
  @UseGuards(AdminOnlyGuard)
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

  @Post(':applicationId/approve')
  @UseGuards(AdminOnlyGuard)
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
