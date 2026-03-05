import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import { CreateEventNewsDto } from '../dto/event-news.dto';
import { InstitutionalVotingService } from '../services/institutional-voting.service';

@ApiTags('Institutional Voting News')
@Controller('api/v1/voting/events')
export class InstitutionalVotingNewsController {
  constructor(private readonly institutionalVotingService: InstitutionalVotingService) {}

  @Post(':eventId/news')
  @UseGuards(ZkAuthGuard)
  publishNews(
    @Param('eventId') eventId: string,
    @Body() dto: CreateEventNewsDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.publishNews(eventId, dto, req.user);
  }
}
