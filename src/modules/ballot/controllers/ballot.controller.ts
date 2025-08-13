/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
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

@ApiTags('Actas')
@Controller('api/v1/ballots')
export class BallotController {
  constructor(private readonly ballotService: BallotService) {}

  @Post('from-ipfs')
  @UseGuards(VotingPeriodGuard)
  //   @UseGuards(JwtAuthGuard)
  //   @ApiBearerAuth()
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

  @Get()
  @ApiOperation({ summary: 'Listar actas electorales' })
  @ApiResponse({
    status: 200,
    description: 'Lista de actas obtenida exitosamente',
  })
  findAll(@Query() query: BallotQueryDto) {
    return this.ballotService.findAll(query);
  }

  @Get('stats')
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
  getStats() {
    return this.ballotService.getStats();
  }

  @Get(':id')
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
  findOne(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.ballotService.findOne(id);
  }

  @Get('by-table/:tableCode')
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
  findByTableCode(@Param('tableCode') tableCode: string) {
    return this.ballotService.findByTableCode(tableCode);
  }

  @Post('by-location')
  @ApiOperation({
    summary: 'Obtener actas del recinto más cercano',
    description:
      'Busca el recinto electoral más cercano a las coordenadas proporcionadas y retorna todas las actas de ese recinto',
  })
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
  findByNearestLocation(@Body() locationDto: LocationByCoordinatesDto) {
    return this.ballotService.findByNearestLocation(
      locationDto.latitude,
      locationDto.longitude,
      locationDto.maxDistance,
    );
  }
}
