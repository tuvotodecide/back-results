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
  Request,
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
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { Public } from '@/core/decorators/public.decorator';
import {
  CreateAttestationBulkDto,
  BulkAttestationResponseDto,
  AttestationResponseDto,
} from '../dto/attestation.dto';
import { VotingPeriodGuard } from '@/modules/elections/guards/voting-period.guard';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';

@ApiTags('Attestations')
@Controller('api/v1/attestations')
export class AttestationController {
  constructor(private readonly attestationService: AttestationService) {}

  @Post()
  @Public()
  @UseGuards(VotingPeriodGuard, ZkAuthGuard)
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
  @Public()
  @UseGuards(TerritorialScopeGuard)
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
  @ApiQuery({ name: 'electionId', required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de attestations obtenida exitosamente',
  })
  async findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 200,
    @Query('ballotId') ballotId?: string,
    @Query('isJury') isJury?: string,
    @Query('support') support?: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
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
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('ballot/:ballotId')
  @Public()
  @UseGuards(TerritorialScopeGuard)
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
    @Request() req?,
  ): Promise<AttestationResponseDto[]> {
    return this.attestationService.findByBallot(
      ballotId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('most-supported/:tableCode')
  @Public()
  @UseGuards(TerritorialScopeGuard)
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
  @ApiQuery({ name: 'electionId', required: false })
  async getMostSupportedVersion(
    @Param('tableCode') tableCode: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ): Promise<{
    ballotId: string;
    version: number;
    supportCount: number;
    totalAttestations: number;
  } | null> {
    return this.attestationService.getMostSupportedVersion(
      tableCode,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('cases')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({
    summary: 'Listar casos de atestiguamiento (mesas)',
    description:
      'Permite filtrar por estado y ubicación. VERIFYING = observada (no cuenta).',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['VERIFYING', 'PENDING', 'CONSENSUAL', 'CLOSED'],
    description: 'Puede ser único o csv VERIFYING,PENDING,CONSENSUAL,CLOSED',
  })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'province', required: false })
  @ApiQuery({ name: 'municipality', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'electionId', required: false })
  async listCases(
    @Query('page') page = 1,
    @Query('limit') limit = 200,
    @Query('status') status?: string,
    @Query('department') department?: string,
    @Query('province') province?: string,
    @Query('municipality') municipality?: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ) {
    return this.attestationService.listCases(
      Number(page),
      Number(limit),
      status,
      department,
      province,
      municipality,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('cases/:tableCode')
  @Public()
  @UseGuards(JwtAuthGuard, TerritorialScopeGuard)
  @ApiOperation({ summary: 'Detalle de un caso por mesa' })
  @ApiParam({ name: 'tableCode' })
  @ApiQuery({ name: 'electionId', required: false })
  async getCaseDetail(
    @Param('tableCode') tableCode: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ) {
    return this.attestationService.getCaseDetail(
      tableCode,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
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
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({ summary: 'Listar atestiguamientos por DNI' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'isJury', required: false, type: Boolean })
  @ApiQuery({ name: 'support', required: false, type: Boolean })
  @ApiQuery({ name: 'electionId', required: false })
  async findByUser(
    @Param('dni') dni: string,
    @Query('page') page = 1,
    @Query('limit') limit = 200,
    @Query('isJury') isJury?: string,
    @Query('support') support?: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
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
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('by-department/:departmentName')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({
    summary: 'ballots atestiguadas por departamento (por nombre)',
    description:
      'Lista todas las ballots que han sido atestiguadas en un departamento específico',
  })
  @ApiParam({
    name: 'departmentName',
    description: 'Nombre del departamento (ej: La Paz, Santa Cruz, Cochabamba)',
    example: 'La Paz',
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
    name: 'support',
    required: false,
    description:
      'Filtrar por apoyo: true=solo ballots con apoyos, false=solo ballots con oposición',
    type: Boolean,
  })
  @ApiQuery({
    name: 'electionId',
    required: false,
    description: 'ID de la elección',
  })
  @ApiResponse({
    status: 200,
    description:
      'Lista de ballots atestiguadas por departamento obtenida exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Parámetros inválidos',
  })
  async findAttestedBallotsByDepartment(
    @Param('departmentName') departmentName: string,
    @Query('page') page = 1,
    @Query('limit') limit = 200,
    @Query('support') support?: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const supportBoolean =
      support === 'true' ? true : support === 'false' ? false : undefined;

    return this.attestationService.findAttestedBallotsByDepartment(
      departmentName,
      Number(page),
      Number(limit),
      supportBoolean,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('by-department-id/:departmentId')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({
    summary: 'ballots atestiguadas por ID de departamento (departmentId)',
    description:
      'Lista todas las ballots que han sido atestiguadas en un departamento específico usando su ID',
  })
  @ApiParam({
    name: 'departmentId',
    description: 'ID del departamento (ObjectId de MongoDB)',
    example: '689e477f261b7d0130a036e0',
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
    name: 'support',
    required: false,
    description:
      'Filtrar por apoyo: true=solo ballots con apoyos, false=solo ballots con oposición',
    type: Boolean,
  })
  @ApiQuery({ name: 'electionId', required: false })
  @ApiResponse({
    status: 200,
    description:
      'Lista de ballots atestiguadas por departamento obtenida exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'ID de departamento inválido',
  })
  async findAttestedBallotsByDepartmentId(
    @Param('departmentId') departmentId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 200,
    @Query('support') support?: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const supportBoolean =
      support === 'true' ? true : support === 'false' ? false : undefined;

    return this.attestationService.findAttestedBallotsByDepartmentId(
      departmentId,
      Number(page),
      Number(limit),
      supportBoolean,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('by-province-id/:provinceId')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({
    summary: 'ballots atestiguadas por ID de provincia (provinceId)',
    description:
      'Lista todas las ballots que han sido atestiguadas en una provincia específica usando su ID',
  })
  @ApiParam({
    name: 'provinceId',
    description: 'ID de la provincia (ObjectId de MongoDB)',
    example: '689f468a141448f33dd9c854',
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
    name: 'support',
    required: false,
    description:
      'Filtrar por apoyo: true=solo ballots con apoyos, false=solo ballots con oposición',
    type: Boolean,
  })
  @ApiQuery({ name: 'electionId', required: false })
  @ApiResponse({
    status: 200,
    description:
      'Lista de ballots atestiguadas por provincia obtenida exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'ID de provincia inválido',
  })
  async findAttestedBallotsByProvinceId(
    @Param('provinceId') provinceId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 200,
    @Query('support') support?: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const supportBoolean =
      support === 'true' ? true : support === 'false' ? false : undefined;

    return this.attestationService.findAttestedBallotsByProvinceId(
      provinceId,
      Number(page),
      Number(limit),
      supportBoolean,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('by-municipality-id/:municipalityId')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({
    summary: 'ballots atestiguadas por ID de municipio (municipalityId)',
    description:
      'Lista todas las ballots que han sido atestiguadas en un municipio específico usando su ID',
  })
  @ApiParam({
    name: 'municipalityId',
    description: 'ID del municipio (ObjectId de MongoDB)',
    example: '689f468a141448f33dd9c855',
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
    name: 'support',
    required: false,
    description:
      'Filtrar por apoyo: true=solo ballots con apoyos, false=solo ballots con oposición',
    type: Boolean,
  })
  @ApiQuery({ name: 'electionId', required: false })
  @ApiResponse({
    status: 200,
    description:
      'Lista de ballots atestiguadas por municipio obtenida exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'ID de municipio inválido',
  })
  async findAttestedBallotsByMunicipalityId(
    @Param('municipalityId') municipalityId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 200,
    @Query('support') support?: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const supportBoolean =
      support === 'true' ? true : support === 'false' ? false : undefined;

    return this.attestationService.findAttestedBallotsByMunicipalityId(
      municipalityId,
      Number(page),
      Number(limit),
      supportBoolean,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }
}
