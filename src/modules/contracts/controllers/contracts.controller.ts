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
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { ContractsService } from '../services/contracts.service';
import {
  CreateContractDto,
  ApproveUserDto,
  ReviewTerritorialAccessDto,
  TerritorialAccessQueryDto,
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
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
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
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Aprobar o rechazar un usuario con rol (Superadmin)',
    description:
      'Permite al superadministrador aprobar o rechazar solicitudes de usuarios que desean operar como alcalde o gobernador',
  })
  @ApiResponse({ status: 200, description: 'Usuario procesado exitosamente' })
  async approveUser(
    @Param('userId') userId: string,
    @Body() dto: ApproveUserDto,
    @Request() req: any,
  ) {
    if (dto.approve) {
      return this.approveTerritorialAccess(userId, req.user);
    }
    return this.rejectTerritorialAccess(userId, dto.reason, req.user);
  }

  @Get('territorial-access-requests')
  @ApiBearerAuth()
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Listar solicitudes de acceso territorial',
    description:
      'Lista usuarios con solicitud o acceso territorial. Permite filtrar por estado.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'NONE',
      'PENDING_EMAIL_VERIFICATION',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'REVOKED',
    ],
  })
  async listTerritorialAccessRequests(@Query() query: TerritorialAccessQueryDto) {
    const mongoQuery: any = {
      role: { $in: ['MAYOR', 'GOVERNOR'] },
    };

    if (query.status) {
      if (query.status === 'APPROVED') {
        mongoQuery.$or = [
          { territorialAccessStatus: 'APPROVED' },
          { territorialAccessStatus: { $exists: false }, active: true },
          { territorialAccessStatus: 'NONE', active: true },
        ];
      } else {
        mongoQuery.territorialAccessStatus = query.status;
      }
    }

    const rows = await this.roledUserModel
      .find(mongoQuery)
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    return {
      data: rows.map((row) => this.toTerritorialAccessResponse(row)),
      total: rows.length,
    };
  }

  @Get('territorial-access-requests/:userId')
  @ApiBearerAuth()
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Ver detalle de solicitud territorial',
    description: 'Retorna el detalle de una solicitud o acceso territorial por usuario.',
  })
  @ApiParam({ name: 'userId', description: 'ID del usuario territorial.' })
  async getTerritorialAccessRequest(@Param('userId') userId: string) {
    const user = await this.getTerritorialUserOrThrow(userId);
    return this.toTerritorialAccessResponse(user);
  }

  @Post('territorial-access-requests/:userId/approve')
  @ApiBearerAuth()
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Aprobar solicitud territorial',
    description: 'Aprueba una solicitud territorial pendiente de aprobación.',
  })
  @ApiParam({ name: 'userId', description: 'ID del usuario territorial.' })
  async approveTerritorialAccessEndpoint(
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    return this.approveTerritorialAccess(userId, req.user);
  }

  @Post('territorial-access-requests/:userId/reject')
  @ApiBearerAuth()
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Rechazar solicitud territorial',
    description: 'Rechaza una solicitud territorial pendiente de aprobación.',
  })
  @ApiParam({ name: 'userId', description: 'ID del usuario territorial.' })
  @ApiBody({ type: ReviewTerritorialAccessDto })
  async rejectTerritorialAccessEndpoint(
    @Param('userId') userId: string,
    @Body() dto: ReviewTerritorialAccessDto = {},
    @Request() req: any,
  ) {
    return this.rejectTerritorialAccess(userId, dto.reason, req.user);
  }

  @Post('territorial-access-requests/:userId/revoke')
  @ApiBearerAuth()
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Revocar acceso territorial',
    description: 'Revoca un acceso territorial aprobado.',
  })
  @ApiParam({ name: 'userId', description: 'ID del usuario territorial.' })
  @ApiBody({ type: ReviewTerritorialAccessDto })
  async revokeTerritorialAccess(
    @Param('userId') userId: string,
    @Body() dto: ReviewTerritorialAccessDto = {},
    @Request() req: any,
  ) {
    const user = await this.getTerritorialUserOrThrow(userId, req.user);
    const status = this.resolveTerritorialStatus(user);

    if (status !== 'APPROVED') {
      throw new BadRequestException('Solo se puede revocar un acceso territorial aprobado');
    }

    user.territorialAccessStatus = 'REVOKED';
    user.territorialRevokedAt = new Date();
    user.territorialApprovedAt = null;
    user.territorialRejectedAt = null;
    user.territorialReason = dto.reason ?? null;
    user.territorialApprovedBy = req.user?.sub ? new Types.ObjectId(req.user.sub) : null;
    await user.save();
    await this.authService.syncUserActiveState(user._id);

    return {
      message: 'Acceso territorial revocado',
      user: this.toTerritorialAccessResponse(user),
    };
  }

  @Post('territorial-access-requests/:userId/reopen')
  @ApiBearerAuth()
  @UseGuards(AccessApproverGuard)
  @ApiOperation({
    summary: 'Reabrir solicitud territorial',
    description: 'Regresa una solicitud territorial rechazada o revocada a pendiente de aprobación.',
  })
  @ApiParam({ name: 'userId', description: 'ID del usuario territorial.' })
  @ApiBody({ type: ReviewTerritorialAccessDto })
  async reopenTerritorialAccess(
    @Param('userId') userId: string,
    @Body() dto: ReviewTerritorialAccessDto = {},
    @Request() req: any,
  ) {
    const user = await this.getTerritorialUserOrThrow(userId, req.user);
    const status = this.resolveTerritorialStatus(user);

    if (!['REJECTED', 'REVOKED'].includes(status)) {
      throw new BadRequestException(
        'Solo se pueden reabrir solicitudes territoriales rechazadas o revocadas',
      );
    }

    user.territorialAccessStatus = 'PENDING_APPROVAL';
    user.territorialApprovedAt = null;
    user.territorialRejectedAt = null;
    user.territorialRevokedAt = null;
    user.territorialReason = null;
    user.territorialApprovedBy = null;
    await user.save();
    await this.authService.syncUserActiveState(user._id);

    return {
      message: dto.reason
        ? 'Solicitud territorial reabierta'
        : 'Solicitud territorial regresada a pendiente de aprobación',
      user: this.toTerritorialAccessResponse(user),
    };
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
      'Crea un contrato que habilita a un alcalde o gobernador para operar en un territorio específico',
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

  @Get('public-active')
  @Public()
  @ApiOperation({
    summary: 'Listar contratos activos públicos por elección',
    description:
      'Retorna contratos activos de elecciones activas para consumo público (Home).',
  })
  @ApiQuery({ name: 'electionId', required: false, type: String })
  @ApiQuery({
    name: 'electionType',
    required: false,
    enum: ['municipal', 'departamental', 'presidential'],
  })
  @ApiResponse({
    status: 200,
    description: 'Contratos públicos activos obtenidos exitosamente',
  })
  async listPublicActive(
    @Query('electionId') electionId?: string,
    @Query('electionType') electionType?: string,
  ) {
    const data = await this.contractsService.findPublicActiveContracts({
      electionId,
      electionType,
    });
    return {
      data,
      total: data.length,
    };
  }

  /**
   * M1: Verificar cobertura para un territorio
   */
  @Post('check-coverage')
  @ApiOperation({
    summary: 'Verificar si existe cobertura activa para un territorio',
    description:
      'Usado por la app móvil para habilitar o deshabilitar el atestiguamiento según la cobertura contratada',
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
      throw new Error('electionId es obligatorio');
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
    description: 'Distancia máxima en metros (por defecto: 10000)',
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

  private async getTerritorialUserOrThrow(
    userId: string,
    requester?: any,
  ): Promise<RoledUserDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('userId inválido');
    }

    const user = await this.roledUserModel.findById(userId);
    if (
      requester?.role === 'ACCESS_APPROVER' &&
      user &&
      !['MAYOR', 'GOVERNOR'].includes(user.role)
    ) {
      throw new NotFoundException('Solicitud territorial no encontrada');
    }
    if (!user || !['MAYOR', 'GOVERNOR'].includes(user.role)) {
      throw new NotFoundException('Solicitud territorial no encontrada');
    }

    return user;
  }

  private async approveTerritorialAccess(userId: string, requester: any) {
    const user = await this.getTerritorialUserOrThrow(userId, requester);
    const status = this.resolveTerritorialStatus(user);

    if (status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        'Solo se puede aprobar una solicitud territorial pendiente de aprobación',
      );
    }

    user.territorialAccessStatus = 'APPROVED';
    user.territorialApprovedAt = new Date();
    user.territorialRejectedAt = null;
    user.territorialRevokedAt = null;
    user.territorialReason = null;
    user.territorialApprovedBy = requester?.sub ? new Types.ObjectId(requester.sub) : null;
    await user.save();
    await this.authService.syncUserActiveState(user._id);

    return {
      message: 'Usuario aprobado exitosamente',
      user: this.toTerritorialAccessResponse(user),
    };
  }

  private async rejectTerritorialAccess(
    userId: string,
    reason: string | undefined,
    requester: any,
  ) {
    const user = await this.getTerritorialUserOrThrow(userId, requester);
    const status = this.resolveTerritorialStatus(user);

    if (status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        'Solo se puede rechazar una solicitud territorial pendiente de aprobación',
      );
    }

    user.territorialAccessStatus = 'REJECTED';
    user.territorialRejectedAt = new Date();
    user.territorialApprovedAt = null;
    user.territorialRevokedAt = null;
    user.territorialReason = reason ?? null;
    user.territorialApprovedBy = requester?.sub ? new Types.ObjectId(requester.sub) : null;
    await user.save();
    await this.authService.syncUserActiveState(user._id);

    return {
      message: 'Usuario rechazado',
      user: this.toTerritorialAccessResponse(user),
    };
  }

  private resolveTerritorialStatus(user: any) {
    if (user.territorialAccessStatus && user.territorialAccessStatus !== 'NONE') {
      return user.territorialAccessStatus;
    }

    if ((user.role === 'MAYOR' || user.role === 'GOVERNOR') && user.active) {
      return 'APPROVED';
    }

    return 'NONE';
  }

  private toTerritorialAccessResponse(user: any) {
    return {
      id: user._id.toString(),
      dni: user.dni,
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active,
      territorialAccessStatus: this.resolveTerritorialStatus(user),
      emailVerified: !user.verificationToken,
      territory: {
        departmentId: user.votingDepartmentId?.toString() ?? null,
        municipalityId: user.votingMunicipalityId?.toString() ?? null,
      },
      approvedAt: user.territorialApprovedAt ?? null,
      rejectedAt: user.territorialRejectedAt ?? null,
      revokedAt: user.territorialRevokedAt ?? null,
      reason: user.territorialReason ?? null,
      createdAt: user.createdAt ?? null,
      updatedAt: user.updatedAt ?? null,
    };
  }
}
