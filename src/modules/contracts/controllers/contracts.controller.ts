// src/modules/contracts/controllers/contracts.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ContractsService } from '../services/contracts.service';
import { CreateContractDto, ApproveUserDto, CheckCoverageDto } from '../dto/contracts.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { AuthService } from '../../auth/services/auth.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RoledUser, RoledUserDocument } from '../../auth/schemas/roledUser.schema';

@ApiTags('Contracts')
@Controller('api/v1/contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly authService: AuthService,
    @InjectModel(RoledUser.name) private roledUserModel: Model<RoledUserDocument>,
  ) {}

  /**
   * UC1: Aprobar o rechazar registro de Alcalde/Gobernador
   */
  @Post('users/:userId/approve')

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Aprobar o rechazar un usuario con rol (Superadmin)',
    description:
      'Permite al Superadmin aprobar o rechazar solicitudes de usuarios que desean operar como Alcalde o Gobernador',
  })
  @ApiResponse({ status: 200, description: 'Usuario procesado exitosamente' })
  async approveUser(
    @Param('userId') userId: string,
    @Body() dto: ApproveUserDto,
    @Request() req: any,
  ) {
    // TODO: Validar que req.user sea SUPERADMIN (agregar rol SUPERADMIN a RoledUser)
    // Por ahora asumimos que el guard ya validó el token

    const user = await this.roledUserModel.findById(userId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    if (dto.approve) {
      // Aprobar: activar usuario
      user.active = true;
      await user.save();

      // Aquí podrías crear automáticamente el contrato si ya sabes los datos
      // O dejarlo para que el Superadmin lo cree manualmente después

      return {
        message: 'Usuario aprobado exitosamente',
        user: {
          id: user._id.toString(),
          dni: user.dni,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
          territory: {
            departmentId: user.votingDepartmentId?.toString(),
            municipalityId: user.votingMunicipalityId?.toString(),
          },
        },
      };
    } else {
      // Rechazar: desactivar y opcionalmente registrar razón
      user.active = false;
      await user.save();

      // Aquí podrías guardar la razón del rechazo en un campo adicional
      // o en una colección de auditoría

      return {
        message: 'Usuario rechazado',
        reason: dto.reason,
      };
    }
  }

  /**
   * Crear un nuevo contrato
   */
  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear un contrato territorial (Superadmin)',
    description:
      'Crea un contrato que habilita a un Alcalde/Gobernador para operar en un territorio específico',
  })
  @ApiResponse({ status: 201, description: 'Contrato creado exitosamente' })
  async create(@Body() dto: CreateContractDto) {
    const contract = await this.contractsService.create({
      clientId: dto.clientId,
      electionId: dto.electionId,
      departmentId: dto.departmentId,
      municipalityId: dto.municipalityId,
      startDate: new Date(dto.startDate),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    });

    return {
      id: contract._id.toString(),
      clientId: contract.clientId.toString(),
      clientRole: contract.clientRole,
      territory: {
        departmentId: contract.departmentId?.toString(),
        departmentName: contract.departmentName,
        municipalityId: contract.municipalityId?.toString(),
        municipalityName: contract.municipalityName,
      },
      electionId: contract.electionId.toString(),
      active: contract.active,
      startDate: contract.startDate,
      endDate: contract.endDate,
    };
  }

  /**
   * Listar contratos activos
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar contratos activos' })
  async list(
    @Query('clientId') clientId?: string,
    @Query('electionId') electionId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('municipalityId') municipalityId?: string,
  ) {
    const contracts = await this.contractsService.findActiveContracts({
      clientId,
      electionId,
      departmentId,
      municipalityId,
    });

    return {
      data: contracts.map((c) => ({
        id: c._id.toString(),
        clientId: c.clientId.toString(),
        clientRole: c.clientRole,
        territory: {
          departmentId: c.departmentId?.toString(),
          departmentName: c.departmentName,
          municipalityId: c.municipalityId?.toString(),
          municipalityName: c.municipalityName,
        },
        electionId: c.electionId.toString(),
        active: c.active,
        startDate: c.startDate,
        endDate: c.endDate,
      })),
      total: contracts.length,
    };
  }

  /**
   * M1: Verificar cobertura para un territorio
   */
  @Post('check-coverage')
  @ApiOperation({
    summary: 'Verificar si existe cobertura activa para un territorio',
    description:
      'Usado por la app móvil para habilitar/deshabilitar el atestiguamiento según cobertura contratada',
  })
  @ApiResponse({
    status: 200,
    description: 'Resultado de verificación',
    schema: {
      properties: {
        hasCoverage: { type: 'boolean' },
        contracts: { type: 'array' },
      },
    },
  })
  async checkCoverage(@Body() dto: CheckCoverageDto) {
    const hasCoverage = await this.contractsService.hasCoverage({
      electionId: dto.electionId,
      departmentId: dto.departmentId,
      municipalityId: dto.municipalityId,
    });

    const contracts = hasCoverage
      ? await this.contractsService.findActiveContracts({
          electionId: dto.electionId,
          departmentId: dto.departmentId,
          municipalityId: dto.municipalityId,
        })
      : [];

    return {
      hasCoverage,
      contracts: contracts.map((c) => ({
        id: c._id.toString(),
        clientRole: c.clientRole,
        territory: {
          departmentName: c.departmentName,
          municipalityName: c.municipalityName,
        },
      })),
    };
  }

  /**
   * Obtener contrato de un cliente
   */
  @Get('client/:clientId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener contrato activo de un cliente' })
  async getClientContract(
    @Param('clientId') clientId: string,
    @Query('electionId') electionId: string,
  ) {
    if (!electionId) {
      throw new Error('electionId es requerido');
    }

    const contract = await this.contractsService.getClientContract(
      clientId,
      electionId,
    );

    if (!contract) {
      return {
        hasContract: false,
        contract: null,
      };
    }

    return {
      hasContract: true,
      contract: {
        id: contract._id.toString(),
        territory: {
          departmentId: contract.departmentId?.toString(),
          departmentName: contract.departmentName,
          municipalityId: contract.municipalityId?.toString(),
          municipalityName: contract.municipalityName,
        },
        active: contract.active,
        startDate: contract.startDate,
        endDate: contract.endDate,
      },
    };
  }

  /**
   * Desactivar un contrato
   */
  @Patch(':contractId/deactivate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar un contrato' })
  async deactivate(@Param('contractId') contractId: string) {
    await this.contractsService.deactivate(contractId);
    return { message: 'Contrato desactivado exitosamente' };
  }
}