import {
  Controller,
  Get,
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
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
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

@ApiTags('Resultados')
@Controller('api/v1/results')
@UseInterceptors(CacheInterceptor) // Aplicar caché a todos los endpoints
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get('quick-count')
  @CacheTTL(30) // Cache por 30 segundos
  @ApiOperation({
    summary: 'Obtener conteo rápido nacional',
    description:
      'Retorna el conteo rápido de votos presidenciales a nivel nacional de los 9 departamentos',
  })
  @ApiResponse({
    status: 200,
    description: 'Conteo rápido obtenido exitosamente',
    type: QuickCountResponseDto,
  })
  async getQuickCount(): Promise<QuickCountResponseDto> {
    return this.resultsService.getQuickCount();
  }

  @Get('by-location')
  @CacheTTL(60) // Cache por 60 segundos
  @ApiOperation({
    summary: 'Obtener resultados por ubicación',
    description:
      'Retorna resultados filtrados por departamento, municipio, provincia, recinto o mesa',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies'],
    required: true,
  })
  @ApiQuery({ name: 'department', required: false, example: 'La Paz' })
  @ApiQuery({ name: 'province', required: false, example: 'Murillo' })
  @ApiQuery({ name: 'municipality', required: false, example: 'La Paz' })
  @ApiQuery({ name: 'electoralSeat', required: false, example: 'Achachicala' })
  @ApiQuery({ name: 'tableNumber', required: false, example: '12345' })
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

  @Get('registration-progress')
  @CacheTTL(30) // Cache por 30 segundos
  @ApiOperation({
    summary: 'Obtener progreso de registro de actas',
    description: 'Retorna el progreso de actas registradas vs mesas esperadas',
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
  ): Promise<RegistrationProgressResponseDto> {
    return this.resultsService.getRegistrationProgress(filters);
  }

  @Get('by-circunscripcion')
  @CacheTTL(60) // Cache por 60 segundos
  @ApiOperation({
    summary: 'Obtener resultados por circunscripción',
    description:
      'Retorna resultados agrupados por circunscripciones electorales',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies'],
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

  @Get('heat-map')
  @CacheTTL(120) // Cache por 2 minutos
  @ApiOperation({
    summary: 'Obtener datos para mapa de calor',
    description:
      'Retorna datos optimizados para visualización en mapas de calor',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies'],
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
    @Query('electionType') electionType: 'presidential' | 'deputies',
    @Query('locationType')
    locationType: 'department' | 'municipality' | 'province',
    @Query('department') department?: string,
  ): Promise<HeatMapResponseDto> {
    return this.resultsService.getHeatMapData({
      electionType,
      locationType,
      department,
    });
  }

  @Get('statistics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @CacheTTL(60) // Cache por 60 segundos
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
  @CacheTTL(60) // Cache por 60 segundos
  @ApiOperation({
    summary: 'Obtener resumen por partido político',
    description:
      'Retorna un resumen detallado de resultados para un partido específico',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies'],
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen del partido obtenido exitosamente',
  })
  getPartySummary(
    @Query('electionType') electionType: 'presidential' | 'deputies',
    @Query('partyId') partyId: string,
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Exportar resultados a CSV',
    description:
      'Genera un archivo CSV con los resultados (requiere autenticación)',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies'],
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
    @Query('electionType') electionType: 'presidential' | 'deputies',
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
  @CacheTTL(300) // Cache por 5 minutos
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
}
