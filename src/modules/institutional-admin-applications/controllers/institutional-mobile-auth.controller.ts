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
import { OfficialPublicationMobileRateLimitGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-rate-limit.guard';
import { InstitutionalMobileZkAuthService } from '../auth/institutional-mobile-zk-auth.service';

type InstitutionalMobileAuthRequestResponse = {
  apiKey: string;
  request: Record<string, unknown>;
  expiresAt: string;
};

@ApiTags('Institutional Mobile Auth')
@UseGuards(OfficialPublicationMobileRateLimitGuard)
@Controller('api/v1/mobile/institutional-authorizations/auth')
export class InstitutionalMobileAuthController {
  private readonly logger = new Logger(InstitutionalMobileAuthController.name);

  constructor(private readonly authService: InstitutionalMobileZkAuthService) {}

  @Get(':applicationId/request')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar auth request ZK para autorización institucional móvil' })
  @ApiParam({ name: 'applicationId', description: 'ID de la autorización institucional.' })
  @ApiResponse({ status: 200, description: 'Auth request generado.' })
  async createRequest(
    @Param('applicationId') applicationId: string,
  ): Promise<InstitutionalMobileAuthRequestResponse> {
    const response = await this.authService.createAuthRequest(applicationId);
    return response as unknown as InstitutionalMobileAuthRequestResponse;
  }

  @Get('invitations/:invitationId/request')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar auth request ZK para una invitación institucional móvil' })
  @ApiParam({ name: 'invitationId', description: 'ID de la invitación institucional.' })
  @ApiResponse({ status: 200, description: 'Auth request generado.' })
  async createInvitationRequest(
    @Param('invitationId') invitationId: string,
  ): Promise<InstitutionalMobileAuthRequestResponse> {
    const response = await this.authService.createInvitationAuthRequest(invitationId);
    return response as unknown as InstitutionalMobileAuthRequestResponse;
  }

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Callback ZK para autorización institucional móvil' })
  @ApiResponse({ status: 200, description: 'Prueba verificada.' })
  async callback(
    @Query('sessionId') sessionId: string,
    @Body() body: string,
  ): Promise<Record<string, unknown>> {
    this.logger.log('[REDACTED_INSTITUTIONAL_ZK_AUTH_RESPONSE]');
    return this.authService.callback(sessionId, body) as unknown as Record<string, unknown>;
  }
}
