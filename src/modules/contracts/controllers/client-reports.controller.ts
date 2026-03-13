// src/modules/contracts/controllers/client-reports.controller.ts
import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  BadRequestException,
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
      'Muestra qué delegados realizaron atestiguamientos y en qué mesas/recintos. SUPERADMIN puede pasar contractId directamente.',
  })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiQuery({
    name: 'contractId',
    required: false,
    description: 'ID del contrato (solo para SUPERADMIN)',
  })
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
    @Query('contractId') contractIdParam: string,
    @Query('groupBy') groupBy: 'delegate' | 'location' | 'table' = 'delegate',
    @Request() req: any,
  ) {
    // Para MAYOR/GOVERNOR el guard asigna req.contract
    // Para SUPERADMIN se debe pasar contractId como parámetro
    let contractId: string;

    if (req.contract) {
      contractId = req.contract._id.toString();
    } else if (contractIdParam) {
      contractId = contractIdParam;
    } else {
      throw new BadRequestException(
        'contractId es requerido para usuarios SUPERADMIN',
      );
    }

    return this.clientReportsService.getDelegateActivityReport({
      contractId,
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
      'Métricas clave: delegados activos, mesas cubiertas, cobertura territorial. SUPERADMIN puede pasar contractId directamente.',
  })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiQuery({
    name: 'contractId',
    required: false,
    description: 'ID del contrato (solo para SUPERADMIN)',
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen ejecutivo generado exitosamente',
  })
  async getExecutiveSummary(
    @Query('electionId') electionId: string,
    @Query('contractId') contractIdParam: string,
    @Request() req: any,
  ) {
    let contractId: string;

    if (req.contract) {
      contractId = req.contract._id.toString();
    } else if (contractIdParam) {
      contractId = contractIdParam;
    } else {
      throw new BadRequestException(
        'contractId es requerido para usuarios SUPERADMIN',
      );
    }

    return this.clientReportsService.getExecutiveSummary({
      contractId,
      electionId,
    });
  }

  @Get('audit-match')
  @ApiOperation({
    summary: 'Reporte de auditoría OEP/TSE para actas de mis delegados',
    description:
      'Retorna resumen y detalle por acta atestiguada dentro del contrato, usando comparaciones previamente persistidas.',
  })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiQuery({ name: 'contractId', required: false })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'province', required: false })
  @ApiQuery({ name: 'municipality', required: false })
  @ApiQuery({ name: 'electoralSeat', required: false })
  @ApiQuery({ name: 'electoralLocation', required: false })
  @ApiQuery({ name: 'tableCode', required: false })
  async getAuditMatch(
    @Query('electionId') electionId: string,
    @Query('contractId') contractIdParam: string,
    @Query('department') department: string | undefined,
    @Query('province') province: string | undefined,
    @Query('municipality') municipality: string | undefined,
    @Query('electoralSeat') electoralSeat: string | undefined,
    @Query('electoralLocation') electoralLocation: string | undefined,
    @Query('tableCode') tableCode: string | undefined,
    @Request() req: any,
  ) {
    let contractId: string;

    if (req.contract) {
      contractId = req.contract._id.toString();
    } else if (contractIdParam) {
      contractId = contractIdParam;
    } else {
      throw new BadRequestException(
        'contractId es requerido para usuarios SUPERADMIN',
      );
    }

    return this.clientReportsService.getAuditMatchReport({
      contractId,
      electionId,
      department,
      province,
      municipality,
      electoralSeat,
      electoralLocation,
      tableCode,
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

    // Después del populate, los campos son objetos
    const dept = contract.departmentId as any;
    const muni = contract.municipalityId as any;

    return {
      hasContract: true,
      contract: {
        id: contract._id.toString(),
        role: contract.clientRole,
        territory: {
          type: contract.clientRole === 'MAYOR' ? 'municipality' : 'department',
          departmentId: dept?._id?.toString() || dept?.toString() || null,
          departmentName: dept?.name || contract.departmentName,
          municipalityId: muni?._id?.toString() || muni?.toString() || null,
          municipalityName: muni?.name || contract.municipalityName,
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
    description:
      'Lista oficial de delegados para este cliente. SUPERADMIN puede pasar contractId directamente.',
  })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiQuery({
    name: 'contractId',
    required: false,
    description: 'ID del contrato (solo para SUPERADMIN)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de delegados',
  })
  async getMyDelegates(
    @Query('electionId') electionId: string,
    @Query('contractId') contractIdParam: string,
    @Request() req: any,
  ) {
    let contractId: string;

    if (req.contract) {
      contractId = req.contract._id.toString();
    } else if (contractIdParam) {
      contractId = contractIdParam;
    } else {
      throw new BadRequestException(
        'contractId es requerido para usuarios SUPERADMIN',
      );
    }

    return {
      message: 'Ver endpoint /api/v1/delegates/contract/:contractId',
      contractId,
    };
  }

  @Get('my-active-contract')
  @ApiOperation({
    summary: 'Obtener mi contrato activo (simplificado)',
    description: 'Devuelve electionId, territorio y si tiene contrato válido',
  })
  @ApiQuery({ name: 'electionId', required: false })
  @ApiResponse({ status: 200 })
  async getMyActiveContract(
    @Query('electionId') electionId?: string,
    @Request() req?: any,
  ) {
    const userId = req.user?.sub;

    if (!userId) {
      return { hasContract: false, contract: null };
    }

    //
    let contract;
    if (electionId) {
      contract = await this.contractsService.getClientContract(
        userId,
        electionId,
      );
    } else {
      const contracts = await this.contractsService.findActiveContracts({
        clientId: userId,
      });
      contract = contracts[0] || null;
    }

    if (!contract) {
      return { hasContract: false, contract: null };
    }

    // Después del populate, los campos son objetos
    const dept = contract.departmentId as any;
    const muni = contract.municipalityId as any;

    return {
      hasContract: true,
      contract: {
        id: contract._id.toString(),
        electionId: contract.electionId.toString(),
        role: contract.clientRole,
        territory: {
          type: contract.clientRole === 'MAYOR' ? 'municipality' : 'department',
          departmentId: dept?._id?.toString() || dept?.toString() || null,
          departmentName: dept?.name || contract.departmentName,
          municipalityId: muni?._id?.toString() || muni?.toString() || null,
          municipalityName: muni?.name || contract.municipalityName,
        },
        active: contract.active,
      },
    };
  }
}
