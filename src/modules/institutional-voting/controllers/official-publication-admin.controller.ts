import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import {
  OfficialPublicationAdminResponseDto,
  OfficialPublicationCancelDto,
} from '../dto/official-publication-request.dto';
import { OfficialPublicationApiService } from '../services/publication/official-publication-api.service';

@ApiTags('Official Publication Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/voting')
export class OfficialPublicationAdminController {
  constructor(
    private readonly officialPublicationApi: OfficialPublicationApiService,
  ) {}

  @Post('events/:eventId/official-publication/requests')
  @ApiOperation({
    summary: 'Crear o recuperar solicitud persistente de publicacion oficial',
    description:
      'Prepara snapshot, calldata y preflight sin ejecutar blockchain ni esperar firma movil.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento institucional.' })
  @ApiResponse({
    status: 201,
    description: 'Solicitud creada o reutilizada.',
    type: OfficialPublicationAdminResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Administrador sin acceso institucional.' })
  @ApiResponse({ status: 422, description: 'Preflight o reglas funcionales fallidas.' })
  createOrGetRequest(@Param('eventId') eventId: string, @Req() req: any) {
    return this.officialPublicationApi.createAdminRequest(eventId, req.user);
  }

  @Get('events/:eventId/official-publication/requests/active')
  @ApiOperation({
    summary: 'Consultar solicitud activa de publicacion oficial por evento',
    description:
      'Devuelve la solicitud activa segura para el administrador autorizado o request:null si no existe.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento institucional.' })
  @ApiResponse({
    status: 200,
    description: 'Solicitud activa o null.',
    type: OfficialPublicationAdminResponseDto,
  })
  getActiveRequest(@Param('eventId') eventId: string, @Req() req: any) {
    return this.officialPublicationApi.getActiveAdminRequest(eventId, req.user);
  }

  @Get('official-publication/requests/:requestId')
  @ApiOperation({
    summary: 'Consultar solicitud de publicacion oficial por requestId',
    description:
      'Solo administradores autorizados para la institucion de la eleccion pueden consultar el resumen.',
  })
  @ApiParam({ name: 'requestId', description: 'ID publico de la solicitud.' })
  @ApiResponse({
    status: 200,
    description: 'Resumen administrativo seguro de la solicitud.',
    type: OfficialPublicationAdminResponseDto,
  })
  getRequest(@Param('requestId') requestId: string, @Req() req: any) {
    return this.officialPublicationApi.getAdminRequest(requestId, req.user);
  }

  @Post('official-publication/requests/:requestId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancelar una solicitud de publicacion oficial antes del envio',
    description:
      'La cancelacion es idempotente y se bloquea cuando ya existe userOpHash o evidencia posterior al envio.',
  })
  @ApiParam({ name: 'requestId', description: 'ID publico de la solicitud.' })
  @ApiBody({ type: OfficialPublicationCancelDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Solicitud cancelada o cancelacion repetida idempotente.',
    type: OfficialPublicationAdminResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Solicitud ya enviada o no cancelable.' })
  cancelRequest(
    @Param('requestId') requestId: string,
    @Body() dto: OfficialPublicationCancelDto,
    @Req() req: any,
  ) {
    return this.officialPublicationApi.cancelAdminRequest(
      requestId,
      req.user,
      dto,
    );
  }
}
