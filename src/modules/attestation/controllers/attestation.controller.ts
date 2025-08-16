import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { AttestationService } from '../services/attestation.service';
import {
  CreateAttestationBulkDto,
  BulkAttestationResponseDto,
  AttestationResponseDto,
} from '../dto/attestation.dto';
import { VotingPeriodGuard } from '@/modules/elections/guards/voting-period.guard';

@ApiTags('Attestations')
@Controller('api/v1/attestations')
export class AttestationController {
  constructor(private readonly attestationService: AttestationService) {}

  @Post()
  @UseGuards(VotingPeriodGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear múltiples attestations',
    description: 'Permite crear múltiples attestations en una sola operación',
  })
  @ApiBody({ type: CreateAttestationBulkDto })
  @ApiResponse({
    status: 201,
    description: 'Attestations creadas exitosamente',
    type: BulkAttestationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos de entrada inválidos',
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado',
  })
  async createBulk(
    @Body() createAttestationBulkDto: CreateAttestationBulkDto,
  ): Promise<BulkAttestationResponseDto> {
    return this.attestationService.createBulk(createAttestationBulkDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Obtener attestations con filtros y paginación',
    description: 'Lista todas las attestations con opciones de filtrado',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Número de página',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Elementos por página',
    example: 10,
  })
  @ApiQuery({
    name: 'ballotId',
    required: false,
    description: 'Filtrar por ID de ballot',
  })
  @ApiQuery({
    name: 'isJury',
    required: false,
    description: 'true=jurado, false=usuario',
    type: Boolean,
  })
  @ApiQuery({
    name: 'support',
    required: false,
    description: 'Filtrar por apoyo (true/false)',
    type: Boolean,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de attestations obtenida exitosamente',
  })
  async findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('ballotId') ballotId?: string,
    @Query('isJury') isJury?: string,
    @Query('support') support?: string,
  ): Promise<{
    data: AttestationResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const isJuryBoolean =
      isJury === 'true' ? true : isJury === 'false' ? false : undefined;
    const supportBoolean =
      support === 'true' ? true : support === 'false' ? false : undefined;

    return this.attestationService.findAll(
      Number(page),
      Number(limit),
      ballotId,
      isJuryBoolean,
      supportBoolean,
    );
  }

  @Get('ballot/:ballotId')
  @ApiOperation({
    summary: 'Obtener attestations por ballot',
    description: 'Obtiene todas las attestations de un ballot específico',
  })
  @ApiParam({
    name: 'ballotId',
    description: 'ID del ballot',
  })
  @ApiResponse({
    status: 200,
    description: 'Attestations del ballot obtenidas exitosamente',
    type: [AttestationResponseDto],
  })
  @ApiResponse({
    status: 400,
    description: 'ID de ballot inválido',
  })
  async findByBallot(
    @Param('ballotId') ballotId: string,
  ): Promise<AttestationResponseDto[]> {
    return this.attestationService.findByBallot(ballotId);
  }

  @Get('most-supported/:tableCode')
  @ApiOperation({
    summary: 'Obtener la versión más apoyada de un acta',
    description:
      'Obtiene la versión del acta con mayor cantidad de attestations de apoyo',
  })
  @ApiParam({
    name: 'tableCode',
    description: 'Código de la mesa electoral',
  })
  @ApiResponse({
    status: 200,
    description: 'Versión más apoyada obtenida exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontraron ballots para el código de mesa',
  })
  async getMostSupportedVersion(
    @Param('tableCode') tableCode: string,
  ): Promise<{
    ballotId: string;
    version: number;
    supportCount: number;
    totalAttestations: number;
  } | null> {
    return this.attestationService.getMostSupportedVersion(tableCode);
  }

  @Get('cases')
  @ApiOperation({
    summary: 'Listar casos de atestiguamiento (mesas)',
    description:
      'Permite filtrar por estado y ubicación. VERIFYING = observada (no cuenta).',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['VERIFYING', 'CONSENSUAL', 'CLOSED'],
    description: 'Puede ser único o csv VERIFYING,CONSENSUAL,CLOSED',
  })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'province', required: false })
  @ApiQuery({ name: 'municipality', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  async listCases(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('status') status?: string,
    @Query('department') department?: string,
    @Query('province') province?: string,
    @Query('municipality') municipality?: string,
  ) {
    return this.attestationService.listCases(
      Number(page),
      Number(limit),
      status,
      department,
      province,
      municipality,
    );
  }

  @Get('cases/:tableCode')
  @ApiOperation({ summary: 'Detalle de un caso por mesa' })
  @ApiParam({ name: 'tableCode' })
  async getCaseDetail(@Param('tableCode') tableCode: string) {
    return this.attestationService.getCaseDetail(tableCode);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar una attestation',
    description: 'Elimina una attestation específica por su ID',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la attestation',
  })
  @ApiResponse({
    status: 204,
    description: 'Attestation eliminada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'ID de attestation inválido',
  })
  @ApiResponse({
    status: 404,
    description: 'Attestation no encontrada',
  })
  async remove(@Param('id') id: string): Promise<void> {
    return this.attestationService.remove(id);
  }

  @Get('by-user/:dni')
  @ApiOperation({ summary: 'Listar atestiguamientos por DNI' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'isJury', required: false, type: Boolean })
  @ApiQuery({ name: 'support', required: false, type: Boolean })
  async findByUser(
    @Param('dni') dni: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('isJury') isJury?: string,
    @Query('support') support?: string,
  ) {
    const isJuryBoolean =
      isJury === 'true' ? true : isJury === 'false' ? false : undefined;
    const supportBoolean =
      support === 'true' ? true : support === 'false' ? false : undefined;

    return this.attestationService.findByUserDni(
      dni,
      Number(page),
      Number(limit),
      isJuryBoolean,
      supportBoolean,
    );
  }
}
