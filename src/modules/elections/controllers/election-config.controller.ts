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
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';
import { Public } from '@/core/decorators/public.decorator';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';

@ApiTags('Configuración Electoral')
@Controller('api/v1/elections/config')
export class ElectionConfigController {
  constructor(private readonly electionConfigService: ElectionConfigService) {}

  @Post()
  //   @UseGuards(JwtAuthGuard)
  //   @ApiBearerAuth()
  @UseGuards(AdminOnlyGuard)
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
  @Public()
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
  @Public()
  @ApiOperation({
    summary: 'Obtener todas las configuraciones electorales activas',
    description: 'Retorna todas las configuraciones electorales actualmente activas.',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuraciones activas obtenidas exitosamente',
    type: [ElectionConfigResponseDto],
  })
  getActive(): Promise<ElectionConfigResponseDto[]> {
    return this.electionConfigService.getActiveConfigs();
  }

  @Get('status')
  @Public()
  @ApiOperation({
    summary: 'Obtener estado actual de todas las elecciones activas',
    description:
      'Verifica si estamos en período de votación, período de resultados, etc. para cada elección activa.',
  })
  @ApiResponse({
    status: 200,
    description: 'Estado electoral obtenido exitosamente',
  })
  getStatus(): Promise<any> {
    return this.electionConfigService.getElectionStatus();
  }

  @Get(':id')
  @Public()
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
  findOne(
    @Param('id', new ParseObjectIdPipe()) id: string,
  ): Promise<ElectionConfigResponseDto> {
    return this.electionConfigService.findOne(id);
  }

  @Patch(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @UseGuards(AdminOnlyGuard)
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
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body() updateDto: UpdateElectionConfigDto,
  ): Promise<ElectionConfigResponseDto> {
    return this.electionConfigService.update(id, updateDto);
  }

  @Delete(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @UseGuards(AdminOnlyGuard)
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
  remove(@Param('id', new ParseObjectIdPipe()) id: string): Promise<void> {
    return this.electionConfigService.remove(id);
  }
}
