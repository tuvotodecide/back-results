import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import { InstitutionalVotingService } from '../services/institutional-voting.service';
import { CreateVotingEventDto } from '../dto/create-voting-event.dto';
import { CreateEventRoleDto } from '../dto/event-role.dto';
import { UpdatePublicEligibilityDto } from '../dto/public-eligibility-toggle.dto';
import { UpsertEventResultsSnapshotDto } from '../dto/results-snapshot.dto';
import { CreateVotingOptionDto } from '../dto/voting-option.dto';

@ApiTags('Institutional Voting Admin')
@Controller('api/v1/voting/events')
export class InstitutionalVotingAdminController {
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

  @Patch(':eventId/public-eligibility')
  @UseGuards(ZkAuthGuard)
  setPublicEligibility(
    @Param('eventId') eventId: string,
    @Body() body: UpdatePublicEligibilityDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.setPublicEligibility(eventId, body.enabled, req.user);
  }

  @Get(':eventId/padron/versions')
  listPadronVersions(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.listPadronVersions(eventId, req.user);
  }

  @Get(':eventId/results')
  getResults(@Param('eventId') eventId: string) {
    return this.institutionalVotingService.getResults(eventId);
  }

  @Post(':eventId/results/snapshot')
  @UseGuards(ZkAuthGuard)
  upsertResultsSnapshot(
    @Param('eventId') eventId: string,
    @Body() dto: UpsertEventResultsSnapshotDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.upsertResultsSnapshot(eventId, dto, req.user);
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
