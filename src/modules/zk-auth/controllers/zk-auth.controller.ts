import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZkAuthService } from '../services/zk-auth.service';
import { AuthorizationRequestMessage, AuthorizationResponseMessage } from '@iden3/js-iden3-auth/dist/types/types-sdk';
import { Request } from 'express';

@ApiTags('ZK Auth')
@Controller('api/v1/zk-auth')
export class ZkAuthController {
  constructor(private readonly zkAuthService: ZkAuthService) {}

  @Get('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a new ZK API key' })
  @ApiResponse({ status: 201, description: 'API key generated' })
  async requestApiKey(): Promise<{ apiKey: string; request: AuthorizationRequestMessage }> {
    return this.zkAuthService.generateRequest();
  }

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ZK Auth callback endpoint' })
  @ApiResponse({ status: 200, description: 'Verification successful' })
  async zkAuthCallback(
    @Query('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<AuthorizationResponseMessage> {
    const zkProof = req.read().toString().trim()
    return this.zkAuthService.zkAuthCallback(sessionId, zkProof);
  }

}
