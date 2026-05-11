import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '@/core/decorators/public.decorator';
import { InstitutionalVotingService } from '../services/institutional-voting.service';
import { CreateParticipationDto } from '../dto/participation.dto';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';

@ApiTags('Institutional Voting Public')
@Controller('api/v1/voting/events')
export class InstitutionalVotingPublicController {
  constructor(private readonly institutionalVotingService: InstitutionalVotingService) {}

  @Get('public/landing')
  @Public()
  @ApiOperation({
    summary:
      'Landing público institucional: lista votaciones próximas, activas y con resultados',
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    description: 'Filtra por tenant/institución. Si se omite, devuelve de todos los tenants visibles.',
  })
  @ApiQuery({
    name: 'carnet',
    required: false,
    description:
      'Si se envía, devuelve solo eventos donde ese carnet está empadronado y habilitado en el padrón vigente aprobado.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Máximo por grupo (upcoming/active/results). Default 10, máximo 50.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Retorna listas agrupadas para landing público: upcoming, active y results.',
  })
  publicLanding(
    @Query('tenantId') tenantId?: string,
    @Query('carnet') carnet?: string,
    @Query('limit') limit = 10,
  ) {
    return this.institutionalVotingService.getPublicLanding(
      tenantId,
      Number(limit),
      carnet,
    );
  }

  @Get('public/detail/:eventId')
  @Public()
  @ApiOperation({
    summary:
      'Detalle público de evento: estado, ventanas y resultados (si ya son públicos)',
  })
  @ApiParam({
    name: 'eventId',
    description: 'ID del evento de votación.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Retorna detalle público del evento incluyendo fase (UPCOMING/ACTIVE/RESULTS) y resultados si están disponibles.',
  })
  publicEventDetail(@Param('eventId') eventId: string) {
    return this.institutionalVotingService.getPublicEventDetail(eventId);
  }

  @Get('public/eligibility-by-carnet')
  @Public()
  @ApiOperation({
    summary:
      'Consulta pública por carnet en eventos visibles (sin login), opcionalmente por tenant',
  })
  @ApiQuery({
    name: 'carnet',
    required: true,
    description: 'Carnet del usuario a consultar (se normaliza internamente).',
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    description: 'Filtra la consulta a una institución/tenant específica.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Retorna estado de habilitación por evento: HABILITADO, NO_HABILITADO, PADRON_EN_VALIDACION o PUBLIC_CHECK_DISABLED.',
  })
  publicEligibilityAcrossEvents(
    @Query('carnet') carnet: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.institutionalVotingService.checkPublicEligibilityAcrossEvents(
      carnet,
      tenantId,
    );
  }

  @Get(':eventId/eligibility')
  @Public()
  @ApiOperation({
    summary: 'Consulta de habilitación por carnet para un evento específico',
  })
  @ApiParam({
    name: 'eventId',
    description: 'ID del evento de votación.',
  })
  @ApiQuery({
    name: 'carnet',
    required: true,
    description: 'Carnet del usuario a consultar.',
  })
  @ApiResponse({
    status: 200,
    description: 'Retorna HABILITADO o NO_HABILITADO con referencia de versión de padrón.',
  })
  eligibility(@Param('eventId') eventId: string, @Query('carnet') carnet: string) {
    return this.institutionalVotingService.checkEligibility(eventId, carnet);
  }

  @Get(':eventId/eligibility/public')
  @Public()
  @ApiOperation({
    summary:
      'Consulta pública de habilitación por carnet para un evento específico (respeta toggle público)',
  })
  @ApiParam({
    name: 'eventId',
    description: 'ID del evento de votación.',
  })
  @ApiQuery({
    name: 'carnet',
    required: true,
    description: 'Carnet del usuario a consultar.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Retorna HABILITADO/NO_HABILITADO o PADRON_EN_VALIDACION/PUBLIC_CHECK_DISABLED según estado del evento.',
  })
  publicEligibility(@Param('eventId') eventId: string, @Query('carnet') carnet: string) {
    return this.institutionalVotingService.checkPublicEligibility(eventId, carnet);
  }

  @Post(':eventId/participations')
  @Public()
  @ApiOperation({
    summary:
      'Registra participación en un evento público. Soporta idempotencia por header idempotency-key.',
  })
  @ApiParam({
    name: 'eventId',
    description: 'ID del evento de votación.',
  })
  @ApiBody({
    description: 'Datos mínimos para registrar participación.',
    type: CreateParticipationDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Participación registrada correctamente.',
  })
  @ApiResponse({
    status: 200,
    description: 'Respuesta idempotente: ya existía participación con la misma clave.',
  })
  async createParticipation(
    @Param('eventId') eventId: string,
    @Body() dto: CreateParticipationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res() res: Response,
  ) {
    const out = await this.institutionalVotingService.createParticipation(
      eventId,
      dto,
      idempotencyKey,
    );

    return res.status(out.statusCode).json(out.body);
  }

  @Get('vote/cred-vc')
  @Public()
  @UseGuards(ZkAuthGuard)
  @ApiOperation({
    summary: 'Endpoint para recibir la VC para votar',
  })
  @ApiQuery({
    name: 'eventId',
    required: true,
    description: 'ID del evento de votación para el cual se solicita la VC.',
  })
  @ApiQuery({
    name: 'dni',
    required: true,
    description: 'DNI del usuario para el cual se solicita la VC.',
  })
  @ApiResponse({
    status: 200,
    description: 'Retorna la VC para votar.',
  })
  async getVoteVc(
    @Query('eventId') eventId: string,
    @Query('dni') dni: string,
  ) {
    return this.institutionalVotingService.getVoteVc(eventId, dni);
  }

  @Post('vote')
  @Public()
  @ApiOperation({
    summary:
      'Registra un voto en un evento público usando una prueba ZK.',
  })
  @ApiParam({
    name: 'optionId',
    description: 'ID de la opción de votación.',
  })
  @ApiBody({
    description: 'Prueba ZK enviada en el body de la petición (raw body, no JSON).',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Participación registrada correctamente.',
  })
  async uploadVote(
    @Query('optionId') optionId: string,
    @Body() body: string,
    @Res() res: Response,
  ) {
    const zkProof = body;
    const response = await this.institutionalVotingService.emitVote(
      optionId,
      zkProof,
    );

    return res.status(200).json(response);
  }

  @Get(':eventId/participations/status')
  @Public()
  @ApiOperation({
    summary: 'Consulta estado de participación por carnet en un evento',
  })
  @ApiParam({
    name: 'eventId',
    description: 'ID del evento de votación.',
  })
  @ApiQuery({
    name: 'carnet',
    required: true,
    description: 'Carnet del usuario a consultar.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Retorna status de participación (canVote/alreadyVoted/razón de bloqueo).',
  })
  participationStatus(@Param('eventId') eventId: string, @Query('carnet') carnet: string) {
    return this.institutionalVotingService.checkParticipationStatus(eventId, carnet);
  }
}
