import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { RegisterUserByDniDto, UserResponseDto } from '../dto/users.dto';
import {
  UpdateVotePlaceDto,
  VotePlaceResponseDto,
} from '../dto/update-vote-place.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { AttestParticipationDto, AttestParticipationResponseDto, ParticipationCertificateDto } from '../dto/attest-participation.dto';

@ApiTags('Users')
@Controller('api/v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @InjectModel(NotificationLog.name)
    private logModel: Model<NotificationLog>,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un usuario por DNI' })
  @ApiBody({
    schema: {
      properties: { dni: { type: 'string', example: '12345678' } },
      required: ['dni'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado o existente',
    type: UserResponseDto,
  })
  async register(@Body() body: RegisterUserByDniDto) {
    const user = await this.usersService.findOrCreateByDni(body.dni);
    return {
      _id: user._id.toString(),
      dni: user.dni,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @Get(':dni')
  @ApiOperation({ summary: 'Obtener usuario por DNI' })
  @ApiParam({ name: 'dni' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async getByDni(@Param('dni') dni: string) {
    const user = await this.usersService.findByDni(dni);
    return {
      _id: user._id.toString(),
      dni: user.dni,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @Patch(':dni/vote-place')
  @ApiOperation({
    summary: 'Guardar/editar recinto y/o mesa de votación para un DNI',
    description:
      'Permite editar parcialmente: solo locationId, solo tableId/tableCode o ambos. Si cambias de recinto y la mesa anterior no pertenece al nuevo recinto, la mesa se borra.',
  })
  @ApiParam({ name: 'dni' })
  @ApiBody({ type: UpdateVotePlaceDto })
  @ApiResponse({ status: 200, type: VotePlaceResponseDto })
  updateVotePlace(
    @Param('dni') dni: string,
    @Body() dto: UpdateVotePlaceDto,
  ): Promise<VotePlaceResponseDto> {
    return this.usersService.updateVotePlaceByDni(dni, dto);
  }

  @Get(':dni/vote-place')
  @ApiOperation({
    summary: 'Obtener recinto/mesa de votación del usuario por DNI',
  })
  @ApiParam({ name: 'dni' })
  @ApiResponse({ status: 200, type: VotePlaceResponseDto })
  getVotePlace(@Param('dni') dni: string): Promise<VotePlaceResponseDto> {
    return this.usersService.getVotePlaceByDni(dni);
  }

  @Get(':dni/notifications')
  @ApiOperation({
    summary: 'Notificaciones del usuario por DNI (topic del recinto elegido)',
  })
  @ApiParam({ name: 'dni' })
  @ApiResponse({ status: 200, description: 'Lista paginada' })
  async listNotificationsByDni(
    @Param('dni') dni: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const user = await this.usersService.findOrCreateByDni(dni);
    const locId = (user as any)?.votingLocationId?.toString();
    if (!locId) {
      return {
        data: [],
        total: 0,
        page: Number(page),
        limit: Number(limit),
        totalPages: 0,
      };
    }
    const topic = `loc_${String(locId).replace(/[^A-Za-z0-9_-]/g, '')}`;

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      this.logModel
        .find({ topic })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      this.logModel.countDocuments({ topic }),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }
  @Post(':dni/participation-nft')
  @ApiOperation({
    summary:
      'Emitir NFT de participación para un usuario (attest) y registrar el certificado',
    description:
      'Recibe DNI (path), account e imageUrl (body). Hace safeMint y guarda el certificado (sin address) asociado al usuario.',
  })
  @ApiParam({ name: 'dni' })
  @ApiBody({ type: AttestParticipationDto })
  @ApiResponse({ status: 201, type: AttestParticipationResponseDto })
  async attestParticipationNft(
    @Param('dni') dni: string,
    @Body() dto: AttestParticipationDto,
  ): Promise<AttestParticipationResponseDto> {
    return this.usersService.attestParticipationNft(dni, dto);
  }

  @Get(':dni/participation-certificates')
  @ApiOperation({
    summary: 'Listar certificados de participación (NFTs) por DNI',
  })
  @ApiParam({ name: 'dni' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        userId: { type: 'string' },
        dni: { type: 'string' },
        certificates: {
          type: 'array',
          items: { $ref: '#/components/schemas/ParticipationCertificateDto' },
        },
      },
    },
  })
  async listParticipationCertificates(@Param('dni') dni: string): Promise<{
    userId: string;
    dni: string;
    certificates: ParticipationCertificateDto[];
  }> {
    return this.usersService.listParticipationCertificatesByDni(dni) as any;
  }
}
