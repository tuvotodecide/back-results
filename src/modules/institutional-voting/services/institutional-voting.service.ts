import { Injectable } from '@nestjs/common';
import { CreateVotingEventDto } from '../dto/create-voting-event.dto';
import { CreateEventNewsDto } from '../dto/event-news.dto';
import { CreateEventRoleDto } from '../dto/event-role.dto';
import { CreateParticipationDto } from '../dto/participation.dto';
import { UpsertEventResultsSnapshotDto } from '../dto/results-snapshot.dto';
import { UpdateEventRoleDto } from '../dto/update-event-role.dto';
import { UpdateOptionCandidatesDto } from '../dto/update-option-candidates.dto';
import { UpdateVotingEventDto } from '../dto/update-voting-event.dto';
import { UpdateVotingOptionDto } from '../dto/update-voting-option.dto';
import { CreateVotingOptionDto } from '../dto/voting-option.dto';
import { VotingEventsService } from './events/voting-events.service';
import { PadronService } from './padron/padron.service';
import { ParticipationService } from './participation/participation.service';
import { VotingResultsService } from './results/voting-results.service';

@Injectable()
export class InstitutionalVotingService {
  constructor(
    private readonly votingEventsService: VotingEventsService,
    private readonly padronService: PadronService,
    private readonly participationService: ParticipationService,
    private readonly votingResultsService: VotingResultsService,
  ) {}

  createEvent(dto: CreateVotingEventDto, requester: any) {
    return this.votingEventsService.createEvent(dto, requester);
  }

  listEvents(requester: any, tenantId?: string) {
    return this.votingEventsService.listEvents(requester, tenantId);
  }

  getPublicLanding(tenantId?: string, limit?: number) {
    return this.votingEventsService.getPublicLanding(tenantId, limit);
  }

  getPublicEventDetail(eventId: string) {
    return this.votingEventsService.getPublicEventDetail(eventId);
  }

  checkPublicEligibilityAcrossEvents(carnet: string, tenantId?: string) {
    return this.votingEventsService.checkPublicEligibilityAcrossEvents(carnet, tenantId);
  }

  getEventDetail(eventId: string, requester: any) {
    return this.votingEventsService.getEventDetail(eventId, requester);
  }

  updateEvent(eventId: string, dto: UpdateVotingEventDto, requester: any) {
    return this.votingEventsService.updateEvent(eventId, dto, requester);
  }

  deleteEvent(eventId: string, requester: any) {
    return this.votingEventsService.deleteEvent(eventId, requester);
  }

  publishEvent(eventId: string, requester: any) {
    return this.votingEventsService.publishEvent(eventId, requester);
  }

  createRole(eventId: string, dto: CreateEventRoleDto, requester: any) {
    return this.votingEventsService.createRole(eventId, dto, requester);
  }

  listRoles(eventId: string, requester: any) {
    return this.votingEventsService.listRoles(eventId, requester);
  }

  updateRole(eventId: string, roleId: string, dto: UpdateEventRoleDto, requester: any) {
    return this.votingEventsService.updateRole(eventId, roleId, dto, requester);
  }

  deleteRole(eventId: string, roleId: string, requester: any) {
    return this.votingEventsService.deleteRole(eventId, roleId, requester);
  }

  publishNews(eventId: string, dto: CreateEventNewsDto, requester: any) {
    return this.votingEventsService.publishNews(eventId, dto, requester);
  }

  createOption(eventId: string, dto: CreateVotingOptionDto, requester: any) {
    return this.votingEventsService.createOption(eventId, dto, requester);
  }

  listOptions(eventId: string, requester: any) {
    return this.votingEventsService.listOptions(eventId, requester);
  }

  updateOption(
    eventId: string,
    optionId: string,
    dto: UpdateVotingOptionDto,
    requester: any,
  ) {
    return this.votingEventsService.updateOption(eventId, optionId, dto, requester);
  }

  replaceOptionCandidates(
    eventId: string,
    optionId: string,
    dto: UpdateOptionCandidatesDto,
    requester: any,
  ) {
    return this.votingEventsService.replaceOptionCandidates(eventId, optionId, dto, requester);
  }

  deactivateOption(eventId: string, optionId: string, requester: any) {
    return this.votingEventsService.deactivateOption(eventId, optionId, requester);
  }

  deleteOption(eventId: string, optionId: string, requester: any) {
    return this.votingEventsService.deleteOption(eventId, optionId, requester);
  }

  importPadron(eventId: string, csvContent: string, requester: any) {
    return this.padronService.importPadron(eventId, csvContent, requester);
  }

  listPadronVersions(eventId: string, requester: any) {
    return this.padronService.listPadronVersions(eventId, requester);
  }

  listCurrentPadronVoters(eventId: string, requester: any, page?: number, limit?: number) {
    return this.padronService.listCurrentPadronVoters(eventId, requester, page, limit);
  }

  downloadPadronCsv(eventId: string, requester: any, padronVersionId?: string) {
    return this.padronService.downloadPadronCsv(eventId, requester, padronVersionId);
  }

  updateSchedule(
    eventId: string,
    payload: { votingStart?: string; votingEnd?: string; resultsPublishAt?: string },
    requester: any,
  ) {
    return this.votingEventsService.updateSchedule(eventId, payload, requester);
  }

  setPublicEligibility(eventId: string, enabled: boolean, requester: any) {
    return this.votingEventsService.setPublicEligibility(eventId, enabled, requester);
  }

  checkEligibility(eventId: string, carnet: string) {
    return this.padronService.checkEligibility(eventId, carnet);
  }

  checkPublicEligibility(eventId: string, carnet: string) {
    return this.padronService.checkPublicEligibility(eventId, carnet);
  }

  createParticipation(eventId: string, dto: CreateParticipationDto, idempotencyKey?: string) {
    return this.participationService.createParticipation(eventId, dto, idempotencyKey);
  }

  checkParticipationStatus(eventId: string, carnet: string) {
    return this.participationService.checkParticipationStatus(eventId, carnet);
  }

  getResults(eventId: string) {
    return this.votingResultsService.getResults(eventId);
  }

  upsertResultsSnapshot(
    eventId: string,
    dto: UpsertEventResultsSnapshotDto,
    requester: any,
  ) {
    return this.votingResultsService.upsertResultsSnapshot(eventId, dto, requester);
  }

  updateComparisonReportStatus(
    eventId: string,
    status: 'PENDING' | 'OK' | 'FAILED',
    requester: any,
    padronVersionId?: string,
  ) {
    return this.padronService.updateComparisonReportStatus(
      eventId,
      status,
      requester,
      padronVersionId,
    );
  }
}
