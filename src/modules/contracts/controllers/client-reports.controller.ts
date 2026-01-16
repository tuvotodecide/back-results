// src/modules/contracts/controllers/client-reports.controller.ts
import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { TerritorialRestrictionGuard } from '../guards/territorial-restriction.guard';
import { ClientReportsService } from '../services/client-reports.service';
import { ContractsService } from '../services/contracts.service';

/**
 * UC4: Reportes para Alcaldes/Gobernadores
 * Estos endpoints están protegidos con restricciones territoriales
 */
@ApiTags('Client Reports')
@Controller('api/v1/client-reports')
@UseGuards(JwtAuthGuard, TerritorialRestrictionGuard)
@ApiBearerAuth()
export class ClientReportsController {
  constructor(
    private readonly clientReportsService: ClientReportsService,
    private readonly contractsService: ContractsService,
  ) {}

  /**
   * UC4: Reporte de actividad de delegados
   */
  @Get('delegate-activity')
  @ApiOperation({
    summary: 'Reporte de actividad de delegados (Alcalde/Gobernador)',
    description:
      'Muestra qué delegados realizaron atestiguamientos y en qué mesas/recintos',
  })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiQuery({
    name: 'groupBy',
    enum: ['delegate', 'location', 'table'],
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Reporte de actividad generado exitosamente',
  })
  async getDelegateActivity(
    @Query('electionId') electionId: string,
    @Query('groupBy') groupBy: 'delegate' | 'location' | 'table' = 'delegate',
    @Request() req: any,
  ) {
    // El guard ya validó y guardó el contrato en req.contract
    const contract = req.contract;

    return this.clientReportsService.getDelegateActivityReport({
      contractId: contract._id.toString(),
      electionId,
      groupBy,
    });
  }

  /**
   * Resumen ejecutivo
   */
  @Get('executive-summary')
  @ApiOperation({
    summary: 'Resumen ejecutivo del operativo (Alcalde/Gobernador)',
    description:
      'Métricas clave: delegados activos, mesas cubiertas, cobertura territorial',
  })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiResponse({
    status: 200,
    description: 'Resumen ejecutivo generado exitosamente',
  })
  async getExecutiveSummary(
    @Query('electionId') electionId: string,
    @Request() req: any,
  ) {
    const contract = req.contract;

    return this.clientReportsService.getExecutiveSummary({
      contractId: contract._id.toString(),
      electionId,
    });
  }

  /**
   * Obtener mi contrato activo
   */
  @Get('my-contract')
  @ApiOperation({
    summary: 'Obtener mi contrato activo',
    description: 'Devuelve el contrato y territorio asignado al cliente',
  })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiResponse({
    status: 200,
    description: 'Información del contrato',
  })
  async getMyContract(
    @Query('electionId') electionId: string,
    @Request() req: any,
  ) {
    const clientId = req.user.sub;

    const contract = await this.contractsService.getClientContract(
      clientId,
      electionId,
    );

    if (!contract) {
      return {
        hasContract: false,
        message: 'No tiene un contrato activo para esta elección',
      };
    }

    return {
      hasContract: true,
      contract: {
        id: contract._id.toString(),
        role: contract.clientRole,
        territory: {
          type:
            contract.clientRole === 'MAYOR' ? 'municipality' : 'department',
          departmentId: contract.departmentId?.toString(),
          departmentName: contract.departmentName,
          municipalityId: contract.municipalityId?.toString(),
          municipalityName: contract.municipalityName,
        },
        period: {
          startDate: contract.startDate,
          endDate: contract.endDate,
        },
        active: contract.active,
      },
    };
  }

  /**
   * Listar mis delegados
   */
  @Get('my-delegates')
  @ApiOperation({
    summary: 'Listar mis delegados autorizados',
    description: 'Lista oficial de delegados para este cliente',
  })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiResponse({
    status: 200,
    description: 'Lista de delegados',
  })
  async getMyDelegates(
    @Query('electionId') electionId: string,
    @Request() req: any,
  ) {
    const contract = req.contract;


    return {
      message: 'Ver endpoint /api/v1/delegates/contract/:contractId',
      contractId: contract._id.toString(),
    };
  }
}