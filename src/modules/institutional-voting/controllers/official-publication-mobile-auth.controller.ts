import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { OfficialPublicationMobileZkAuthService } from '../auth/official-publication-mobile-zk-auth.service';
import { OfficialPublicationMobileRateLimitGuard } from '../auth/official-publication-mobile-rate-limit.guard';

type OfficialPublicationMobileAuthRequestResponse = {
  apiKey: string;
  request: Record<string, unknown>;
  expiresAt: string;
};

@ApiTags('Official Publication Mobile Auth')
@UseGuards(OfficialPublicationMobileRateLimitGuard)
@Controller('api/v1/mobile/official-publication/auth')
export class OfficialPublicationMobileAuthController {
  private readonly logger = new Logger(OfficialPublicationMobileAuthController.name);

  constructor(
    private readonly authService: OfficialPublicationMobileZkAuthService,
  ) {}

  @Get(':requestId/request')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar auth request ZK aislado para publicacion oficial movil' })
  @ApiParam({ name: 'requestId', description: 'ID publico de la solicitud.' })
  @ApiResponse({ status: 200, description: 'Auth request generado.' })
  async createRequest(
    @Param('requestId') requestId: string,
  ): Promise<OfficialPublicationMobileAuthRequestResponse> {
    const response = await this.authService.createAuthRequest(requestId);
    return response as unknown as OfficialPublicationMobileAuthRequestResponse;
  }

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Callback ZK aislado para publicacion oficial movil' })
  @ApiResponse({ status: 200, description: 'Prueba verificada.' })
  async callback(
    @Query('sessionId') sessionId: string,
    @Body() body: string,
  ): Promise<Record<string, unknown>> {
    this.logger.log('[REDACTED_ZK_AUTH_RESPONSE]');
    const response = await this.authService.callback(sessionId, body);
    return response as unknown as Record<string, unknown>;
  }
}
