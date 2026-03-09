import {
  Body,
  Controller,
  Get,
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
}
