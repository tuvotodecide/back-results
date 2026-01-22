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
} from '@nestjs/swagger';
import { DepartmentService } from '../services/department.service';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from '../dto/department.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';
import { Public } from '@/core/decorators/public.decorator';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';

@ApiTags('Geografía')
@Controller('api/v1/geographic/departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Post()
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Crear un nuevo departamento' })
  @ApiResponse({ status: 201, description: 'Departamento creado exitosamente' })
  @ApiResponse({ status: 409, description: 'El departamento ya existe' })
  create(@Body() createDepartmentDto: CreateDepartmentDto) {
    return this.departmentService.create(createDepartmentDto);
  }

  @Get()
  @Public()
  @UseGuards(TerritorialScopeGuard)  // ← IMPORTANTE: Agregado
  @ApiOperation({ summary: 'Listar todos los departamentos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de departamentos obtenida exitosamente',
  })
  findAll(@Query() query: GeographicQueryDto) {
    // El guard ya habrá forzado departmentId si es GOVERNOR
    return this.departmentService.findAll(query);
  }

  @Get(':id')
  @Public()
  @UseGuards(TerritorialScopeGuard)  // ← IMPORTANTE: Agregado
  @ApiOperation({ summary: 'Obtener un departamento por ID' })
  @ApiResponse({ status: 200, description: 'Departamento encontrado' })
  @ApiResponse({ status: 404, description: 'Departamento no encontrado' })
  findOne(@Param('id', new ParseObjectIdPipe()) id: string) {
    // El guard ya habrá validado que el ID es del departamento del usuario
    return this.departmentService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Actualizar un departamento' })
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
  ) {
    return this.departmentService.update(id, updateDepartmentDto);
  }

  @Delete(':id')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Eliminar un departamento' })
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.departmentService.remove(id);
  }

  @Patch(':id/activate')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Activar un departamento' })
  activate(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.departmentService.activate(id);
  }

  @Patch(':id/deactivate')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Desactivar un departamento' })
  deactivate(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.departmentService.deactivate(id);
  }
}