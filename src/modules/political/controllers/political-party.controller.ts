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
import { PoliticalPartyService } from '../services/political-party.service';
import {
  CreatePoliticalPartyDto,
  UpdatePoliticalPartyDto,
  PoliticalPartyQueryDto,
} from '../dto/political-party.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';

@ApiTags('Partidos')
@Controller('api/v1/political-parties')
export class PoliticalPartyController {
  constructor(private readonly politicalPartyService: PoliticalPartyService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un nuevo partido político' })
  @ApiResponse({
    status: 201,
    description: 'Partido político creado exitosamente',
  })
  @ApiResponse({
    status: 409,
    description: 'El ID del partido ya existe',
  })
  create(@Body() createDto: CreatePoliticalPartyDto) {
    return this.politicalPartyService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos los partidos políticos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de partidos obtenida exitosamente',
  })
  findAll(@Query() query: PoliticalPartyQueryDto) {
    return this.politicalPartyService.findAll(query);
  }

  @Get('active')
  @ApiOperation({ summary: 'Listar solo partidos políticos activos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de partidos activos obtenida exitosamente',
  })
  getActiveParties() {
    return this.politicalPartyService.getActiveParties();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un partido político por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID del partido político',
  })
  @ApiResponse({
    status: 200,
    description: 'Partido político encontrado',
  })
  @ApiResponse({
    status: 404,
    description: 'Partido político no encontrado',
  })
  findOne(@Param('id') id: string) {
    return this.politicalPartyService.findOne(id);
  }

  @Get('by-party-id/:partyId')
  @ApiOperation({ summary: 'Obtener un partido político por partyId' })
  @ApiParam({
    name: 'partyId',
    description: 'ID único del partido (ej: MAS-IPSP)',
  })
  @ApiResponse({
    status: 200,
    description: 'Partido político encontrado',
  })
  @ApiResponse({
    status: 404,
    description: 'Partido político no encontrado',
  })
  findByPartyId(@Param('partyId') partyId: string) {
    return this.politicalPartyService.findByPartyId(partyId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar un partido político' })
  @ApiParam({
    name: 'id',
    description: 'ID del partido político',
  })
  @ApiResponse({
    status: 200,
    description: 'Partido político actualizado exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Partido político no encontrado',
  })
  update(@Param('id') id: string, @Body() updateDto: UpdatePoliticalPartyDto) {
    return this.politicalPartyService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar un partido político' })
  @ApiParam({
    name: 'id',
    description: 'ID del partido político',
  })
  @ApiResponse({
    status: 200,
    description: 'Partido político eliminado exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Partido político no encontrado',
  })
  remove(@Param('id') id: string) {
    return this.politicalPartyService.remove(id);
  }
}
