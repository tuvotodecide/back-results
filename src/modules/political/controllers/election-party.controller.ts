import {
  Controller,
  Post,
  Body,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { PoliticalPartyService } from '../services/political-party.service';
import {
  AssignElectionPartiesBulkDto,
  RemoveElectionPartiesBulkDto,
  UpdateElectionPartyDto,
} from '../dto/election-party.dto';
import { Public } from '@/core/decorators/public.decorator';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';

@ApiTags('Political Parties - Election Assignment')
@Controller('political/election-parties')
export class ElectionPartyController {
  constructor(private readonly partyService: PoliticalPartyService) {}

  @Post('assign-bulk')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({
    summary: 'Asignar partidos a una elección con filtrado territorial',
    description: `
      Asigna múltiples partidos a una elección. Soporta filtrado territorial:
      - Sin departmentId ni municipalityId: Partidos nacionales
      - Con departmentId: Partidos para ese departamento específico
      - Con municipalityId: Partidos para ese municipio específico
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Partidos asignados exitosamente',
  })
  assignBulk(@Body() dto: AssignElectionPartiesBulkDto) {
    return this.partyService.assignPartiesToElection(
      dto.electionId,
      dto.partyIds,
      dto.departmentId,
      dto.municipalityId,
    );
  }

  @Delete('remove-bulk')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({
    summary: 'Remover partidos de una elección con filtrado territorial',
    description: `
      Desactiva múltiples partidos de una elección. Respeta filtros territoriales.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Partidos removidos exitosamente',
  })
  removeBulk(@Body() dto: RemoveElectionPartiesBulkDto) {
    return this.partyService.removePartiesFromElection(
      dto.electionId,
      dto.partyIds,
      dto.departmentId,
      dto.municipalityId,
    );
  }

  @Get('by-election/:electionId')
  @Public()
  @ApiOperation({
    summary: 'Listar todos los partidos de una elección',
    description: 'Retorna todos los partidos asignados a una elección',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de partidos de la elección',
  })
  getByElection(@Param('electionId') electionId: string) {
    return this.partyService.getElectionParties(electionId);
  }

  @Get('by-territory/:electionId')
  @Public()
  @ApiOperation({
    summary: 'Obtener partidos habilitados para un territorio específico',
    description: `
      Retorna partidos que pueden competir en un territorio específico.
      Incluye partidos nacionales y partidos del territorio solicitado.
    `,
  })
  @ApiQuery({
    name: 'departmentId',
    required: false,
    type: String,
    description: 'ID del departamento',
  })
  @ApiQuery({
    name: 'municipalityId',
    required: false,
    type: String,
    description: 'ID del municipio',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de partidos disponibles para el territorio',
  })
  getByTerritory(
    @Param('electionId') electionId: string,
    @Query('departmentId') departmentId?: string,
    @Query('municipalityId') municipalityId?: string,
  ) {
    return this.partyService.getPartiesForTerritory(
      electionId,
      departmentId,
      municipalityId,
    );
  }

  @Patch(':id')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({
    summary: 'Actualizar metadatos de un partido en una elección',
    description:
      'Actualiza número de papeleta, alianza, color o estado activo',
  })
  @ApiResponse({
    status: 200,
    description: 'Partido actualizado exitosamente',
  })
  updateOne(@Param('id') id: string, @Body() dto: UpdateElectionPartyDto) {
    return this.partyService.updateElectionParty(id, dto);
  }
}
