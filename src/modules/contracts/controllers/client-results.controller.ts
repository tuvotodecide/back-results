import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { ElectionTypeFilterDto } from '@/modules/results/dto/results.dto';
import { ClientResultsService } from '../services/client-results.service';
import { PreliminaryResultsGuard } from '@/modules/elections/guards/preliminary-results.guard';

@ApiTags('Client Results')
@ApiBearerAuth()
@Controller('api/v1/client-results')
export class ClientResultsController {
  constructor(private readonly clientResultsService: ClientResultsService) {}

  @Get('by-location')
  @ApiOperation({
    summary:
      'Resultados por partido restringidos al contrato del cliente (Alcalde/Gobernador)',
    description:
      'Devuelve el mismo formato que /api/v1/results/by-location, pero forzando el territorio desde el contrato del usuario. El usuario NO puede cambiar department/municipality en el query.',
  })
  @ApiQuery({
    name: 'electionType',
    enum: ['presidential', 'deputies'],
    required: true,
  })
  @ApiQuery({
    name: 'electionId',
    required: true,
    description: 'ID de la elección',
  })
  @ApiResponse({ status: 200, description: 'OK (restringido por contrato)' })
  @ApiResponse({
    status: 403,
    description: 'Sin contrato activo o territorio inválido',
  })
  @UseGuards(JwtAuthGuard, ResultsPeriodGuard)
  async getClientResultsByLocation(
    @Query() q: ElectionTypeFilterDto,
    @Request() req: any, // Aquí obtenemos el request con el usuario autenticado
  ) {
    // req.user viene del JwtAuthGuard y contiene { sub: userId, dni, role, ... }
    const userId = req.user?.sub;

    if (
      q.department ||
      q.municipality ||
      q.province ||
      q.electoralSeat ||
      q.electoralLocation ||
      q.tableCode
    ) {
      throw new ForbiddenException(
        'No puede especificar filtros geográficos. El territorio está determinado por su contrato.',
      );
    }

    return this.clientResultsService.getResultsRestrictedToMyContract(
      {
        electionType: q.electionType,
        electionId: q.electionId,
        mode: 'final',
      },
      userId,
    );
  }
  @Get('live/by-location')
@UseGuards(JwtAuthGuard, PreliminaryResultsGuard)  
async getClientLiveResultsByLocation(
  @Query() q: ElectionTypeFilterDto,
  @Request() req: any,
) {
  const userId = req.user?.sub;

  if (
    q.department ||
    q.municipality ||
    q.province ||
    q.electoralSeat ||
    q.electoralLocation ||
    q.tableCode
  ) {
    throw new ForbiddenException(
      'No puede especificar filtros geográficos. El territorio está determinado por su contrato.'
    );
  }

  return this.clientResultsService.getResultsRestrictedToMyContract(
    {
      electionType: q.electionType,
      electionId: q.electionId,
      mode: 'live',  // ← LIVE
    },
    userId,
  );
}}
