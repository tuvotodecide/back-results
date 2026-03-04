import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import { InstitutionalVotingService } from '../services/institutional-voting.service';
import { CreateVotingEventDto } from '../dto/create-voting-event.dto';
import { CreateEventRoleDto } from '../dto/event-role.dto';
import { CreateVotingOptionDto } from '../dto/voting-option.dto';
import { CreateParticipationDto } from '../dto/participation.dto';
import { Response } from 'express';

@ApiTags('Institutional Voting')
@Controller('api/v1/voting/events')
export class InstitutionalVotingController {
  constructor(private readonly institutionalVotingService: InstitutionalVotingService) {}

  @Post()
  @UseGuards(ZkAuthGuard)
  createEvent(@Body() dto: CreateVotingEventDto, @Req() req: any) {
    return this.institutionalVotingService.createEvent(dto, req.user);
  }

  @Post(':eventId/publish')
  @UseGuards(ZkAuthGuard)
  publishEvent(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.publishEvent(eventId, req.user);
  }

  @Post(':eventId/roles')
  @UseGuards(ZkAuthGuard)
  createRole(@Param('eventId') eventId: string, @Body() dto: CreateEventRoleDto, @Req() req: any) {
    return this.institutionalVotingService.createRole(eventId, dto, req.user);
  }

  @Post(':eventId/options')
  @UseGuards(ZkAuthGuard)
  createOption(@Param('eventId') eventId: string, @Body() dto: CreateVotingOptionDto, @Req() req: any) {
    return this.institutionalVotingService.createOption(eventId, dto, req.user);
  }

  @Patch(':eventId/options/:optionId/deactivate')
  @UseGuards(ZkAuthGuard)
  deactivateOption(
    @Param('eventId') eventId: string,
    @Param('optionId') optionId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.deactivateOption(eventId, optionId, req.user);
  }

  @Post(':eventId/padron/import')
  @UseGuards(ZkAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  importPadron(
    @Param('eventId') eventId: string,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }
    return this.institutionalVotingService.importPadron(
      eventId,
      file.buffer.toString('utf-8'),
      req.user,
    );
  }

  @Patch(':eventId/schedule')
  @UseGuards(ZkAuthGuard)
  updateSchedule(
    @Param('eventId') eventId: string,
    @Body() body: { votingStart?: string; votingEnd?: string; resultsPublishAt?: string },
    @Req() req: any,
  ) {
    return this.institutionalVotingService.updateSchedule(eventId, body, req.user);
  }

  @Get(':eventId/padron/versions')
  listPadronVersions(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.listPadronVersions(eventId, req.user);
  }

  @Get(':eventId/eligibility')
  @Public()
  eligibility(
    @Param('eventId') eventId: string,
    @Query('carnet') carnet: string,
  ) {
    return this.institutionalVotingService.checkEligibility(eventId, carnet);
  }

  @Get(':eventId/eligibility/public')
  @Public()
  publicEligibility(
    @Param('eventId') eventId: string,
    @Query('carnet') carnet: string,
  ) {
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
  participationStatus(
    @Param('eventId') eventId: string,
    @Query('carnet') carnet: string,
  ) {
    return this.institutionalVotingService.checkParticipationStatus(eventId, carnet);
  }

  @Get(':eventId/results')
  getResults(@Param('eventId') eventId: string) {
    return this.institutionalVotingService.getResults(eventId);
  }

  @Post(':eventId/comparison-report/status')
  @UseGuards(ZkAuthGuard)
  @HttpCode(200)
  updateComparisonStatus(
    @Param('eventId') eventId: string,
    @Body('status') status: 'PENDING' | 'OK' | 'FAILED',
    @Req() req: any,
  ) {
    return this.institutionalVotingService.updateComparisonReportStatus(
      eventId,
      status,
      req.user,
    );
  }
}
