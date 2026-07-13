import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { RedEnlaceWebhookDto } from '../dto/red-enlace-webhook.dto';
import { RedEnlaceWebhookGuard } from '../guards/red-enlace-webhook.guard';
import { RedEnlaceWebhookService } from '../services/red-enlace-webhook.service';

@Controller('api/v1')
export class RedEnlaceWebhookController {
  constructor(private readonly webhookService: RedEnlaceWebhookService) {}

  @Public()
  @UseGuards(RedEnlaceWebhookGuard)
  @Post([
    'qr/confirmed',
    'integrations/red-enlace/pay-in/webhook',
  ])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Callback QR Red Enlace confirmado',
    description:
      'Ruta canonica: POST /api/v1/qr/confirmed. Ruta anterior: POST /api/v1/integrations/red-enlace/pay-in/webhook (deprecated temporalmente).',
  })
  @ApiBody({ type: RedEnlaceWebhookDto })
  @ApiOkResponse({
    schema: {
      example: {
        numeroReferencia: 'REFERENCIA_ATC',
        codigoRespuesta: '00',
        detalleRespuesta: null,
      },
    },
  })
  receiveWebhook(@Body() dto: RedEnlaceWebhookDto) {
    return this.webhookService.receiveWebhook(dto);
  }
}
