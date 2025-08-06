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
import { ProvinceService } from '../services/province.service';
import { CreateProvinceDto, UpdateProvinceDto } from '../dto/province.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';

@ApiTags('Geografía')
@Controller('api/v1/geographic/provinces')
export class ProvinceController {
  constructor(private readonly provinceService: ProvinceService) {}

  @Post()
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear una nueva provincia' })
  @ApiResponse({ status: 201, description: 'Provincia creada exitosamente' })
  @ApiResponse({
    status: 409,
    description: 'La provincia ya existe en este departamento',
  })
  create(@Body() createProvinceDto: CreateProvinceDto) {
    return this.provinceService.create(createProvinceDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas las provincias' })
  @ApiQuery({
    name: 'departmentId',
    required: false,
    description: 'Filtrar por departamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de provincias obtenida exitosamente',
  })
  findAll(@Query() query: GeographicQueryDto & { departmentId?: string }) {
    return this.provinceService.findAll(query);
  }

  @Get('by-department/:departmentId')
  @ApiOperation({ summary: 'Obtener provincias por departamento' })
  @ApiResponse({ status: 200, description: 'Provincias encontradas' })
  @ApiResponse({ status: 404, description: 'Departamento no encontrado' })
  findByDepartment(@Param('departmentId') departmentId: string) {
    return this.provinceService.findByDepartment(departmentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una provincia por ID' })
  @ApiResponse({ status: 200, description: 'Provincia encontrada' })
  @ApiResponse({ status: 404, description: 'Provincia no encontrada' })
  findOne(@Param('id') id: string) {
    return this.provinceService.findOne(id);
  }

  @Patch(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar una provincia' })
  @ApiResponse({
    status: 200,
    description: 'Provincia actualizada exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Provincia no encontrada' })
  update(
    @Param('id') id: string,
    @Body() updateProvinceDto: UpdateProvinceDto,
  ) {
    return this.provinceService.update(id, updateProvinceDto);
  }

  @Delete(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar una provincia' })
  @ApiResponse({ status: 200, description: 'Provincia eliminada exitosamente' })
  @ApiResponse({ status: 404, description: 'Provincia no encontrada' })
  remove(@Param('id') id: string) {
    return this.provinceService.remove(id);
  }
}
