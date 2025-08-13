/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { MunicipalityService } from '../services/municipality.service';
import {
  CreateMunicipalityDto,
  UpdateMunicipalityDto,
} from '../dto/municipality.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

@ApiTags('Geografía')
@Controller('api/v1/geographic/municipalities')
export class MunicipalityController {
  constructor(private readonly municipalityService: MunicipalityService) {}

  @Post()
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un nuevo municipio' })
  @ApiResponse({ status: 201, description: 'Municipio creado exitosamente' })
  @ApiResponse({
    status: 409,
    description: 'El municipio ya existe en esta provincia',
  })
  create(@Body() createMunicipalityDto: CreateMunicipalityDto) {
    return this.municipalityService.create(createMunicipalityDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos los municipios' })
  @ApiQuery({
    name: 'provinceId',
    required: false,
    description: 'Filtrar por provincia',
  })
  @ApiQuery({
    name: 'departmentId',
    required: false,
    description: 'Filtrar por departamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de municipios obtenida exitosamente',
  })
  findAll(
    @Query()
    query: GeographicQueryDto & { provinceId?: string; departmentId?: string },
  ) {
    return this.municipalityService.findAll(query);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Obtener estadísticas de municipios' })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
  })
  getStatistics() {
    return this.municipalityService.getStatistics();
  }

  @Get('by-province/:provinceId')
  @ApiOperation({ summary: 'Obtener municipios por provincia' })
  @ApiResponse({ status: 200, description: 'Municipios encontrados' })
  @ApiResponse({ status: 404, description: 'Provincia no encontrada' })
  findByProvince(@Param('provinceId') provinceId: string) {
    return this.municipalityService.findByProvince(provinceId);
  }

  @Get('by-department/:departmentId')
  @ApiOperation({ summary: 'Obtener municipios por departamento' })
  @ApiResponse({ status: 200, description: 'Municipios encontrados' })
  @ApiResponse({ status: 404, description: 'Departamento no encontrado' })
  findByDepartment(@Param('departmentId') departmentId: string) {
    return this.municipalityService.findByDepartment(departmentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un municipio por ID' })
  @ApiResponse({ status: 200, description: 'Municipio encontrado' })
  @ApiResponse({ status: 404, description: 'Municipio no encontrado' })
  findOne(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.municipalityService.findOne(id);
  }

  @Patch(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar un municipio' })
  @ApiResponse({
    status: 200,
    description: 'Municipio actualizado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Municipio no encontrado' })
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body() updateMunicipalityDto: UpdateMunicipalityDto,
  ) {
    return this.municipalityService.update(id, updateMunicipalityDto);
  }

  @Delete(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar un municipio' })
  @ApiResponse({ status: 200, description: 'Municipio eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Municipio no encontrado' })
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.municipalityService.remove(id);
  }

  @Patch(':id/activate')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Activar un municipio' })
  activate(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.municipalityService.activate(id);
  }

  @Patch(':id/deactivate')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar un municipio' })
  deactivate(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.municipalityService.deactivate(id);
  }
}
