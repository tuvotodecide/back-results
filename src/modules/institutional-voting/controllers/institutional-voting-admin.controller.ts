import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
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
import { UpdateEventRoleDto } from '../dto/update-event-role.dto';
import { UpdateOptionCandidatesDto } from '../dto/update-option-candidates.dto';
import { UpdateVotingEventDto } from '../dto/update-voting-event.dto';
import { UpdateVotingOptionDto } from '../dto/update-voting-option.dto';
import { CreateVotingOptionDto } from '../dto/voting-option.dto';

@ApiTags('Institutional Voting Admin')
@Controller('api/v1/voting/events')
export class InstitutionalVotingAdminController {
  constructor(private readonly institutionalVotingService: InstitutionalVotingService) {}

  @Get()
  listEvents(@Req() req: any, @Query('tenantId') tenantId?: string) {
    return this.institutionalVotingService.listEvents(req.user, tenantId);
  }

  @Post()
  @UseGuards(ZkAuthGuard)
  createEvent(@Body() dto: CreateVotingEventDto, @Req() req: any) {
    return this.institutionalVotingService.createEvent(dto, req.user);
  }

  @Get(':eventId')
  getEventDetail(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.getEventDetail(eventId, req.user);
  }

  @Patch(':eventId')
  @UseGuards(ZkAuthGuard)
  updateEvent(@Param('eventId') eventId: string, @Body() dto: UpdateVotingEventDto, @Req() req: any) {
    return this.institutionalVotingService.updateEvent(eventId, dto, req.user);
  }

  @Delete(':eventId')
  @UseGuards(ZkAuthGuard)
  deleteEvent(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.deleteEvent(eventId, req.user);
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

  @Get(':eventId/roles')
  listRoles(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.listRoles(eventId, req.user);
  }

  @Patch(':eventId/roles/:roleId')
  @UseGuards(ZkAuthGuard)
  updateRole(
    @Param('eventId') eventId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateEventRoleDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.updateRole(eventId, roleId, dto, req.user);
  }

  @Delete(':eventId/roles/:roleId')
  @UseGuards(ZkAuthGuard)
  deleteRole(
    @Param('eventId') eventId: string,
    @Param('roleId') roleId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.deleteRole(eventId, roleId, req.user);
  }

  @Post(':eventId/options')
  @UseGuards(ZkAuthGuard)
  createOption(@Param('eventId') eventId: string, @Body() dto: CreateVotingOptionDto, @Req() req: any) {
    return this.institutionalVotingService.createOption(eventId, dto, req.user);
  }

  @Get(':eventId/options')
  listOptions(@Param('eventId') eventId: string, @Req() req: any) {
    return this.institutionalVotingService.listOptions(eventId, req.user);
  }

  @Patch(':eventId/options/:optionId')
  @UseGuards(ZkAuthGuard)
  updateOption(
    @Param('eventId') eventId: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateVotingOptionDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.updateOption(eventId, optionId, dto, req.user);
  }

  @Put(':eventId/options/:optionId/candidates')
  @UseGuards(ZkAuthGuard)
  replaceOptionCandidates(
    @Param('eventId') eventId: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateOptionCandidatesDto,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.replaceOptionCandidates(
      eventId,
      optionId,
      dto,
      req.user,
    );
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

  @Delete(':eventId/options/:optionId')
  @UseGuards(ZkAuthGuard)
  deleteOption(
    @Param('eventId') eventId: string,
    @Param('optionId') optionId: string,
    @Req() req: any,
  ) {
    return this.institutionalVotingService.deleteOption(eventId, optionId, req.user);
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

  @Get(':eventId/padron/voters')
  listCurrentPadronVoters(
    @Param('eventId') eventId: string,
    @Req() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.institutionalVotingService.listCurrentPadronVoters(
      eventId,
      req.user,
      Number(page),
      Number(limit),
    );
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
