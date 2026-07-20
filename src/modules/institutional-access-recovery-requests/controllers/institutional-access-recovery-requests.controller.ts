import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { InstitutionalPublicRateLimitGuard } from '@/modules/institutional-admin-applications/guards/institutional-public-rate-limit.guard';
import {
  CreateInstitutionalAccessRecoveryRequestDto,
  RejectInstitutionalAccessRecoveryRequestDto,
  ResolveInstitutionalAccessRecoveryRequestDto,
} from '../dto/institutional-access-recovery-request.dto';
import { InstitutionalAccessRecoveryRequestsService } from '../services/institutional-access-recovery-requests.service';

@ApiTags('Institutional Access Recovery Requests')
@Controller('api/v1/institutional-access-recovery-requests')
export class InstitutionalAccessRecoveryRequestsController {
  constructor(
    private readonly recoveryRequestsService: InstitutionalAccessRecoveryRequestsService,
  ) {}

  @Post()
  @Public()
  @UseGuards(InstitutionalPublicRateLimitGuard)
  @ApiOperation({ summary: 'Crear solicitud de recuperacion institucional' })
  @ApiBody({ type: CreateInstitutionalAccessRecoveryRequestDto })
  @ApiResponse({ status: 201, description: 'Solicitud registrada.' })
  create(@Body() dto: CreateInstitutionalAccessRecoveryRequestDto) {
    return this.recoveryRequestsService.createRequest(dto);
  }

  @Get()
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Listar solicitudes de recuperacion institucional' })
  @ApiQuery({ name: 'status', required: false })
  list(@Req() req: any, @Query('status') status?: string) {
    return this.recoveryRequestsService.listRequests(req.user, status);
  }

  @Get(':requestId')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Detalle de solicitud de recuperacion institucional' })
  @ApiParam({ name: 'requestId' })
  detail(@Param('requestId') requestId: string, @Req() req: any) {
    return this.recoveryRequestsService.getRequestDetail(requestId, req.user);
  }

  @Post(':requestId/approve')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Aprobar solicitud de recuperacion institucional' })
  @ApiParam({ name: 'requestId' })
  @ApiBody({ type: ResolveInstitutionalAccessRecoveryRequestDto })
  approve(
    @Param('requestId') requestId: string,
    @Body() dto: ResolveInstitutionalAccessRecoveryRequestDto,
    @Req() req: any,
  ) {
    return this.recoveryRequestsService.approveRequest(requestId, dto, req.user);
  }

  @Post(':requestId/reject')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Rechazar solicitud de recuperacion institucional' })
  @ApiParam({ name: 'requestId' })
  @ApiBody({ type: RejectInstitutionalAccessRecoveryRequestDto })
  reject(
    @Param('requestId') requestId: string,
    @Body() dto: RejectInstitutionalAccessRecoveryRequestDto,
    @Req() req: any,
  ) {
    return this.recoveryRequestsService.rejectRequest(requestId, dto, req.user);
  }
}
