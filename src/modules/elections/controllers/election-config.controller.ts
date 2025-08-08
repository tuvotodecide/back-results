import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ElectionConfigService } from '../services/election-config.service';
import {
  CreateElectionConfigDto,
  UpdateElectionConfigDto,
  ElectionConfigResponseDto,
  ElectionStatusResponseDto,
} from '../dto/election-config.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';

@ApiTags('Configuración Electoral')
@Controller('api/v1/elections/config')
export class ElectionConfigController {
  constructor(private readonly electionConfigService: ElectionConfigService) {}

  @Post()
  //   @UseGuards(JwtAuthGuard)
  //   @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear configuración electoral',
    description:
      'Crea una nueva configuración de horarios electorales. Desactiva automáticamente configuraciones anteriores.',
  })
  @ApiResponse({
    status: 201,
    description: 'Configuración electoral creada exitosamente',
    type: ElectionConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o fechas incorrectas',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una configuración con ese nombre',
  })
  create(
    @Body() createDto: CreateElectionConfigDto,
  ): Promise<ElectionConfigResponseDto> {
    return this.electionConfigService.create(createDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar todas las configuraciones electorales',
    description:
      'Obtiene todas las configuraciones electorales ordenadas por fecha de creación.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de configuraciones obtenida exitosamente',
    type: [ElectionConfigResponseDto],
  })
  findAll(): Promise<ElectionConfigResponseDto[]> {
    return this.electionConfigService.findAll();
  }

  @Get('active')
  @ApiOperation({
    summary: 'Obtener configuración electoral activa',
    description: 'Retorna la configuración electoral actualmente activa.',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuración activa obtenida exitosamente',
    type: ElectionConfigResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No hay configuración activa',
  })
  getActive(): Promise<ElectionConfigResponseDto | null> {
    return this.electionConfigService.getActiveConfig();
  }

  @Get('status')
  @ApiOperation({
    summary: 'Obtener estado actual de las elecciones',
    description:
      'Verifica si estamos en período de votación, período de resultados, etc.',
  })
  @ApiResponse({
    status: 200,
    description: 'Estado electoral obtenido exitosamente',
    type: ElectionStatusResponseDto,
  })
  getStatus(): Promise<ElectionStatusResponseDto> {
    return this.electionConfigService.getElectionStatus();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener configuración electoral por ID',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la configuración electoral',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuración encontrada',
    type: ElectionConfigResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Configuración no encontrada',
  })
  findOne(@Param('id') id: string): Promise<ElectionConfigResponseDto> {
    return this.electionConfigService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar configuración electoral',
    description: 'Actualiza una configuración electoral existente.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la configuración electoral',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuración actualizada exitosamente',
    type: ElectionConfigResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Configuración no encontrada',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o fechas incorrectas',
  })
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateElectionConfigDto,
  ): Promise<ElectionConfigResponseDto> {
    return this.electionConfigService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Eliminar configuración electoral',
    description: 'Elimina una configuración electoral.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la configuración electoral',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuración eliminada exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Configuración no encontrada',
  })
  remove(@Param('id') id: string): Promise<void> {
    return this.electionConfigService.remove(id);
  }
}
