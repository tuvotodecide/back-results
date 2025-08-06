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
import { ElectoralSeatService } from '../services/electoral-seat.service';
import {
  CreateElectoralSeatDto,
  UpdateElectoralSeatDto,
} from '../dto/electoral-seat.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';

@ApiTags('Geografía')
@Controller('api/v1/geographic/electoral-seats')
export class ElectoralSeatController {
  constructor(private readonly electoralSeatService: ElectoralSeatService) {}

  @Post()
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un nuevo asiento electoral' })
  @ApiResponse({
    status: 201,
    description: 'Asiento electoral creado exitosamente',
  })
  @ApiResponse({
    status: 409,
    description: 'El ID de localización ya existe en este municipio',
  })
  create(@Body() createElectoralSeatDto: CreateElectoralSeatDto) {
    return this.electoralSeatService.create(createElectoralSeatDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos los asientos electorales' })
  @ApiQuery({
    name: 'municipalityId',
    required: false,
    description: 'Filtrar por municipio',
  })
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
    description: 'Lista de asientos electorales obtenida exitosamente',
  })
  findAll(
    @Query()
    query: GeographicQueryDto & {
      municipalityId?: string;
      provinceId?: string;
      departmentId?: string;
    },
  ) {
    return this.electoralSeatService.findAll(query);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Obtener estadísticas de asientos electorales' })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
  })
  getStatistics() {
    return this.electoralSeatService.getStatistics();
  }

  @Get('by-municipality/:municipalityId')
  @ApiOperation({ summary: 'Obtener asientos electorales por municipio' })
  @ApiResponse({ status: 200, description: 'Asientos electorales encontrados' })
  @ApiResponse({ status: 404, description: 'Municipio no encontrado' })
  findByMunicipality(@Param('municipalityId') municipalityId: string) {
    return this.electoralSeatService.findByMunicipality(municipalityId);
  }

  @Get('by-province/:provinceId')
  @ApiOperation({ summary: 'Obtener asientos electorales por provincia' })
  @ApiResponse({ status: 200, description: 'Asientos electorales encontrados' })
  @ApiResponse({ status: 404, description: 'Provincia no encontrada' })
  findByProvince(@Param('provinceId') provinceId: string) {
    return this.electoralSeatService.findByProvince(provinceId);
  }

  @Get('by-department/:departmentId')
  @ApiOperation({ summary: 'Obtener asientos electorales por departamento' })
  @ApiResponse({ status: 200, description: 'Asientos electorales encontrados' })
  @ApiResponse({ status: 404, description: 'Departamento no encontrado' })
  findByDepartment(@Param('departmentId') departmentId: string) {
    return this.electoralSeatService.findByDepartment(departmentId);
  }

  @Get('id-loc/:idLoc')
  @ApiOperation({
    summary: 'Obtener un asiento electoral por ID de localización',
  })
  @ApiResponse({ status: 200, description: 'Asiento electoral encontrado' })
  @ApiResponse({ status: 404, description: 'Asiento electoral no encontrado' })
  findByIdLoc(@Param('idLoc') idLoc: string) {
    return this.electoralSeatService.findByIdLoc(idLoc);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un asiento electoral por ID' })
  @ApiResponse({ status: 200, description: 'Asiento electoral encontrado' })
  @ApiResponse({ status: 404, description: 'Asiento electoral no encontrado' })
  findOne(@Param('id') id: string) {
    return this.electoralSeatService.findOne(id);
  }

  @Patch(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar un asiento electoral' })
  @ApiResponse({
    status: 200,
    description: 'Asiento electoral actualizado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Asiento electoral no encontrado' })
  update(
    @Param('id') id: string,
    @Body() updateElectoralSeatDto: UpdateElectoralSeatDto,
  ) {
    return this.electoralSeatService.update(id, updateElectoralSeatDto);
  }

  @Delete(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar un asiento electoral' })
  @ApiResponse({
    status: 200,
    description: 'Asiento electoral eliminado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Asiento electoral no encontrado' })
  remove(@Param('id') id: string) {
    return this.electoralSeatService.remove(id);
  }

  @Patch(':id/activate')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Activar un asiento electoral' })
  activate(@Param('id') id: string) {
    return this.electoralSeatService.activate(id);
  }

  @Patch(':id/deactivate')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar un asiento electoral' })
  deactivate(@Param('id') id: string) {
    return this.electoralSeatService.deactivate(id);
  }
}
