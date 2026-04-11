import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DirectPushService } from '../services/direct-push.service';
import { DirectPushDto } from '../dto/direct-push.dto';
import { NotificationLog } from '../schemas/notification-log.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '@/modules/users/schemas/user.schema';

@ApiTags('InternalPush')
@Controller('internal')
export class InternalPushController {
  constructor(
    private readonly direct: DirectPushService,
    @InjectModel(NotificationLog.name)
    private logModel: Model<NotificationLog>,
    @InjectModel(User.name)
    private userModel: Model<User>,
  ) {}

  @Post('push')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Recibe eventos de identidad y reenvía push a tokens FCM',
  })
  async push(
    @Headers('x-internal-secret') secret: string,
    @Body() dto: DirectPushDto,
  ) {
    // Mantener este contrato tal cual hasta validar a todos los emisores de
    // eventos internos que dependen de este header y de su semántica actual.
    if (secret !== process.env.INTERNAL_PUSH_SECRET) {
      throw new UnauthorizedException('bad secret');
    }

    await this.direct.sendToTokens(dto.tokens, dto.notification, dto.data);

    try {
      let topic = 'generic';

      // Preferimos userId si viene en data (recomendado)
      if (dto.data && dto.data['userId']) {
        const userId = dto.data['userId'];
        topic = `user_${userId}`;
      } else if (dto.data && dto.data['dni']) {
        // Fallback: buscar el usuario por DNI
        const dni = dto.data['dni'];
        const user = await this.userModel.findOne({ dni }, { _id: 1 }).lean();
        if (user?._id) {
          topic = `user_${user._id.toString()}`;
        } else {
          topic = `identity_${dni}`;
        }
      }

      await this.logModel.create({
        type: 'generic',
        topic,
        title: dto.notification.title,
        body: dto.notification.body,
        data: dto.data,
        status: 'SENT',
      });
    } catch (e) {
      // No romper si falla el log
    }

    return { success: true };
  }
}
