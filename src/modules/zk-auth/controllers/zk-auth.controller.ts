import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZkAuthService } from '../services/zk-auth.service';
import { AuthorizationRequestMessage, AuthorizationResponseMessage } from '@iden3/js-iden3-auth/dist/types/types-sdk';
import { Request } from 'express';
import { Public } from '@/core/decorators/public.decorator';

@ApiTags('ZK Auth')
@Controller('api/v1/zk-auth')
export class ZkAuthController {
  constructor(private readonly zkAuthService: ZkAuthService) {}

  @Get('request')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a new ZK API key' })
  @ApiResponse({ status: 201, description: 'API key generated' })
  async requestApiKey(): Promise<{ apiKey: string; request: AuthorizationRequestMessage }> {
    return this.zkAuthService.getAuthRequest();
  }

  @Get('request/vote')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get ZK Auth request for voting' })
  @ApiResponse({ status: 200, description: 'ZK Auth request for voting generated' })
  async requestVoteAuth(): Promise<{ request: AuthorizationRequestMessage }> {
    return this.zkAuthService.getVoteRequest();
  }

  @Get('request/claim-reward')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get ZK Auth request for claim reward' })
  @ApiResponse({ status: 200, description: 'ZK Auth request for claim generated' })
  async requestClaimReward(): Promise<{ request: AuthorizationRequestMessage }> {
    return this.zkAuthService.getRewardRequest();
  }

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ZK Auth callback endpoint' })
  @ApiResponse({ status: 200, description: 'Verification successful' })
  async zkAuthCallback(
    @Query('sessionId') sessionId: string,
    @Body() body: string,
  ): Promise<AuthorizationResponseMessage> {
    const zkProof = body;
    return this.zkAuthService.zkAuthCallback(sessionId, zkProof);
  }

}
