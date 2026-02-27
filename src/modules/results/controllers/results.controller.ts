/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CacheTTL } from '@nestjs/cache-manager';
import { ResultsService } from '../services/results.service';
import {
  QuickCountResponseDto,
  LocationResultsResponseDto,
  RegistrationProgressResponseDto,
  CircunscripcionResponseDto,
  HeatMapResponseDto,
  SystemStatisticsResponseDto,
  ElectionTypeFilterDto,
  LocationFilterDto,
  CircunscripcionFilterDto,
} from '../dto/results.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '@/modules/elections/guards/preliminary-results.guard';
import { Public } from '@/core/decorators/public.decorator';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';
import { CanonicalCacheInterceptor } from '@/core/interceptors/canonical-cache.interceptor';

@ApiTags('Resultados')
@Controller('api/v1/results')
@UseInterceptors(CanonicalCacheInterceptor) // Aplicar caché a todos los endpoints
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @ApiQuery({ name: 'electionId', required: false })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: false,
    description:
      'Tipo de resultado. Si hay múltiples elecciones activas, este parámetro filtra por el tipo correcto.',
  })
  @Get('quick-count')
  @Public()
  @UseGuards(ResultsPeriodGuard)
  @CacheTTL(30_000)
  @ApiOperation({
    summary: 'Obtener conteo rápido',
    description:
      'Retorna el conteo rápido de votos. Use electionType para filtrar por tipo de elección cuando hay varias activas.',
  })
  @ApiResponse({
    status: 200,
    description: 'Conteo rápido obtenido exitosamente',
    type: QuickCountResponseDto,
  })
  async getQuickCount(
    @Query('electionId') electionId?: string,
    @Query('electionType') electionType?: string,
  ): Promise<QuickCountResponseDto> {
    return this.resultsService.getQuickCount(electionId, 'final', electionType);
  }

  @ApiQuery({ name: 'electionId', required: false })
  @Get('by-location')
  @Public()
  @UseGuards(ResultsPeriodGuard, TerritorialScopeGuard)
  @CacheTTL(60_000) // Cache por 60 segundos
  @ApiOperation({
    summary: 'Obtener resultados por ubicación',
    description:
      'Retorna resultados filtrados por departamento, municipio, provincia, recinto o mesa',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
    description:
      'Tipo de resultado: presidential (presidente), deputies (diputados), ' +
      'departamental (gobernadores), assembly (asambleístas), municipal (alcaldes), council (concejales)',
  })
  @ApiQuery({ name: 'department', required: false, example: 'La Paz' })
  @ApiQuery({ name: 'province', required: false, example: 'Murillo' })
  @ApiQuery({ name: 'municipality', required: false, example: 'La Paz' })
  @ApiQuery({ name: 'electoralSeat', required: false, example: 'Achachicala' })
  @ApiQuery({
    name: 'electoralLocation',
    required: false,
    example: 'U.E Achachicala',
  })
  @ApiQuery({ name: 'tableCode', required: false, example: '12345' })
  @ApiResponse({
    status: 200,
    description: 'Resultados por ubicación obtenidos exitosamente',
    type: LocationResultsResponseDto,
  })
  async getResultsByLocation(
    @Query() filters: ElectionTypeFilterDto,
  ): Promise<LocationResultsResponseDto> {
    return this.resultsService.getResultsByLocation(filters);
  }

  @ApiQuery({ name: 'electionId', required: false })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'departamental', 'municipal'],
    required: false,
    description:
      'Tipo de elección para filtrar el progreso cuando hay varias elecciones activas.',
  })
  @Get('registration-progress')
  @UseGuards(TerritorialScopeGuard)
  @Public()
  @CacheTTL(30_000)
  @ApiOperation({
    summary: 'Obtener progreso de registro de actas',
    description:
      'Retorna el progreso de actas registradas vs mesas esperadas. Use electionType para filtrar por tipo.',
  })
  @ApiQuery({ name: 'department', required: false, example: 'La Paz' })
  @ApiQuery({ name: 'province', required: false, example: 'Murillo' })
  @ApiQuery({ name: 'municipality', required: false, example: 'La Paz' })
  @ApiResponse({
    status: 200,
    description: 'Progreso de registro obtenido exitosamente',
    type: RegistrationProgressResponseDto,
  })
  async getRegistrationProgress(
    @Query() filters?: LocationFilterDto,
    @Query('electionType') electionType?: string,
  ): Promise<RegistrationProgressResponseDto> {
    return this.resultsService.getRegistrationProgress(filters, electionType);
  }

  @ApiQuery({ name: 'electionId', required: false })
  @Get('by-circunscripcion')
  @Public()
  
  @UseGuards(ResultsPeriodGuard, TerritorialScopeGuard)
  @CacheTTL(60_000) // Cache por 60 segundos
  @ApiOperation({
    summary: 'Obtener resultados por circunscripción',
    description:
      'Retorna resultados agrupados por circunscripciones electorales',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
  })
  @ApiQuery({
    name: 'circunscripcionType',
    enum: ['Uninominal', 'Especial'],
    required: false,
  })
  @ApiQuery({
    name: 'circunscripcionNumber',
    type: 'number',
    required: false,
    example: 24,
  })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'province', required: false })
  @ApiQuery({ name: 'municipality', required: false })
  @ApiResponse({
    status: 200,
    description: 'Resultados por circunscripción obtenidos exitosamente',
    type: CircunscripcionResponseDto,
  })
  async getResultsByCircunscripcion(
    @Query() filters: CircunscripcionFilterDto,
  ): Promise<CircunscripcionResponseDto> {
    return this.resultsService.getResultsByCircunscripcion(filters);
  }

  @ApiQuery({ name: 'electionId', required: false })
  @Get('heat-map')
  @Public()
  @UseGuards(ResultsPeriodGuard, TerritorialScopeGuard)
  @CacheTTL(120_000) // Cache por 2 minutos
  @ApiOperation({
    summary: 'Obtener datos para mapa de calor',
    description:
      'Retorna datos optimizados para visualización en mapas de calor',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
    description: 'Tipo de elección',
  })
  @ApiQuery({
    name: 'locationType',
    enum: ['department', 'municipality', 'province'],
    required: true,
    description: 'Nivel de agrupación geográfica',
  })
  @ApiQuery({
    name: 'department',
    required: false,
    description: 'Filtrar municipios de un departamento específico',
  })
  @ApiResponse({
    status: 200,
    description: 'Datos de mapa de calor obtenidos exitosamente',
    type: HeatMapResponseDto,
  })
  async getHeatMapData(
    @Query('electionType') electionType: string,
    @Query('locationType')
    locationType: 'department' | 'municipality' | 'province',
    @Query('department') department?: string,
    @Query('electionId') electionId?: string,
  ): Promise<HeatMapResponseDto> {
    return this.resultsService.getHeatMapData({
      electionType,
      locationType,
      department,
      electionId,
    });
  }

  @Get('statistics')
  @Public()
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @CacheTTL(60_000) // Cache por 60 segundos
  @ApiOperation({
    summary: 'Obtener estadísticas del sistema',
    description:
      'Retorna estadísticas generales del sistema (requiere autenticación)',
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas del sistema obtenidas exitosamente',
    type: SystemStatisticsResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado',
  })
  async getSystemStatistics(): Promise<SystemStatisticsResponseDto> {
    return this.resultsService.getSystemStatistics();
  }

  @Get('summary/:partyId')
  @Public()
  @CacheTTL(60_000) // Cache por 60 segundos
  @ApiOperation({
    summary: 'Obtener resumen por partido político',
    description:
      'Retorna un resumen detallado de resultados para un partido específico',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen del partido obtenido exitosamente',
  })
  getPartySummary(
    @Param('partyId') partyId: string,
    @Query('electionType') electionType: string,
  ) {
    // Este método podría agregarse al servicio para obtener detalles específicos de un partido
    return {
      partyId,
      electionType,
      nationalTotal: 150000,
      percentage: '45.50',
      departmentBreakdown: [
        { department: 'La Paz', votes: 50000, percentage: '48.2' },
        { department: 'Santa Cruz', votes: 45000, percentage: '42.1' },
        // ... más departamentos
      ],
      strongholds: ['La Paz', 'Oruro', 'Potosí'],
      weakAreas: ['Santa Cruz', 'Beni'],
      lastUpdate: new Date(),
    };
  }

  @Get('export/csv')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({
    summary: 'Exportar resultados a CSV',
    description:
      'Genera un archivo CSV con los resultados (requiere autenticación)',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
  })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({
    name: 'format',
    enum: ['summary', 'detailed'],
    required: false,
    default: 'summary',
  })
  @ApiResponse({
    status: 200,
    description: 'Archivo CSV generado exitosamente',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  exportResultsCSV(
    @Query('electionType') electionType: string,
    @Query('department') department?: string,
    @Query('format') format: 'summary' | 'detailed' = 'summary',
  ) {
    // Este método generaría un CSV con los resultados
    // Por ahora retornamos un placeholder
    return {
      message: 'Export functionality to be implemented',
      params: { electionType, department, format },
    };
  }

  @Get('trends')
  @CacheTTL(300_000) // Cache por 5 minutos
  @ApiOperation({
    summary: 'Obtener tendencias temporales',
    description: 'Retorna la evolución de los resultados en el tiempo',
  })
  @ApiQuery({
    name: 'hours',
    type: 'number',
    required: false,
    default: 24,
    description: 'Últimas N horas',
  })
  @ApiQuery({
    name: 'interval',
    enum: ['hour', '30min', '15min'],
    required: false,
    default: 'hour',
  })
  @ApiResponse({
    status: 200,
    description: 'Tendencias obtenidas exitosamente',
  })
  getResultsTrends(
    @Query('hours') hours: number = 24,
    @Query('interval') interval: 'hour' | '30min' | '15min' = 'hour',
  ) {
    // Este método analizaría las tendencias temporales
    return {
      timeRange: {
        from: new Date(Date.now() - hours * 60 * 60 * 1000),
        to: new Date(),
        interval,
      },
      trends: [
        {
          timestamp: '2025-01-24T10:00:00Z',
          tablesProcessed: 1000,
          leadingParty: 'MAS-IPSP',
          leadingPercentage: '42.5',
        },
        {
          timestamp: '2025-01-24T11:00:00Z',
          tablesProcessed: 2500,
          leadingParty: 'MAS-IPSP',
          leadingPercentage: '43.2',
        },
        // ... más puntos de datos
      ],
      lastUpdate: new Date(),
    };
  }

  @Get('live/quick-count')
  @Public()
  @UseGuards(PreliminaryResultsGuard)
  @CacheTTL(15_000)
  @ApiQuery({ name: 'electionId', required: false })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: false,
  })
  async getLiveQuickCount(
    @Query('electionId') electionId?: string,
    @Query('electionType') electionType?: string,
  ) {
    return this.resultsService.getQuickCount(electionId, 'live', electionType);
  }

  @Get('live/by-location')
  @Public()
  @UseGuards(PreliminaryResultsGuard, TerritorialScopeGuard)
  @CacheTTL(30_000)
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
  })
  async getLiveByLocation(@Query() filters: ElectionTypeFilterDto) {
    return this.resultsService.getResultsByLocation({
      ...filters,
      mode: 'live',
    } as any);
  }

  @Get('live/heat-map')
  @Public()
  @UseGuards(PreliminaryResultsGuard)
  @CacheTTL(60_000)
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
  })
  @ApiQuery({
    name: 'locationType',
    enum: ['department', 'municipality', 'province'],
    required: true,
  })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'electionId', required: false })
  async getLiveHeatMap(
    @Query('electionType') electionType: string,
    @Query('locationType')
    locationType: 'department' | 'municipality' | 'province',
    @Query('department') department?: string,
    @Query('electionId') electionId?: string,
  ) {
    return this.resultsService.getHeatMapData({
      electionType,
      locationType,
      department,
      electionId,
      mode: 'live',
    });
  }

  @Get('live/by-circunscripcion')
  @Public()
  @UseGuards(PreliminaryResultsGuard)
  @CacheTTL(60_000)
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
  })
  @ApiQuery({
    name: 'circunscripcionType',
    enum: ['Uninominal', 'Especial'],
    required: false,
  })
  @ApiQuery({ name: 'circunscripcionNumber', type: 'number', required: false })
  async getLiveByCircunscripcion(@Query() filters: CircunscripcionFilterDto) {
    return this.resultsService.getResultsByCircunscripcion({
      ...filters,
      mode: 'live',
    } as any);
  }

  @Get('live/ballots')
  @Public()
  @UseGuards(PreliminaryResultsGuard, TerritorialScopeGuard)
  @CacheTTL(30_000)
  @ApiOperation({
    summary: 'Obtener ballots que cuentan en resultados live',
    description:
      'Retorna los ballots que realmente se cuentan en los resultados preliminares. ' +
      'Usa el mismo pipeline que by-location para garantizar consistencia.',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
  })
  @ApiQuery({ name: 'electionId', required: false })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'province', required: false })
  @ApiQuery({ name: 'municipality', required: false })
  @ApiQuery({ name: 'page', type: 'number', required: false, default: 1 })
  @ApiQuery({ name: 'limit', type: 'number', required: false, default: 20 })
  @ApiResponse({
    status: 200,
    description: 'Ballots que cuentan en resultados obtenidos exitosamente',
  })
  async getLiveCountedBallots(
    @Query() filters: ElectionTypeFilterDto,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.resultsService.getCountedBallots({
      ...filters,
      mode: 'live',
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    } as any);
  }

  @Get('final/ballots')
  @Public()
  @UseGuards(ResultsPeriodGuard, TerritorialScopeGuard)
  @CacheTTL(60_000)
  @ApiOperation({
    summary: 'Obtener ballots que cuentan en resultados finales',
    description:
      'Retorna los ballots que realmente se cuentan en los resultados finales. ' +
      'Solo incluye ballots con casos resueltos (CONSENSUAL/CLOSED).',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council'],
    required: true,
  })
  @ApiQuery({ name: 'electionId', required: false })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'province', required: false })
  @ApiQuery({ name: 'municipality', required: false })
  @ApiQuery({ name: 'page', type: 'number', required: false, default: 1 })
  @ApiQuery({ name: 'limit', type: 'number', required: false, default: 20 })
  @ApiResponse({
    status: 200,
    description: 'Ballots que cuentan en resultados finales obtenidos exitosamente',
  })
  async getFinalCountedBallots(
    @Query() filters: ElectionTypeFilterDto,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.resultsService.getCountedBallots({
      ...filters,
      mode: 'final',
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    } as any);
  }
}
