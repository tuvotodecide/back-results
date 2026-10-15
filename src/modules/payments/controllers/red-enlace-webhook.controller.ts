import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { RedEnlaceWebhookDto } from '../dto/red-enlace-webhook.dto';
import { RedEnlaceWebhookGuard } from '../guards/red-enlace-webhook.guard';
import { RedEnlaceWebhookService } from '../services/red-enlace-webhook.service';

// Red Enlace agrega o renombra campos sin aviso (envia ciNitCliente aunque su
// doc dice ciCliente). Se validan los campos conocidos y se descartan los
// demas, en vez del 400 que daria el forbidNonWhitelisted del pipe global.
const redEnlaceWebhookValidationPipe = new ValidationPipe({
  expectedType: RedEnlaceWebhookDto,
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

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
      'Ruta canonica: POST /api/v1/qr/confirmed. Ruta anterior: POST /api/v1/integrations/red-enlace/pay-in/webhook (deprecated temporalmente). Los campos no documentados se ignoran.',
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
  receiveWebhook(
    // Tipado como objeto plano para que el pipe global no lo valide; lo valida
    // y transforma redEnlaceWebhookValidationPipe.
    @Body(redEnlaceWebhookValidationPipe) dto: object,
  ) {
    return this.webhookService.receiveWebhook(dto as RedEnlaceWebhookDto);
  }
}
