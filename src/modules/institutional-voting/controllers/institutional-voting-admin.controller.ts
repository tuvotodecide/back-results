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
  UseGuards,
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
import { MaterializePadronCertificateDto } from '../dto/materialize-padron-certificate.dto';
import { ConfirmOfficialPublicationDto } from '../dto/official-publication.dto';
import { CreateEventRoleDto } from '../dto/event-role.dto';
import {
  BulkDeletePadronStagingEntriesDto,
  CreatePadronStagingEntryDto,
  UpdatePadronStagingEntryDto,
} from '../dto/padron-staging-entry.dto';
import { AddCurrentPadronVoterDto } from '../dto/padron-current-voter.dto';
import { UpdatePublicEligibilityDto } from '../dto/public-eligibility-toggle.dto';
import { UpsertEventResultsSnapshotDto } from '../dto/results-snapshot.dto';
import { UpdateEventRoleDto } from '../dto/update-event-role.dto';
import { UpdateOptionCandidatesDto } from '../dto/update-option-candidates.dto';
import { UpdateVotingEventDto } from '../dto/update-voting-event.dto';
import { UpdateVotingOptionDto } from '../dto/update-voting-option.dto';
import { CreateVotingOptionDto } from '../dto/voting-option.dto';
import { CreatePresentialSessionDto } from '../dto/presential-session.dto';
import { TvdCapacityService } from '@/modules/tvd/services/tvd-capacity.service';
import { TvdEventCapacityQueryDto } from '@/modules/tvd/dto/tvd-capacity.dto';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import {
  CreateParticipationReportDto,
  ParticipationAnalyticsResponseDto,
} from '../dto/participation-analytics.dto';
import type { Request, Response } from 'express';

type InstitutionalVotingRequester = {
  sub?: string;
  role?: string;
  active?: boolean;
  tenantId?: string;
};

type AuthenticatedInstitutionalVotingRequest = Request & {
  user: InstitutionalVotingRequester;
};

@ApiTags('Institutional Voting Admin')
@Controller('api/v1/voting/events')
export class InstitutionalVotingAdminController {
  private shouldDeferMaterialization(value?: string | boolean) {
    return value === true || value === 'true' || value === '1';
  }

