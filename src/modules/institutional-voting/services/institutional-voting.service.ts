import { Injectable } from '@nestjs/common';
import { CreateVotingEventDto } from '../dto/create-voting-event.dto';
import { CreateEventRoleDto } from '../dto/event-role.dto';
import { CreateParticipationDto } from '../dto/participation.dto';
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

  publishEvent(eventId: string, requester: any) {
    return this.votingEventsService.publishEvent(eventId, requester);
  }

  createRole(eventId: string, dto: CreateEventRoleDto, requester: any) {
    return this.votingEventsService.createRole(eventId, dto, requester);
  }

  createOption(eventId: string, dto: CreateVotingOptionDto, requester: any) {
    return this.votingEventsService.createOption(eventId, dto, requester);
  }

  deactivateOption(eventId: string, optionId: string, requester: any) {
    return this.votingEventsService.deactivateOption(eventId, optionId, requester);
  }

  importPadron(eventId: string, csvContent: string, requester: any) {
    return this.padronService.importPadron(eventId, csvContent, requester);
  }

  listPadronVersions(eventId: string, requester: any) {
    return this.padronService.listPadronVersions(eventId, requester);
  }

  updateSchedule(
    eventId: string,
    payload: { votingStart?: string; votingEnd?: string; resultsPublishAt?: string },
    requester: any,
  ) {
    return this.votingEventsService.updateSchedule(eventId, payload, requester);
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

  updateComparisonReportStatus(
    eventId: string,
    status: 'PENDING' | 'OK' | 'FAILED',
    requester: any,
  ) {
    return this.padronService.updateComparisonReportStatus(eventId, status, requester);
  }
}
