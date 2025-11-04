
import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DirectPushService } from '../services/direct-push.service';
import { DirectPushDto } from '../dto/direct-push.dto';

@ApiTags('InternalPush')
@Controller('internal')
export class InternalPushController {
  constructor(private readonly direct: DirectPushService) {}

  @Post('push')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Recibe eventos de identidad y reenvía push a tokens FCM' })
  async push(
    @Headers('x-internal-secret') secret: string,
    @Body() dto: DirectPushDto,
  ) {
    if (secret !== process.env.INTERNAL_PUSH_SECRET) {
      throw new UnauthorizedException('bad secret');
    }

    await this.direct.sendToTokens(dto.tokens, dto.notification, dto.data);

    return { success: true };
  }
}