  constructor(
    private readonly institutionalVotingService: InstitutionalVotingService,
    private readonly tvdCapacity: TvdCapacityService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar eventos de votación para el usuario autenticado',
    description:
      'Retorna eventos del tenant asignado al usuario. ADMIN puede filtrar por tenantId.',
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    description: 'ID del tenant para filtrar eventos (uso principal de ADMIN).',
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

  @Get(':eventId/review-readiness')
  @ApiOperation({
    summary: 'Validar si el evento está listo para revisión',
    description:
      'Evalúa completitud estructural del evento y retorna faltantes antes de pasar a READY_FOR_REVIEW.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Resultado de validación de readiness.' })
  validateReviewReadiness(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.validateReviewReadiness(eventId, req.user);
  }

  @Get(':eventId/tvd-capacity')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Consultar capacidad TVD para publicacion oficial',
    description:
      'Calcula capacidad informativa con padrón vigente y saldo on-chain de la wallet del administrador autenticado. No publica, reserva ni consume TVD.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Capacidad TVD calculada.' })
  @ApiResponse({ status: 404, description: 'Evento o padrón vigente no disponible.' })
  getTvdCapacity(
    @Param('eventId') eventId: string,
    @Query() _query: TvdEventCapacityQueryDto,
    @Req() req: AuthenticatedInstitutionalVotingRequest,
  ) {
    return this.tvdCapacity.getEventCapacity(eventId, req.user);
  }

  @Get(':eventId/credits-usage')
  @ApiOperation({
    summary: 'Consultar uso de créditos on-chain del evento',
    description:
      'Retorna el estado de créditos/TVD de la elección en el contrato ElectoralCredits (balance, bloqueado, pendiente, quemado, consumido, reembolsado).',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Uso de créditos on-chain del evento.' })
  getEventCreditsUsage(@Param('eventId') eventId: string) {
    return this.institutionalVotingService.getEventCreditsUsage(eventId);
  }

  @Post(':eventId/ready-for-review')
  @ApiOperation({
    summary: 'Marcar evento como READY_FOR_REVIEW',
    description:
      'Valida completitud, pasa el evento a READY_FOR_REVIEW y notifica a los empadronados para revisión previa a la publicación oficial.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Evento marcado como listo para revisión.' })
  markReadyForReview(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.markReadyForReview(eventId, req.user);
  }

  @Post(':eventId/official-publication/confirm')
  @ApiOperation({
    summary: 'Confirmar publicación oficial del evento',
    description:
      'Confirma la publicación oficial luego del paso externo de MetaMask y cambia el estado a OFFICIALLY_PUBLISHED, bloqueando edición estructural.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: ConfirmOfficialPublicationDto })
  @ApiResponse({ status: 200, description: 'Publicación oficial confirmada.' })
  @ApiResponse({ status: 400, description: 'No cumple condiciones para publicación oficial.' })
  confirmOfficialPublication(
    @Param('eventId') eventId: string,
    @Body() dto: ConfirmOfficialPublicationDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.confirmOfficialPublication(eventId, dto, req.user);
  }

  @Post(':eventId/publish')
  @ApiOperation({
    summary: 'Alias legado para confirmar publicación oficial',
    description:
      'Compatibilidad temporal: reutiliza la confirmación oficial y requiere que el evento esté en READY_FOR_REVIEW.',
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
    description: 'Registra una opción de boleta para el evento. Acepta color legacy o colors[] como paleta.',
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

  @Post(':eventId/presential-sessions')
  @ApiOperation({
    summary:
      'Habilitar kiosco presencial y generar/rotar la sesión QR actual del punto presencial',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: CreatePresentialSessionDto, required: false })
  @ApiResponse({
    status: 201,
    description:
      'Retorna el estado del kiosco, la sesión QR actual y el token limitado si fue regenerado.',
  })
  createOrRotatePresentialSession(
    @Param('eventId') eventId: string,
    @Body() dto: CreatePresentialSessionDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.createOrRotatePresentialSession(
      eventId,
      dto,
      req.user,
    );
  }

  @Patch(':eventId/options/:optionId')
  @ApiOperation({
    summary: 'Actualizar opción/lista/partido',
    description: 'Permite editar nombre, color/color legacy, paleta colors[] o logo de una opción existente.',
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
    summary: 'Importar padrón CSV del evento (legacy)',
    description:
      'Flujo legacy: carga padrón CSV y lo confirma directamente como versión vigente. El flujo principal nuevo usa PDF + staging.',
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

  @Post(':eventId/padron/imports')
  @ApiOperation({
    summary: 'Subir padrón PDF o imagen y crear staging editable',
    description:
      'Carga un PDF o una imagen de tabla, lo procesa con el parser encapsulado y crea un staging editable antes de confirmar la versión vigente.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo PDF, JPG, JPEG, PNG o WEBP',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Documento procesado y staging creado.' })
  @UseInterceptors(FileInterceptor('file'))
  uploadPadronFile(
    @Param('eventId') eventId: string,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }

    return this.institutionalVotingService.uploadPadronFile(eventId, file, req.user);
  }

  @Post(':eventId/padron/gemini-import')
  @ApiOperation({
    summary: 'Analizar padrón con IA desde backend',
    description:
      'Recibe un PDF o imagen, procesa el documento con la configuración segura del backend y devuelve registros listos para staging editable.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo PDF, JPG, JPEG, PNG o WEBP',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Documento analizado correctamente.' })
  @ApiResponse({ status: 400, description: 'No se pudo procesar el documento.' })
  @UseInterceptors(FileInterceptor('file'))
  analyzePadronWithGemini(
    @Param('eventId') eventId: string,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }

    return this.institutionalVotingService.analyzePadronWithGemini(eventId, file, req.user);
  }

  @Post(':eventId/padron/imports/users')
  @ApiOperation({
    summary: 'Cargar todos los usuarios activos como padrón',
    description:
      'Crea un staging editable a partir de todos los usuarios activos del sistema, habilitados por defecto.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 201, description: 'Staging creado a partir de los usuarios activos.' })
  setAllUsersToPadron(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.setAllUsersToPadron(eventId, req.user);
  }

  @Post(':eventId/padron/imports/pdf')
  @ApiOperation({
    summary: 'Alias legacy para subir padrón desde documento',
    description:
      'Compatibilidad temporal: acepta PDF e imagen y reutiliza el mismo flujo principal de staging editable.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo PDF, JPG, JPEG, PNG o WEBP',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Documento procesado y staging creado.' })
  @UseInterceptors(FileInterceptor('file'))
  uploadPadronPdfAlias(
    @Param('eventId') eventId: string,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }

    return this.institutionalVotingService.uploadPadronFile(eventId, file, req.user);
  }

  @Get(':eventId/padron/imports/:importJobId')
  @ApiOperation({
    summary: 'Consultar estado de importación PDF',
    description:
      'Devuelve metadata del import, estado del procesamiento, resumen y errores de parseo.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'importJobId', description: 'ID del import job.' })
  getPadronImport(
    @Param('eventId') eventId: string,
    @Param('importJobId') importJobId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.getPadronImport(eventId, importJobId, req.user);
  }

  @Get(':eventId/padron/staging')
  @ApiOperation({
    summary: 'Listar staging activo del padrón',
    description:
      'Retorna el staging editable activo del padrón con paginación.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({ name: 'limit', required: false, description: 'Tamaño de página (default 50).' })
  listPadronStaging(
    @Param('eventId') eventId: string,
    @Req() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.institutionalVotingService.listPadronStaging(
      eventId,
      req.user,
      Number(page),
      Number(limit),
    );
  }

  @Post(':eventId/padron/staging')
  @ApiOperation({
    summary: 'Agregar entrada al staging del padrón',
    description: 'Agrega manualmente una entrada al staging activo del padrón.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: CreatePadronStagingEntryDto })
  addPadronStagingEntry(
    @Param('eventId') eventId: string,
    @Body() dto: CreatePadronStagingEntryDto,
    @Req() req: any,
    @Query('deferMaterialization') deferMaterialization?: string,
  ) {
    return this.institutionalVotingService.addPadronStagingEntry(eventId, dto, req.user, {
      deferMaterialization: this.shouldDeferMaterialization(deferMaterialization),
    });
  }

  @Patch(':eventId/padron/staging/:entryId')
  @ApiOperation({
    summary: 'Editar entrada del staging del padrón',
    description: 'Permite modificar CI y/o habilitación de una entrada del staging activo.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'entryId', description: 'ID de la entrada de staging.' })
  @ApiBody({ type: UpdatePadronStagingEntryDto })
  updatePadronStagingEntry(
    @Param('eventId') eventId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdatePadronStagingEntryDto,
    @Req() req: any,
    @Query('deferMaterialization') deferMaterialization?: string,
  ) {
    return this.institutionalVotingService.updatePadronStagingEntry(
      eventId,
      entryId,
      dto,
      req.user,
      {
        deferMaterialization: this.shouldDeferMaterialization(deferMaterialization),
      },
    );
  }

  @Delete(':eventId/padron/staging/:entryId')
  @ApiOperation({
    summary: 'Eliminar entrada del staging del padrón',
    description: 'Elimina una entrada del staging activo del padrón.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'entryId', description: 'ID de la entrada de staging.' })
  deletePadronStagingEntry(
    @Param('eventId') eventId: string,
    @Param('entryId') entryId: string,
    @Req() req: any,
    @Query('deferMaterialization') deferMaterialization?: string,
  ) {
    return this.institutionalVotingService.deletePadronStagingEntry(eventId, entryId, req.user, {
      deferMaterialization: this.shouldDeferMaterialization(deferMaterialization),
    });
  }

  @Post(':eventId/padron/staging/bulk-delete')
  @ApiOperation({
    summary: 'Eliminar varias entradas del staging del padrón',
    description: 'Elimina entradas seleccionadas del staging activo del padrón en una sola operación.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: BulkDeletePadronStagingEntriesDto })
  bulkDeletePadronStagingEntries(
    @Param('eventId') eventId: string,
    @Body() dto: BulkDeletePadronStagingEntriesDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.bulkDeletePadronStagingEntries(
      eventId,
      dto,
      req.user,
    );
  }

  @Post(':eventId/padron/staging/confirm')
  @ApiOperation({
    summary: 'Confirmar staging como padrón vigente',
    description:
      'Convierte el staging activo en la nueva versión vigente del padrón del evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  confirmPadronStaging(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.confirmPadronStaging(eventId, req.user);
  }

  @Get(':eventId/padron/summary')
  @ApiOperation({
    summary: 'Consultar resumen del padrón del evento',
    description:
      'Resume la versión vigente y el staging activo del padrón para el evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  getPadronSummary(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.getPadronSummary(eventId, req.user);
  }

  @Get(':eventId/padron/certificate')
  @ApiOperation({
    summary: 'Consultar metadatos de constancia PDF del padrón',
    description:
      'Retorna metadatos de la constancia asociada a una versión confirmada del padrón. Si no existe, informa si puede materializarse.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiQuery({
    name: 'padronVersionId',
    required: false,
    description: 'Versión específica del padrón. Si se omite, usa la vigente.',
  })
  getPadronCertificateMetadata(
    @Param('eventId') eventId: string,
    @Req() req: any,
    @Query('padronVersionId') padronVersionId?: string,
  ) {
    return this.institutionalVotingService.getPadronCertificateMetadata(
      eventId,
      req.user,
      padronVersionId,
    );
  }

  @Post(':eventId/padron/certificate/materialize')
  @ApiOperation({
    summary: 'Materializar o regenerar constancia PDF del padrón',
    description:
      'Genera la constancia PDF desde una versión confirmada del padrón. Se usa también para backfill legacy o regeneración controlada.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: MaterializePadronCertificateDto })
  materializePadronCertificate(
    @Param('eventId') eventId: string,
    @Body() dto: MaterializePadronCertificateDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.materializePadronCertificate(
      eventId,
      dto,
      req.user,
    );
  }

  @Get(':eventId/padron/certificate/download')
  @ApiOperation({
    summary: 'Descargar constancia PDF del padrón',
    description:
      'Descarga la constancia PDF asociada a una versión confirmada del padrón.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiQuery({
    name: 'padronVersionId',
    required: false,
    description: 'Versión específica del padrón. Si se omite, usa la vigente.',
  })
  async downloadPadronCertificate(
    @Param('eventId') eventId: string,
    @Req() req: any,
    @Res() res: Response,
    @Query('padronVersionId') padronVersionId?: string,
  ) {
    const result = await this.institutionalVotingService.downloadPadronCertificate(
      eventId,
      req.user,
      padronVersionId,
    );

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.send(result.pdfBuffer);
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

  @Post(':eventId/padron/voters')
  @ApiOperation({
    summary: 'Agregar nuevo votante habilitado durante la votación',
    description:
      'Durante la votación solo permite agregar un nuevo usuario ya habilitado al padrón vigente.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: AddCurrentPadronVoterDto })
  @ApiResponse({ status: 201, description: 'Votante agregado al padrón vigente.' })
  addCurrentPadronVoter(
    @Param('eventId') eventId: string,
    @Body() dto: AddCurrentPadronVoterDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.addCurrentPadronVoter(eventId, dto, req.user);
  }

  @Post(':eventId/padron/voters/:voterId/enable')
  @ApiOperation({
    summary: 'Habilitar votante deshabilitado durante la votación',
    description:
      'Durante la votación solo permite habilitar a un usuario que ya existe en el padrón vigente.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiParam({ name: 'voterId', description: 'ID del votante del padrón vigente.' })
  @ApiResponse({ status: 200, description: 'Votante habilitado correctamente.' })
  @HttpCode(200)
  enableCurrentPadronVoter(
    @Param('eventId') eventId: string,
    @Param('voterId') voterId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.enableCurrentPadronVoter(
      eventId,
      voterId,
      req.user,
    );
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

  @Get(':eventId/padron/download-pdf')
  @ApiOperation({
    summary: 'Descargar padrón PDF',
    description:
      'Descarga el padrón vigente del evento o una versión específica como listado PDF si se envía padronVersionId.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiQuery({
    name: 'padronVersionId',
    required: false,
    description: 'ID de una versión específica del padrón. Si se omite, descarga la vigente.',
  })
  @ApiResponse({ status: 200, description: 'Archivo PDF del padrón.' })
  async downloadPadronPdf(
    @Param('eventId') eventId: string,
    @Req() req: any,
    @Res() res: Response,
    @Query('padronVersionId') padronVersionId?: string,
  ) {
    const result = await this.institutionalVotingService.downloadPadronPdf(
      eventId,
      req.user,
      padronVersionId,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.send(result.pdfBuffer);
  }

  @Get(':eventId/participation-analytics')
  @ApiOperation({
    summary: 'Obtener analíticas de participación del evento',
    description:
      'Devuelve solo estadísticas de participación calculadas desde padrón vigente y participaciones confirmadas. No retorna votos, candidatos ni datos ZK.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({
    status: 200,
    description: 'Resumen de participación del evento.',
    type: ParticipationAnalyticsResponseDto,
  })
  getParticipationAnalytics(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.getParticipationAnalytics(eventId, req.user);
  }

  @Get(':eventId/participation-list')
  @ApiOperation({
    summary: 'Listar estado de participación del padrón vigente',
    description:
      'Devuelve los votantes habilitados del padrón vigente con estado PARTICIPATED o PENDING. Requiere acceso administrativo al tenant del evento.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({ name: 'limit', required: false, description: 'Tamaño de página (default 50, máximo 500).' })
  @ApiResponse({ status: 200, description: 'Listado paginado de participación del padrón vigente.' })
  getParticipationList(
    @Param('eventId') eventId: string,
    @Req() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.institutionalVotingService.getParticipationList(
      eventId,
      req.user,
      Number(page),
      Number(limit),
    );
  }

  @Post(':eventId/participation-report')
  @ApiOperation({
    summary: 'Descargar reporte de participación del evento',
    description:
      'Descarga un PDF con la captura real del modal de analíticas y tabla de participación. No contiene votos, candidatos, nullifiers, proofs ni recibos.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: CreateParticipationReportDto })
  @ApiResponse({ status: 200, description: 'Archivo PDF de participación.' })
  @HttpCode(200)
  async downloadParticipationReport(
    @Param('eventId') eventId: string,
    @Body() body: CreateParticipationReportDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const result = await this.institutionalVotingService.downloadParticipationReport(
      eventId,
      req.user,
      body,
    );

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.send(result.pdfBuffer);
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

  @Post(':eventId/disable')
  @ApiOperation({
    summary: 'Deshabilitar evento',
    description:
      'Deshabilita el evento para que no aparezca en la app móvil ni se pueda modificar, pero mantiene su integridad para auditoría y resultados.',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiResponse({ status: 200, description: 'Evento deshabilitado.' })
  disableEvent(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.disableEvent(eventId, req.user);
  }
}
