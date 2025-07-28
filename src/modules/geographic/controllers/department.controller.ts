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
} from '@nestjs/swagger';
import { DepartmentService } from '../services/department.service';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from '../dto/department.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';

@ApiTags('Geografía')
@Controller('api/v1/geographic/departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un nuevo departamento' })
  @ApiResponse({ status: 201, description: 'Departamento creado exitosamente' })
  @ApiResponse({ status: 409, description: 'El departamento ya existe' })
  create(@Body() createDepartmentDto: CreateDepartmentDto) {
    return this.departmentService.create(createDepartmentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos los departamentos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de departamentos obtenida exitosamente',
  })
  findAll(@Query() query: GeographicQueryDto) {
    return this.departmentService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un departamento por ID' })
  @ApiResponse({ status: 200, description: 'Departamento encontrado' })
  @ApiResponse({ status: 404, description: 'Departamento no encontrado' })
  findOne(@Param('id') id: string) {
    return this.departmentService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar un departamento' })
  @ApiResponse({
    status: 200,
    description: 'Departamento actualizado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Departamento no encontrado' })
  update(
    @Param('id') id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
  ) {
    return this.departmentService.update(id, updateDepartmentDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar un departamento' })
  @ApiResponse({
    status: 200,
    description: 'Departamento eliminado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Departamento no encontrado' })
  remove(@Param('id') id: string) {
    return this.departmentService.remove(id);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activar un departamento' })
  activate(@Param('id') id: string) {
    return this.departmentService.activate(id);
  }

  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar un departamento' })
  deactivate(@Param('id') id: string) {
    return this.departmentService.deactivate(id);
  }
}
