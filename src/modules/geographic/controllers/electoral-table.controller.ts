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
  ApiParam,
} from '@nestjs/swagger';
import { ElectoralTableService } from '../services/electoral-table.service';
import {
  CreateElectoralTableDto,
  UpdateElectoralTableDto,
  ElectoralTableQueryDto,
} from '../dto/electoral-table.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';

@ApiTags('Geografía')
@Controller('api/v1/geographic/electoral-tables')
export class ElectoralTableController {
  constructor(private readonly electoralTableService: ElectoralTableService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear una nueva mesa electoral' })
  @ApiResponse({
    status: 201,
    description: 'Mesa electoral creada exitosamente',
  })
  @ApiResponse({
    status: 409,
    description: 'El código de mesa ya existe o número duplicado en recinto',
  })
  create(@Body() createTableDto: CreateElectoralTableDto) {
    return this.electoralTableService.create(createTableDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas las mesas electorales' })
  @ApiResponse({
    status: 200,
    description: 'Lista de mesas obtenida exitosamente',
  })
  findAll(@Query() query: ElectoralTableQueryDto) {
    return this.electoralTableService.findAll(query);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Obtener estadísticas de mesas electorales' })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
  })
  getStatistics() {
    return this.electoralTableService.getStatistics();
  }

  @Get('by-location/:electoralLocationId')
  @ApiOperation({ summary: 'Obtener mesas por recinto electoral' })
  @ApiParam({
    name: 'electoralLocationId',
    description: 'ID del recinto electoral',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Mesas del recinto encontradas',
  })
  @ApiResponse({
    status: 404,
    description: 'Recinto electoral no encontrado',
  })
  findByElectoralLocation(
    @Param('electoralLocationId') electoralLocationId: string,
  ) {
    return this.electoralTableService.findByElectoralLocation(
      electoralLocationId,
    );
  }

  @Get('table-code/:tableCode')
  @ApiOperation({ summary: 'Obtener una mesa por código' })
  @ApiParam({
    name: 'tableCode',
    description: 'Código de la mesa electoral',
    example: 'ABC123',
  })
  @ApiResponse({ status: 200, description: 'Mesa encontrada' })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  findByTableCode(@Param('tableCode') tableCode: string) {
    return this.electoralTableService.findByTableCode(tableCode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una mesa electoral por ID' })
  @ApiResponse({ status: 200, description: 'Mesa encontrada' })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  findOne(@Param('id') id: string) {
    return this.electoralTableService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar una mesa electoral' })
  @ApiResponse({
    status: 200,
    description: 'Mesa electoral actualizada exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  update(
    @Param('id') id: string,
    @Body() updateTableDto: UpdateElectoralTableDto,
  ) {
    return this.electoralTableService.update(id, updateTableDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar una mesa electoral' })
  @ApiResponse({
    status: 200,
    description: 'Mesa electoral eliminada exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  remove(@Param('id') id: string) {
    return this.electoralTableService.remove(id);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activar una mesa electoral' })
  @ApiResponse({ status: 200, description: 'Mesa activada exitosamente' })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  activate(@Param('id') id: string) {
    return this.electoralTableService.activate(id);
  }

  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar una mesa electoral' })
  @ApiResponse({ status: 200, description: 'Mesa desactivada exitosamente' })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  deactivate(@Param('id') id: string) {
    return this.electoralTableService.deactivate(id);
  }
}
