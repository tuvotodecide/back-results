/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { BallotService } from '../services/ballot.service';
import {
  CreateBallotFromIpfsDto,
  BallotQueryDto,
  BallotStatsDto,
  NearbyLocationResponseDto,
  LocationByCoordinatesDto,
} from '../dto/ballot.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { VotingPeriodGuard } from '@/modules/elections/guards/voting-period.guard';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';
import { Public } from '@/core/decorators/public.decorator';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';

@ApiTags('Actas')
@Controller('api/v1/ballots')
export class BallotController {
  constructor(private readonly ballotService: BallotService) {}

  @Post('from-ipfs')
  @Public()
  @UseGuards(VotingPeriodGuard, ZkAuthGuard)
  @ApiOperation({
    summary: 'Crear acta desde IPFS',
    description:
      'Recibe una URI de IPFS, extrae los datos y crea el acta electoral',
  })
  @ApiResponse({
    status: 201,
    description: 'Acta creada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o error de validación',
  })
  @ApiResponse({
    status: 409,
    description: 'El acta ya existe para esta mesa',
  })
  createFromIpfs(@Body() createDto: CreateBallotFromIpfsDto) {
    return this.ballotService.createFromIpfs(createDto);
  }

  @Post('validate-ballot-data')
  @Public()
  @UseGuards(VotingPeriodGuard, ZkAuthGuard)
  @ApiOperation({
    summary: 'Validar datos de acta desde IPFS',
    description: 'Recibe una URI de IPFS y valida que los datos sean correctos',
  })
  @ApiResponse({
    status: 201,
    description: 'Datos válidos',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o error de validación',
  })
  validateBallotData(@Body() createDto: CreateBallotFromIpfsDto) {
    return this.ballotService.previousValidate(createDto);
  }

  @Get()
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({ summary: 'Listar actas electorales' })
  @ApiResponse({
    status: 200,
    description: 'Lista de actas obtenida exitosamente',
  })
  findAll(@Query() query: BallotQueryDto, @Request() req) {
    return this.ballotService.findAll(
      query,
      req.userDepartmentId,
      req.userMunicipalityId,
      req.userRole,
    );
  }

  @Get('stats')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({
    summary: 'Obtener estadísticas de actas',
    description:
      'Retorna el progreso de registro de actas y estadísticas generales',
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
    type: BallotStatsDto,
  })
  @ApiQuery({ name: 'electionId', required: false })
  getStats(@Query('electionId') electionId?: string, @Request() req?) {
    return this.ballotService.getStats(
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('versions/:tableCode')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({ summary: 'Obtener versiones de actas' })
  @ApiParam({
    name: 'tableCode',
    description: 'Código de mesa',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de versiones obtenida exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontraron versiones',
  })
  getBallotVersions(
    @Param('tableCode') tableCode: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ) {
    return this.ballotService.findVersionsByTableCode(
      tableCode,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get(':id')
  @Public()
  @UseGuards(JwtAuthGuard, TerritorialScopeGuard)
  @ApiOperation({ summary: 'Obtener un acta por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID del acta',
  })
  @ApiResponse({
    status: 200,
    description: 'Acta encontrada',
  })
  @ApiResponse({
    status: 404,
    description: 'Acta no encontrada',
  })
  findOne(@Param('id', new ParseObjectIdPipe()) id: string, @Request() req) {
    return this.ballotService.findOne(
      id,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Get('by-table/:tableCode')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({ summary: 'Obtener acta por código de mesa' })
  @ApiParam({
    name: 'tableCode',
    description: 'Código único de la mesa',
  })
  @ApiResponse({
    status: 200,
    description: 'Acta encontrada',
  })
  @ApiResponse({
    status: 404,
    description: 'Acta no encontrada',
  })
  findByTableCode(
    @Param('tableCode') tableCode: string,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ) {
    return this.ballotService.findByTableCode(
      tableCode,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }

  @Post('by-location')
  @Public()
  @UseGuards(TerritorialScopeGuard)
  @ApiOperation({
    summary: 'Obtener actas del recinto más cercano',
    description:
      'Busca el recinto electoral más cercano a las coordenadas proporcionadas y retorna todas las actas de ese recinto',
  })
  @ApiQuery({ name: 'electionId', required: false })
  @ApiBody({ type: LocationByCoordinatesDto })
  @ApiResponse({
    status: 200,
    description: 'Actas del recinto más cercano obtenidas exitosamente',
    type: NearbyLocationResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontró ningún recinto electoral cercano',
  })
  findByNearestLocation(
    @Body() locationDto: LocationByCoordinatesDto,
    @Query('electionId') electionId?: string,
    @Request() req?,
  ) {
    return this.ballotService.findByNearestLocation(
      locationDto.latitude,
      locationDto.longitude,
      locationDto.maxDistance,
      electionId,
      req?.userDepartmentId,
      req?.userMunicipalityId,
      req?.userRole,
    );
  }
}
