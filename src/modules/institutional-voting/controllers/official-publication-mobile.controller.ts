import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { OfficialPublicationMobileZkAuthGuard } from '../auth/official-publication-mobile-zk-auth.guard';
import { OfficialPublicationMobileRateLimitGuard } from '../auth/official-publication-mobile-rate-limit.guard';
import {
  OfficialPublicationClaimDto,
  OfficialPublicationMobileClaimResponseDto,
  OfficialPublicationMobileSummaryResponseDto,
  OfficialPublicationRejectDto,
  OfficialPublicationSigningDto,
  OfficialPublicationSubmissionDto,
} from '../dto/official-publication-request.dto';
import { OfficialPublicationApiService } from '../services/publication/official-publication-api.service';

@ApiTags('Official Publication Mobile')
@ApiHeader({ name: 'x-api-key', required: true })
@Public()
@UseGuards(OfficialPublicationMobileRateLimitGuard, OfficialPublicationMobileZkAuthGuard)
@Controller('api/v1/mobile/official-publication/requests')
export class OfficialPublicationMobileController {
  constructor(
    private readonly officialPublicationApi: OfficialPublicationApiService,
  ) {}

  @Get(':requestId')
  @ApiOperation({
    summary: 'Consultar solicitud de publicacion oficial destinada al usuario movil',
    description:
      'Valida usuario, wallet institucional y asignacion activa; no devuelve payload de ejecucion antes del claim.',
  })
  @ApiParam({ name: 'requestId', description: 'ID publico de la solicitud.' })
  @ApiResponse({
    status: 200,
    description: 'Resumen seguro para la app movil.',
    type: OfficialPublicationMobileSummaryResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Solicitud inexistente o no destinada al usuario.' })
  getRequest(@Param('requestId') requestId: string, @Req() req: any) {
    return this.officialPublicationApi.getMobileRequest(requestId, req.user);
  }

  @Post(':requestId/claim')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reclamar solicitud desde un dispositivo movil',
    description:
      'Pasa PENDING_APPROVAL a CLAIMED y entrega el paquete de ejecucion preparado por backend. Es idempotente para el mismo dispositivo.',
  })
  @ApiParam({ name: 'requestId', description: 'ID publico de la solicitud.' })
  @ApiBody({ type: OfficialPublicationClaimDto })
  @ApiResponse({
    status: 200,
    description: 'Solicitud reclamada con paquete de ejecucion seguro.',
    type: OfficialPublicationMobileClaimResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Solicitud reclamada por otro dispositivo.' })
  @ApiResponse({ status: 410, description: 'Solicitud expirada.' })
  claim(
    @Param('requestId') requestId: string,
    @Body() dto: OfficialPublicationClaimDto,
    @Req() req: any,
  ) {
    return this.officialPublicationApi.claimMobileRequest(
      requestId,
      req.user,
      dto,
    );
  }

  @Post(':requestId/signing')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Marcar inicio de firma movil',
    description:
      'Requiere claim vigente del mismo usuario, wallet y dispositivo. No firma ni recibe PIN, biometria o claves.',
  })
  @ApiParam({ name: 'requestId', description: 'ID publico de la solicitud.' })
  @ApiBody({ type: OfficialPublicationSigningDto })
  @ApiResponse({
    status: 200,
    description: 'Solicitud marcada como SIGNING de forma idempotente.',
    type: OfficialPublicationMobileSummaryResponseDto,
  })
  signing(
    @Param('requestId') requestId: string,
    @Body() dto: OfficialPublicationSigningDto,
    @Req() req: any,
  ) {
    return this.officialPublicationApi.markMobileSigning(
      requestId,
      req.user,
      dto,
    );
  }

  @Post(':requestId/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rechazar solicitud antes del envio blockchain',
    description:
      'Acepta solo reasonCode seguro y no permite rechazar solicitudes con userOpHash registrado.',
  })
  @ApiParam({ name: 'requestId', description: 'ID publico de la solicitud.' })
  @ApiBody({ type: OfficialPublicationRejectDto })
  @ApiResponse({
    status: 200,
    description: 'Solicitud rechazada o rechazo repetido idempotente.',
    type: OfficialPublicationMobileSummaryResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Solicitud ya enviada o no rechazable.' })
  reject(
    @Param('requestId') requestId: string,
    @Body() dto: OfficialPublicationRejectDto,
    @Req() req: any,
  ) {
    return this.officialPublicationApi.rejectMobileRequest(
      requestId,
      req.user,
      dto,
    );
  }

  @Post(':requestId/submission')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Registrar userOpHash tras envio desde la app',
    description:
      'Registra un unico userOpHash y txHash opcional. No consulta receipts ni marca CHAIN_CONFIRMED.',
  })
  @ApiParam({ name: 'requestId', description: 'ID publico de la solicitud.' })
  @ApiBody({ type: OfficialPublicationSubmissionDto })
  @ApiResponse({
    status: 200,
    description: 'Submission registrada o repetida idempotente.',
    type: OfficialPublicationMobileSummaryResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Hash distinto o solicitud no enviable.' })
  submit(
    @Param('requestId') requestId: string,
    @Body() dto: OfficialPublicationSubmissionDto,
    @Req() req: any,
  ) {
    return this.officialPublicationApi.registerMobileSubmission(
      requestId,
      req.user,
      dto,
    );
  }
}
