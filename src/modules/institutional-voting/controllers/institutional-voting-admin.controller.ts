import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InstitutionalVotingService } from '../services/institutional-voting.service';
import { CreateVotingEventDto } from '../dto/create-voting-event.dto';
import { CreateEventRoleDto } from '../dto/event-role.dto';
import { UpdatePublicEligibilityDto } from '../dto/public-eligibility-toggle.dto';
import { UpsertEventResultsSnapshotDto } from '../dto/results-snapshot.dto';
import { UpdateEventRoleDto } from '../dto/update-event-role.dto';
import { UpdateOptionCandidatesDto } from '../dto/update-option-candidates.dto';
import { UpdateVotingEventDto } from '../dto/update-voting-event.dto';
import { UpdateVotingOptionDto } from '../dto/update-voting-option.dto';
import { CreateVotingOptionDto } from '../dto/voting-option.dto';
import type { Response } from 'express';

@ApiTags('Institutional Voting Admin')
@Controller('api/v1/voting/events')
export class InstitutionalVotingAdminController {
  constructor(private readonly institutionalVotingService: InstitutionalVotingService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar eventos de votación para el usuario autenticado',
    description:
      'Retorna eventos del tenant asignado al usuario. SuperAdmin puede filtrar por tenantId.',
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    description: 'ID del tenant para filtrar eventos (uso principal de superadmin).',
  })
  @ApiResponse({ status: 200, description: 'Listado de eventos de votación.' })
  listEvents(@Req() req: any, @Query('tenantId') tenantId?: string) {
    return this.institutionalVotingService.listEvents(req.user, tenantId);
  }

  @Post()
  @ApiOperation({
    summary: 'Crear evento de votación (estado inicial DRAFT)',
    description:
      'Crea un evento asociado a un tenant con nombre, objetivo y fechas opcionales iniciales.',
  })
  @ApiBody({ type: CreateVotingEventDto })
  @ApiResponse({ status: 201, description: 'Evento creado correctamente en estado DRAFT.' })
  createEvent(@Body() dto: CreateVotingEventDto, @Req() req: any) {
    return this.institutionalVotingService.createEvent(dto, req.user);
  }

  @Get(':eventId')
  @ApiOperation({
    summary: 'Obtener detalle completo de un evento',
    description:
      'Retorna datos del evento, además de cargos (roles) y opciones/candidatos configurados.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Detalle del evento.' })
  getEventDetail(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.getEventDetail(eventId, req.user);
  }

  @Patch(':eventId')
  @ApiOperation({
    summary: 'Actualizar datos base del evento',
    description: 'Permite actualizar nombre y objetivo del evento (normalmente en estado DRAFT).',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: UpdateVotingEventDto })
  @ApiResponse({ status: 200, description: 'Evento actualizado correctamente.' })
  updateEvent(@Param('eventId') eventId: string, @Body() dto: UpdateVotingEventDto, @Req() req: any) {
    return this.institutionalVotingService.updateEvent(eventId, dto, req.user);
  }

  @Delete(':eventId')
  @ApiOperation({
    summary: 'Eliminar evento',
    description: 'Elimina un evento y sus recursos asociados cuando está permitido por reglas de negocio.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Evento eliminado correctamente.' })
  deleteEvent(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.deleteEvent(eventId, req.user);
  }

  @Post(':eventId/publish')
  @ApiOperation({
    summary: 'Publicar evento de votación',
    description:
      'Cambia estado a PUBLISHED si cumple precondiciones (cargos, opciones, padrón y horarios).',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Evento publicado.' })
  @ApiResponse({ status: 400, description: 'Faltan precondiciones para publicar.' })
  publishEvent(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.publishEvent(eventId, req.user);
  }

  @Post(':eventId/roles')
  @ApiOperation({
    summary: 'Crear cargo/rol del evento',
    description: 'Agrega un cargo dentro de la boleta del evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: CreateEventRoleDto })
  @ApiResponse({ status: 201, description: 'Cargo creado correctamente.' })
  createRole(@Param('eventId') eventId: string, @Body() dto: CreateEventRoleDto, @Req() req: any) {
    return this.institutionalVotingService.createRole(eventId, dto, req.user);
  }

  @Get(':eventId/roles')
  @ApiOperation({
    summary: 'Listar cargos/roles del evento',
    description: 'Retorna todos los cargos configurados para el evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Listado de cargos.' })
  listRoles(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.listRoles(eventId, req.user);
  }

  @Patch(':eventId/roles/:roleId')
  @ApiOperation({
    summary: 'Actualizar cargo/rol',
    description: 'Permite editar nombre y/o maxWinners de un cargo existente.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'roleId', description: 'ID del cargo/rol.' })
  @ApiBody({ type: UpdateEventRoleDto })
  @ApiResponse({ status: 200, description: 'Cargo actualizado correctamente.' })
  updateRole(
    @Param('eventId') eventId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateEventRoleDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.updateRole(eventId, roleId, dto, req.user);
  }

  @Delete(':eventId/roles/:roleId')
  @ApiOperation({
    summary: 'Eliminar cargo/rol',
    description: 'Elimina un cargo del evento cuando no viola reglas de integridad.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'roleId', description: 'ID del cargo/rol.' })
  @ApiResponse({ status: 200, description: 'Cargo eliminado correctamente.' })
  deleteRole(
    @Param('eventId') eventId: string,
    @Param('roleId') roleId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.deleteRole(eventId, roleId, req.user);
  }

  @Post(':eventId/options')
  @ApiOperation({
    summary: 'Crear opción/lista/partido',
    description: 'Registra una opción de boleta para el evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: CreateVotingOptionDto })
  @ApiResponse({ status: 201, description: 'Opción creada correctamente.' })
  createOption(@Param('eventId') eventId: string, @Body() dto: CreateVotingOptionDto, @Req() req: any) {
    return this.institutionalVotingService.createOption(eventId, dto, req.user);
  }

  @Get(':eventId/options')
  @ApiOperation({
    summary: 'Listar opciones del evento',
    description: 'Retorna opciones/listas configuradas con sus candidatos.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Listado de opciones.' })
  listOptions(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.listOptions(eventId, req.user);
  }

  @Patch(':eventId/options/:optionId')
  @ApiOperation({
    summary: 'Actualizar opción/lista/partido',
    description: 'Permite editar nombre, color o logo de una opción existente.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'optionId', description: 'ID de la opción.' })
  @ApiBody({ type: UpdateVotingOptionDto })
  @ApiResponse({ status: 200, description: 'Opción actualizada correctamente.' })
  updateOption(
    @Param('eventId') eventId: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateVotingOptionDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.updateOption(eventId, optionId, dto, req.user);
  }

  @Put(':eventId/options/:optionId/candidates')
  @ApiOperation({
    summary: 'Reemplazar candidatos de una opción',
    description: 'Sobrescribe la lista de candidatos asociados a una opción del evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'optionId', description: 'ID de la opción.' })
  @ApiBody({ type: UpdateOptionCandidatesDto })
  @ApiResponse({ status: 200, description: 'Candidatos actualizados correctamente.' })
  replaceOptionCandidates(
    @Param('eventId') eventId: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateOptionCandidatesDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.replaceOptionCandidates(
      eventId,
      optionId,
      dto,
      req.user,
    );
  }

  @Patch(':eventId/options/:optionId/deactivate')
  @ApiOperation({
    summary: 'Desactivar opción/lista',
    description: 'Marca la opción como inactiva sin borrarla físicamente.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'optionId', description: 'ID de la opción.' })
  @ApiResponse({ status: 200, description: 'Opción desactivada correctamente.' })
  deactivateOption(
    @Param('eventId') eventId: string,
    @Param('optionId') optionId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.deactivateOption(eventId, optionId, req.user);
  }

  @Delete(':eventId/options/:optionId')
  @ApiOperation({
    summary: 'Eliminar opción/lista',
    description: 'Elimina una opción del evento cuando las reglas lo permiten.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'optionId', description: 'ID de la opción.' })
  @ApiResponse({ status: 200, description: 'Opción eliminada correctamente.' })
  deleteOption(
    @Param('eventId') eventId: string,
    @Param('optionId') optionId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.deleteOption(eventId, optionId, req.user);
  }

  @Post(':eventId/padron/import')
  @ApiOperation({
    summary: 'Importar padrón CSV del evento',
    description:
      'Carga padrón masivo de carnets para el evento. Genera versión, hash y métricas (válidos/duplicados/inválidos).',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo CSV de padrón con columna carnet.',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Padrón importado correctamente.' })
  @UseInterceptors(FileInterceptor('file'))
  importPadron(
    @Param('eventId') eventId: string,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }

    return this.institutionalVotingService.importPadron(
      eventId,
      file.buffer.toString('utf-8'),
      req.user,
    );
  }

  @Patch(':eventId/schedule')
  @ApiOperation({
    summary: 'Configurar ventana de votación/resultados',
    description: 'Define votingStart, votingEnd y resultsPublishAt para el evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        votingStart: { type: 'string', format: 'date-time' },
        votingEnd: { type: 'string', format: 'date-time' },
        resultsPublishAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Horario actualizado correctamente.' })
  updateSchedule(
    @Param('eventId') eventId: string,
    @Body() body: { votingStart?: string; votingEnd?: string; resultsPublishAt?: string },
    @Req() req: any,
  ) {
    return this.institutionalVotingService.updateSchedule(eventId, body, req.user);
  }

  @Patch(':eventId/public-eligibility')
  @ApiOperation({
    summary: 'Activar/desactivar consulta pública de padrón',
    description: 'Controla si la consulta pública de habilitación está disponible para el evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: UpdatePublicEligibilityDto })
  @ApiResponse({ status: 200, description: 'Configuración de consulta pública actualizada.' })
  setPublicEligibility(
    @Param('eventId') eventId: string,
    @Body() body: UpdatePublicEligibilityDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.setPublicEligibility(eventId, body.enabled, req.user);
  }

  @Get(':eventId/padron/versions')
  @ApiOperation({
    summary: 'Listar versiones de padrón del evento',
    description: 'Retorna historial de versiones de padrón con métricas por versión.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Listado de versiones de padrón.' })
  listPadronVersions(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.listPadronVersions(eventId, req.user);
  }

  @Get(':eventId/padron/voters')
  @ApiOperation({
    summary: 'Listar votantes del padrón vigente',
    description: 'Devuelve votantes del padrón actual paginados.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({ name: 'limit', required: false, description: 'Tamaño de página (default 50).' })
  @ApiResponse({ status: 200, description: 'Listado paginado de votantes del padrón vigente.' })
  listCurrentPadronVoters(
    @Param('eventId') eventId: string,
    @Req() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.institutionalVotingService.listCurrentPadronVoters(
      eventId,
      req.user,
      Number(page),
      Number(limit),
    );
  }

  @Get(':eventId/padron/voters/summary')
  @ApiOperation({
    summary: 'Obtener resumen del padrón vigente',
    description: 'Devuelve un resumen del padrón actual con totales de votantes habilitados y deshabilitados.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Resumen del padrón vigente.' })
  getCurrentPadronSummary(
    @Param('eventId') eventId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.getCurrentPadronSummary(eventId, req.user);
  }

  @Get(':eventId/padron/download')
  @ApiOperation({
    summary: 'Descargar padrón CSV',
    description:
      'Descarga el padrón vigente del evento o una versión específica si se envía padronVersionId.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiQuery({
    name: 'padronVersionId',
    required: false,
    description: 'ID de una versión específica del padrón. Si se omite, descarga la vigente.',
  })
  @ApiResponse({ status: 200, description: 'Archivo CSV del padrón.' })
  async downloadPadronCsv(
    @Param('eventId') eventId: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Query('padronVersionId') padronVersionId?: string,
  ) {
    const result = await this.institutionalVotingService.downloadPadronCsv(
      eventId,
      req.user,
      padronVersionId,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return result.csvContent;
  }

  @Get(':eventId/results')
  @ApiOperation({
    summary: 'Obtener resultados del evento',
    description:
      'Retorna resultados cuando ya están disponibles según resultsPublishAt o estado del evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Resultados del evento.' })
  getResults(@Param('eventId') eventId: string) {
    return this.institutionalVotingService.getResults(eventId);
  }

  @Post(':eventId/results/snapshot')
  @ApiOperation({
    summary: 'Registrar/actualizar snapshot de resultados',
    description:
      'Guarda snapshot del conteo (fuente blockchain) para consulta posterior de resultados.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: UpsertEventResultsSnapshotDto })
  @ApiResponse({ status: 200, description: 'Snapshot de resultados actualizado.' })
  upsertResultsSnapshot(
    @Param('eventId') eventId: string,
    @Body() dto: UpsertEventResultsSnapshotDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.upsertResultsSnapshot(eventId, dto, req.user);
  }

  @Post(':eventId/comparison-report/status')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Actualizar estado de Comparison Report del padrón',
    description:
      'Cambia estado de validación del padrón vigente (PENDING, OK o FAILED). Solo administrador global.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PENDING', 'OK', 'FAILED'] },
        padronVersionId: {
          type: 'string',
          description: 'Versión específica del padrón a aprobar/rechazar. Si se omite, usa la vigente.',
        },
      },
      required: ['status'],
    },
  })
  @ApiResponse({ status: 200, description: 'Estado del comparison report actualizado.' })
  updateComparisonStatus(
    @Param('eventId') eventId: string,
    @Body() body: { status: 'PENDING' | 'OK' | 'FAILED'; padronVersionId?: string },
    @Req() req: any,
  ) {
    return this.institutionalVotingService.updateComparisonReportStatus(
      eventId,
      body.status,
      req.user,
      body.padronVersionId,
    );
  }
}
