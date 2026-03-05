import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '@/core/decorators/public.decorator';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import { CreateParticipationDto } from '../dto/participation.dto';
import { InstitutionalVotingService } from '../services/institutional-voting.service';

@ApiTags('Institutional Voting Public')
@Controller('api/v1/voting/events')
export class InstitutionalVotingPublicController {
  constructor(private readonly institutionalVotingService: InstitutionalVotingService) {}

  @Get(':eventId/eligibility')
  @Public()
  eligibility(@Param('eventId') eventId: string, @Query('carnet') carnet: string) {
    return this.institutionalVotingService.checkEligibility(eventId, carnet);
  }

  @Get(':eventId/eligibility/public')
  @Public()
  publicEligibility(@Param('eventId') eventId: string, @Query('carnet') carnet: string) {
    return this.institutionalVotingService.checkPublicEligibility(eventId, carnet);
  }

  @Post(':eventId/participations')
  @Public()
  @UseGuards(ZkAuthGuard)
  async createParticipation(
    @Param('eventId') eventId: string,
    @Body() dto: CreateParticipationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res() res: Response,
  ) {
    const out = await this.institutionalVotingService.createParticipation(
      eventId,
      dto,
      idempotencyKey,
    );

    return res.status(out.statusCode).json(out.body);
  }

  @Get(':eventId/participations/status')
  @Public()
  participationStatus(@Param('eventId') eventId: string, @Query('carnet') carnet: string) {
    return this.institutionalVotingService.checkParticipationStatus(eventId, carnet);
  }
}
