import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';
import { Public } from '@/core/decorators/public.decorator';
import { ScanPresentialSessionDto } from '../dto/presential-session.dto';
import { InstitutionalVotingService } from '../services/institutional-voting.service';

@ApiTags('Institutional Voting Presential QR')
@Controller('api/v1/voting')
export class InstitutionalVotingPresentialController {
  constructor(private readonly institutionalVotingService: InstitutionalVotingService) {}

  @Get('events/:eventId/presential-sessions/current')
  @Public()
  @ApiOperation({
    summary: 'Obtiene el estado actual del kiosco presencial y el QR vigente si existe',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento de votación.' })
  @ApiQuery({
    name: 'stationId',
    required: false,
    description:
      'Identificador lógico del kiosco/estación. Si no se envía, se usa "kiosco-principal".',
  })
  @ApiHeader({
    name: 'x-kiosk-token',
    required: false,
    description:
      'Token limitado del kiosco. En rutas públicas también se acepta Bearer válido del tenant/admin.',
  })
  @ApiResponse({ status: 200, description: 'Estado actual del kiosco.' })
  current(
    @Param('eventId') eventId: string,
    @Query('stationId') stationId: string | undefined,
    @Headers('x-kiosk-token') kioskToken: string | undefined,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.getCurrentPresentialSessionState(
      eventId,
      stationId,
      kioskToken,
      req.user,
    );
  }

  @Sse('events/:eventId/presential-sessions/stream')
  @Public()
  @ApiOperation({
    summary: 'Stream SSE del kiosco presencial limitado a una elección/estación',
  })
  @ApiParam({ name: 'eventId', description: 'ID del evento de votación.' })
  @ApiQuery({
    name: 'stationId',
    required: false,
    description:
      'Identificador lógico del kiosco/estación. Si no se envía, se usa "kiosco-principal".',
  })
  @ApiHeader({
    name: 'x-kiosk-token',
    required: false,
    description:
      'Token limitado del kiosco. En rutas públicas también se acepta Bearer válido del tenant/admin.',
  })
  stream(
    @Param('eventId') eventId: string,
    @Query('stationId') stationId: string | undefined,
    @Headers('x-kiosk-token') kioskToken: string | undefined,
    @Req() req: any,
  ): Observable<MessageEvent> {
    return from(
      this.institutionalVotingService.createPresentialSessionStream(
        eventId,
        stationId,
        kioskToken,
        req.user,
      ),
    ).pipe(mergeMap((stream) => stream));
  }

  @Post('presential-sessions/scan')
  @Public()
  @ApiOperation({
    summary: 'Scan/claim desde app móvil del QR presencial del kiosco',
  })
  @ApiBody({ type: ScanPresentialSessionDto })
  @ApiResponse({
    status: 201,
    description: 'Sesión presencial reclamada correctamente para continuar el voto.',
  })
  @ApiResponse({
    status: 200,
    description: 'Respuesta idempotente: la misma persona ya había reclamado esta sesión.',
  })
  async scan(
    @Body() dto: ScanPresentialSessionDto,
    @Res() res: Response,
  ) {
    const out = await this.institutionalVotingService.scanPresentialSession(dto);
    return res.status(out.statusCode).json(out.body);
  }
}
