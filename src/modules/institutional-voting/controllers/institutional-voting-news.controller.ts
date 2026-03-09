import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateEventNewsDto } from '../dto/event-news.dto';
import { InstitutionalVotingService } from '../services/institutional-voting.service';

@ApiTags('Institutional Voting News')
@Controller('api/v1/voting/events')
export class InstitutionalVotingNewsController {
  constructor(private readonly institutionalVotingService: InstitutionalVotingService) {}

  @Post(':eventId/news')
  @ApiOperation({
    summary: 'Publicar noticia/notificación del evento',
    description:
      'Envía noticia segmentada a empadronados del padrón vigente (si comparison report está OK).',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento.' })
  @ApiBody({ type: CreateEventNewsDto })
  @ApiResponse({ status: 201, description: 'Noticia procesada y notificaciones enviadas.' })
  publishNews(
    @Param('eventId') eventId: string,
    @Body() dto: CreateEventNewsDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.publishNews(eventId, dto, req.user);
  }
}
