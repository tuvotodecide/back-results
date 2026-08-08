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
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import {
  RegisterUserByDniDto,
  RewardNewUserQueryDto,
  UserResponseDto,
} from '../dto/users.dto';
import {
  UpdateVotePlaceDto,
  VotePlaceResponseDto,
} from '../dto/update-vote-place.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';
import {
  AttestParticipationDto,
  AttestParticipationResponseDto,
  ParticipationCertificateDto,
} from '../dto/attest-participation.dto';
import { Public } from '@/core/decorators/public.decorator';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';

@ApiTags('Users')
@Controller('api/v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @InjectModel(NotificationLog.name)
    private logModel: Model<NotificationLog>,
    @InjectModel(UserNotification.name)
    private userNotifModel: Model<UserNotification>,
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

  @Post('reward-new-user')
  @UseGuards(ZkAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Recompensar nuevo registro de usuario' })
  @ApiResponse({ status: 201, description: 'Recompensa otorgada' })
  async rewardNewUser(@Query() query: RewardNewUserQueryDto) {
    await this.usersService.rewardNewUser(query.recipient);
  }

  @Get(':dni')
  @Public()
  @UseGuards(ZkAuthGuard)
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
  @Public()
  @UseGuards(ZkAuthGuard)
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
  @Public()
  @ApiOperation({
    summary: 'Obtener recinto/mesa de votación del usuario por DNI',
  })
  @ApiParam({ name: 'dni' })
  @ApiResponse({ status: 200, type: VotePlaceResponseDto })
  getVotePlace(@Param('dni') dni: string): Promise<VotePlaceResponseDto> {
    return this.usersService.getVotePlaceByDni(dni);
  }

  @Get(':dni/notifications')
  @Public()
  @UseGuards(ZkAuthGuard)
  @ApiOperation({
    summary:
      'Notificaciones del usuario por DNI (topic del recinto y fallback por usuario)',
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

    const topics: string[] = [];
    if (locId) {
      const safeLoc = String(locId).replace(/[^A-Za-z0-9_-]/g, '');
      topics.push(`loc_${safeLoc}`);
    }
    topics.push(`user_${user._id.toString()}`);

    const skip = (Number(page) - 1) * Number(limit);

    const fetchLimit = Math.max(skip + Number(limit), Number(limit));
    const [logs, userNotifications, logTotal, userNotificationTotal] = await Promise.all([
      this.logModel
        .find({ topic: { $in: topics } })
        .sort({ createdAt: -1, _id: -1 }) // _id como respaldo
        .limit(fetchLimit)
        .lean(),
      this.userNotifModel
        .find({ userId: user._id })
        .sort({ createdAt: -1, _id: -1 })
        .limit(fetchLimit)
        .lean(),
      this.logModel.countDocuments({ topic: { $in: topics } }),
      this.userNotifModel.countDocuments({ userId: user._id }),
    ]);
    const merged = this.mergeNotificationRows(logs, userNotifications);
    const data = merged.slice(skip, skip + Number(limit));
    const total = Math.max(merged.length, logTotal, userNotificationTotal);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }

  private mergeNotificationRows(
    logs: any[] = [],
    userNotifications: any[] = [],
  ) {
    const seen = new Set<string>();
    return [...logs, ...userNotifications]
      .sort((a, b) => {
        const bTime = new Date(b.createdAt ?? 0).getTime();
        const aTime = new Date(a.createdAt ?? 0).getTime();
        return bTime - aTime;
      })
      .filter((row) => {
        const key =
          row?.data?.deduplicationKey ||
          row?.data?.notificationId ||
          row?.messageId ||
          String(row?._id ?? '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  @Post(':dni/participation-nft')
  @Public()
  @UseGuards(ZkAuthGuard)
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
    const result = await this.usersService.attestParticipationNft(dni, dto);

    try {
      const user = await this.usersService.findOrCreateByDni(dni);
      // Notificación personal: evitar duplicados en la bandeja por topic de ubicación.
      const topics: string[] = [`user_${user._id.toString()}`];

      const routeParamsPayload: Record<string, unknown> = {
        certificateData: {
          imageUrl: result.imageUrl,
        },
        nftData: {
          nftUrl: result.imageUrl,
        },
      };
      if (result.ipfsUri || result.actaImageUrl) {
        routeParamsPayload.ipfsData = {
          jsonUrl: result.ipfsUri || undefined,
          imageUrl: result.actaImageUrl || undefined,
          ipfsUri: result.ipfsUri || undefined,
        };
      }

      const notificationType =
        dto.notificationType === 'participation_certificate'
          ? 'participation_certificate'
          : 'acta_published';
      const mesaLabel = String(dto.tableNumber || dto.tableCode || '').trim();
      const isParticipation = notificationType === 'participation_certificate';

      const payload = {
        title: isParticipation
          ? 'Atestiguamiento exitoso'
          : 'Acta subida exitosamente',
        body: isParticipation
          ? mesaLabel
            ? `Atestiguamiento exitoso.`
            : 'Tu atestiguamiento se registró correctamente.'
          : mesaLabel
            ? `Tu acta de la mesa ${mesaLabel} fue publicada correctamente.`
            : 'Tu acta fue publicada correctamente.',
        data: {
          type: notificationType,
          dni: user.dni,
          userId: user._id.toString(),
          electionId: result.electionId ?? '',
          imageUrl: result.imageUrl,
          ipfsUri: result.ipfsUri ?? '',
          actaImageUrl: result.actaImageUrl ?? '',
          tableCode: dto.tableCode ?? '',
          tableNumber: dto.tableNumber ?? '',
          txHash: result.txHash,
          chainId: result.chainId,
          contractAddress: result.contractAddress,
          screen: 'SuccessScreen',
          routeParams: JSON.stringify(routeParamsPayload),
        },
      };

      await Promise.all(
        topics.map((topic) =>
          this.logModel.create({
            type: 'generic',
            topic,
            title: payload.title,
            body: payload.body,
            data: payload.data,
            status: 'SENT', 
          }),
        ),
      );
    } catch (e) {
      // no romper el flujo si falla el log
    }

    return result;
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
