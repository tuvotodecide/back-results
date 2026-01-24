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
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { ContractsService } from '../services/contracts.service';
import {
  CreateContractDto,
  ApproveUserDto,
  CheckCoverageDto,
  CheckAttestationAvailabilityDto,
} from '../dto/contracts.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { AuthService } from '../../auth/services/auth.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RoledUser,
  RoledUserDocument,
} from '../../auth/schemas/roledUser.schema';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { Public } from '@/core/decorators/public.decorator';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';

@ApiTags('Contracts')
@Controller('api/v1/contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly electoralLocationService: ElectoralLocationService,
    private readonly authService: AuthService,
    @InjectModel(RoledUser.name)
    private roledUserModel: Model<RoledUserDocument>,
  ) {}

  /**
   * UC1: Aprobar o rechazar registro de Alcalde/Gobernador
   */
  @Post('users/:userId/approve')
  @ApiBearerAuth()
  @UseGuards(AdminOnlyGuard)
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
  @UseGuards(AdminOnlyGuard)
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
  @ApiQuery({ name: 'clientId', required: false, type: String })
  @ApiQuery({ name: 'electionId', required: false, type: String })
  @ApiQuery({ name: 'departmentId', required: false, type: String })
  @ApiQuery({ name: 'municipalityId', required: false, type: String })
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
      data: contracts.map((c) => {
        const client = c.clientId as any;
        const dept = c.departmentId as any;
        const muni = c.municipalityId as any;

        return {
          id: c._id.toString(),
          clientId: client?._id?.toString() || client?.toString(),
          client: client?._id
            ? { name: client.name, email: client.email, role: client.role }
            : undefined,
          clientRole: c.clientRole,
          territory: {
            departmentId: dept?._id?.toString() || dept?.toString() || null,
            departmentName: dept?.name || c.departmentName,
            municipalityId: muni?._id?.toString() || muni?.toString() || null,
            municipalityName: muni?.name || c.municipalityName,
          },
          electionId: c.electionId.toString(),
          active: c.active,
          startDate: c.startDate,
          endDate: c.endDate,
        };
      }),
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

    // Después del populate, los campos son objetos
    const dept = contract.departmentId as any;
    const muni = contract.municipalityId as any;

    return {
      hasContract: true,
      contract: {
        id: contract._id.toString(),
        territory: {
          departmentId: dept?._id?.toString() || dept?.toString() || null,
          departmentName: dept?.name || contract.departmentName,
          municipalityId: muni?._id?.toString() || muni?.toString() || null,
          municipalityName: muni?.name || contract.municipalityName,
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
  @UseGuards(AdminOnlyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar un contrato' })
  async deactivate(@Param('contractId') contractId: string) {
    await this.contractsService.deactivate(contractId);
    return { message: 'Contrato desactivado exitosamente' };
  }

  /**
   * Obtener mis elecciones (donde tengo contratos)
   */
  @Get('my-elections')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener elecciones donde tengo contratos (activos o inactivos)',
    description: `
      Retorna todas las elecciones donde el usuario tiene contratos.
      Útil para que usuarios con rol MAYOR/GOVERNOR vean solo sus elecciones relevantes.
      Incluye tanto elecciones activas como históricas.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de elecciones con contratos del usuario',
  })
  async getMyElections(@Request() req: any) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('Usuario no identificado');
    }

    return this.contractsService.getMyElections(userId);
  }

  /**
   * Obtener historial de contratos
   */
  @Get('my-history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener historial completo de contratos del usuario',
    description: `
      Retorna todos los contratos del usuario (activos e inactivos).
      Permite filtrar por estado (active) y por elección específica (electionId).
    `,
  })
  @ApiQuery({
    name: 'active',
    required: false,
    type: Boolean,
    description: 'Filtrar por estado activo/inactivo',
  })
  @ApiQuery({
    name: 'electionId',
    required: false,
    type: String,
    description: 'Filtrar por elección específica',
  })
  @ApiResponse({
    status: 200,
    description: 'Historial de contratos del usuario',
  })
  async getMyContractHistory(
    @Request() req: any,
    @Query('active') active?: string,
    @Query('electionId') electionId?: string,
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('Usuario no identificado');
    }

    const filters: any = {};

    if (active !== undefined) {
      filters.active = active === 'true';
    }

    if (electionId) {
      filters.electionId = electionId;
    }

    return this.contractsService.getContractHistory(userId, filters);
  }

  @Get('check-attestation-availability')
  @Public()
  @ApiOperation({
    summary: 'Verificar disponibilidad de atestiguamiento por ubicación',
    description: `
      Verifica qué elecciones están disponibles para atestiguar basándose en:
      - Ubicación del usuario (recinto electoral cercano)
      - Contratos activos en ese territorio
      - Configuraciones electorales activas

      Retorna las elecciones disponibles con información del territorio.
    `,
  })
  @ApiQuery({
    name: 'latitude',
    required: true,
    type: Number,
    example: -16.5,
    description: 'Latitud del usuario',
  })
  @ApiQuery({
    name: 'longitude',
    required: true,
    type: Number,
    example: -68.15,
    description: 'Longitud del usuario',
  })
  @ApiQuery({
    name: 'maxDistance',
    required: false,
    type: Number,
    example: 10000,
    description: 'Distancia máxima en metros (default: 10000)',
  })
  @ApiResponse({
    status: 200,
    description: 'Disponibilidad verificada',
  })
  async checkAttestationAvailability(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('maxDistance') maxDistance?: string,
  ) {
    // Convertir a números
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const maxDist = maxDistance ? parseFloat(maxDistance) : 10000;

    // Validar que sean números válidos
    if (isNaN(lat) || isNaN(lng)) {
      throw new BadRequestException(
        'latitude y longitude deben ser números válidos',
      );
    }

    if (maxDistance && isNaN(maxDist)) {
      throw new BadRequestException('maxDistance debe ser un número válido');
    }

    return this.contractsService.checkAttestationAvailability(
      lat,
      lng,
      maxDist,
    );
  }
}
