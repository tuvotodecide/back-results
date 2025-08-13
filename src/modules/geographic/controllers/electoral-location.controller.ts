/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
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
  ApiParam,
} from '@nestjs/swagger';
import { ElectoralLocationService } from '../services/electoral-location.service';
import {
  CreateElectoralLocationDto,
  UpdateElectoralLocationDto,
} from '../dto/electoral-location.dto';
import { LocationQueryDto } from '../dto/query.dto';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-objectid.pipe';

@ApiTags('Geografía')
@Controller('api/v1/geographic/electoral-locations')
export class ElectoralLocationController {
  constructor(private readonly locationService: ElectoralLocationService) {}

  @Post()
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un nuevo recinto electoral' })
  @ApiResponse({
    status: 201,
    description: 'Recinto electoral creado exitosamente',
  })
  @ApiResponse({ status: 409, description: 'El código de recinto ya existe' })
  create(@Body() createLocationDto: CreateElectoralLocationDto) {
    return this.locationService.create(createLocationDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos los recintos electorales' })
  @ApiResponse({
    status: 200,
    description: 'Lista de recintos obtenida exitosamente',
  })
  findAll(@Query() query: LocationQueryDto) {
    return this.locationService.findAll(query);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Obtener estadísticas de recintos electorales' })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
  })
  getStatistics() {
    return this.locationService.getStatistics();
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Buscar recintos cercanos a una ubicación' })
  @ApiQuery({ name: 'lat', description: 'Latitud' })
  @ApiQuery({ name: 'lng', description: 'Longitud' })
  @ApiQuery({
    name: 'maxDistance',
    description: 'Distancia máxima en metros',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Recintos cercanos encontrados' })
  findNearby(
    @Query('lat') latitude: number,
    @Query('lng') longitude: number,
    @Query('maxDistance') maxDistance?: number,
  ) {
    return this.locationService.findNearby(
      +latitude,
      +longitude,
      maxDistance ? +maxDistance : undefined,
    );
  }

  @Get('circunscripcion/:type')
  @ApiOperation({ summary: 'Buscar recintos por tipo de circunscripción' })
  @ApiQuery({
    name: 'number',
    description: 'Número de circunscripción',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Recintos encontrados' })
  findByCircunscripcion(
    @Param('type') type: string,
    @Query('number') number?: number,
  ) {
    return this.locationService.findByCircunscripcion(
      type,
      number ? +number : undefined,
    );
  }

  @Get('code/:code')
  @ApiOperation({ summary: 'Obtener un recinto por código' })
  @ApiResponse({ status: 200, description: 'Recinto encontrado' })
  @ApiResponse({ status: 404, description: 'Recinto no encontrado' })
  findByCode(@Param('code') code: string) {
    return this.locationService.findByCode(code);
  }

  @Get('by-electoral-seat/:electoralSeatId')
  @ApiOperation({ summary: 'Obtener recintos por asiento electoral' })
  @ApiResponse({ status: 200, description: 'Recintos encontrados' })
  @ApiResponse({ status: 404, description: 'Asiento electoral no encontrado' })
  findByElectoralSeat(@Param('electoralSeatId') electoralSeatId: string) {
    return this.locationService.findByElectoralSeat(electoralSeatId);
  }

  @Get(':id/tables')
  @ApiOperation({
    summary: 'Obtener un recinto electoral con sus mesas',
    description:
      'Retorna los datos del recinto incluyendo todas sus mesas electorales',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del recinto electoral',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Recinto encontrado con sus mesas electorales',
  })
  @ApiResponse({ status: 404, description: 'Recinto no encontrado' })
  findOneWithTables(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.locationService.findOneWithTables(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un recinto electoral por ID' })
  @ApiResponse({ status: 200, description: 'Recinto encontrado' })
  @ApiResponse({ status: 404, description: 'Recinto no encontrado' })
  findOne(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.locationService.findOne(id);
  }

  @Patch(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar un recinto electoral' })
  @ApiResponse({ status: 200, description: 'Recinto actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Recinto no encontrado' })
  update(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body() updateLocationDto: UpdateElectoralLocationDto,
  ) {
    return this.locationService.update(id, updateLocationDto);
  }

  @Delete(':id')
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar un recinto electoral' })
  @ApiResponse({ status: 200, description: 'Recinto eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Recinto no encontrado' })
  remove(@Param('id', new ParseObjectIdPipe()) id: string) {
    return this.locationService.remove(id);
  }
}
