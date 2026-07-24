import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  OfficialPublicationCancelDto,
  OfficialPublicationClaimDto,
  OfficialPublicationRejectDto,
  OfficialPublicationSubmissionDto,
} from '../../dto/official-publication-request.dto';
import {
  OFFICIAL_PUBLICATION_ADMIN_ACTIVE_STATUSES,
  OFFICIAL_PUBLICATION_TERMINAL_STATUSES,
  OfficialPublicationRequestDocument,
  OfficialPublicationRequestStatus,
} from '../../schemas/official-publication-request.schema';
import { VotingEvent, VotingEventDocument } from '../../schemas/voting-event.schema';
import { TvdBlockchainError } from '@/modules/tvd/errors/tvd-blockchain.error';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';
import { OfficialPublicationPreparationService } from './official-publication-preparation.service';
import { OfficialPublicationNotificationService } from './official-publication-notification.service';
import { OfficialPublicationRequestService } from './official-publication-request.service';

const CLAIM_LOCK_MS = 10 * 60 * 1000;
const HASH_32_BYTES_REGEX = /^0x[a-fA-F0-9]{64}$/;
const PRE_SUBMISSION_CANCELABLE: readonly OfficialPublicationRequestStatus[] = [
  'PREPARING',
  'PENDING_APPROVAL',
  'CLAIMED',
  'SIGNING',
  'FAILED_RETRYABLE',
];
const PRE_SUBMISSION_RETRY_SOURCES: readonly OfficialPublicationRequestStatus[] = [
  'PREPARING',
  'PENDING_APPROVAL',
  'CLAIMED',
  'SIGNING',
];

@Injectable()
export class OfficialPublicationApiService {
  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    private readonly preparationService: OfficialPublicationPreparationService,
    private readonly notificationService: OfficialPublicationNotificationService,
    private readonly requestService: OfficialPublicationRequestService,
    private readonly accessService: InstitutionalVotingAccessService,
  ) {}

  async createAdminRequest(eventId: string, requester: any) {
    const result = await this.prepareOfficialPublicationOrThrow(eventId, requester);
    if (!result.reused) {
      await this.notificationService.enqueueForRequest(result.request);
    }
    return {
      created: !result.reused,
      request: this.serializeAdminRequest(result.request),
    };
  }

  private async prepareOfficialPublicationOrThrow(eventId: string, requester: any) {
    try {
      return await this.preparationService.prepareOfficialPublication(
        eventId,
        requester,
      );
    } catch (error) {
      if (
        error instanceof TvdBlockchainError &&
        error.code === 'TVD_CREDITS_CONFIG_INCOMPLETE'
      ) {
        throw new ServiceUnavailableException({
          code: 'ELECTORAL_CREDITS_CONFIGURATION_INCOMPLETE',
          message: 'La publicacion oficial no esta disponible en este entorno.',
        });
      }
      if (error instanceof TvdBlockchainError) {
        throw error.toHttpException();
      }
      throw error;
    }
  }

  async getActiveAdminRequest(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    const request = await this.requestService.getActiveRequestByEventId(event._id);
    const latestAttempt = request
      ? null
      : await this.requestService.getLatestAttemptByEventId(event._id);
    return {
      request: request ? this.serializeAdminRequest(request) : null,
      latestAttempt: latestAttempt ? this.serializeAdminAttempt(latestAttempt) : null,
    };
  }

  async getAdminRequest(requestId: string, requester: any) {
    const request = await this.requestService.getRequestById(requestId);
    await this.assertAdminCanAccessRequest(request, requester);
    return { request: this.serializeAdminRequest(request) };
  }

  async cancelAdminRequest(
    requestId: string,
    requester: any,
    _dto?: OfficialPublicationCancelDto,
  ) {
    let request = await this.requestService.getRequestById(requestId);
    await this.assertAdminCanAccessRequest(request, requester);

    if (request.status === 'CANCELLED') {
      return { request: this.serializeAdminRequest(request) };
    }
    this.assertCancelable(request);

    request = await this.requestService.cancelRequest(
      request.requestId,
      this.actorFrom(requester),
    );
    return { request: this.serializeAdminRequest(request) };
  }

  async getMobileRequest(requestId: string, requester: any) {
    const request = await this.getRequestForMobile(requestId, requester);
    const context = await this.loadContext(request);
    return {
      request: this.serializeMobileSummary(request, context),
    };
  }

  async claimMobileRequest(
    requestId: string,
    requester: any,
    dto: OfficialPublicationClaimDto,
  ) {
    const deviceId = this.normalizeDeviceId(dto.deviceId);
    let request = await this.getRequestForMobile(requestId, requester);
    await this.assertNotExpired(request);
    await this.assertPublicationWindowOpen(request);

    if (request.userOpHash) {
      this.assertDeviceMatches(request, deviceId);
    } else {
      request = await this.requestService.releaseExpiredClaim(
        request.requestId,
        this.actorFrom(requester),
      );
    }

    await this.assertMobileCanAccessRequest(request, requester);
    if (request.status === 'SIGNING' && request.claimedByDeviceId === deviceId) {
      return this.serializeClaimResponse(request);
    }

    request = await this.requestService.claimRequest({
      requestId: request.requestId,
      deviceId,
      actor: this.actorFrom(requester),
      lockMs: CLAIM_LOCK_MS,
    });
    return this.serializeClaimResponse(request);
  }

  async markMobileSigning(
    requestId: string,
    requester: any,
    dto: OfficialPublicationClaimDto,
  ) {
    const deviceId = this.normalizeDeviceId(dto.deviceId);
    let request = await this.getRequestForMobile(requestId, requester);
    await this.assertNotExpired(request);
    await this.assertPublicationWindowOpen(request);
    this.assertDeviceMatches(request, deviceId);

    if (request.status === 'SIGNING') {
      return { request: this.serializeMobileSummary(request, await this.loadContext(request)) };
    }
    request = await this.requestService.startSigning(
      request.requestId,
      this.actorFrom(requester),
    );
    return { request: this.serializeMobileSummary(request, await this.loadContext(request)) };
  }

  async rejectMobileRequest(
    requestId: string,
    requester: any,
    dto: OfficialPublicationRejectDto,
  ) {
    const deviceId = this.normalizeDeviceId(dto.deviceId);
    let request = await this.getRequestForMobile(requestId, requester);

    if (request.status === 'REJECTED') {
      return { request: this.serializeMobileSummary(request, await this.loadContext(request)) };
    }
    if (request.userOpHash || !['PENDING_APPROVAL', 'CLAIMED', 'SIGNING'].includes(request.status)) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_CANNOT_REJECT_AFTER_SUBMISSION',
        message: 'La solicitud ya fue enviada y no puede rechazarse desde la app',
      });
    }
    if (request.claimedByDeviceId) {
      this.assertDeviceMatches(request, deviceId);
    }

    request = await this.requestService.rejectRequest(
      request.requestId,
      this.actorFrom(requester),
    );
    return { request: this.serializeMobileSummary(request, await this.loadContext(request)) };
  }

  async registerMobileSubmission(
    requestId: string,
    requester: any,
    dto: OfficialPublicationSubmissionDto,
  ) {
    const deviceId = this.normalizeDeviceId(dto.deviceId);
    let request: any = await this.getRequestForMobile(requestId, requester);
    await this.assertNotExpired(request);
    this.assertDeviceMatches(request, deviceId);

    const userOpHash = String(dto.userOpHash ?? '').trim().toLowerCase();
    const txHash = dto.txHash?.trim().toLowerCase();
    if (!HASH_32_BYTES_REGEX.test(userOpHash)) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_USER_OP_HASH_REQUIRED',
        message: 'No se recibió el identificador de la operación',
      });
    }

    if (request.userOpHash) {
      if (request.userOpHash !== userOpHash) {
        throw new ConflictException({
          code: 'OFFICIAL_PUBLICATION_SUBMISSION_CONFLICT',
          message: 'La solicitud ya tiene una operacion distinta registrada',
        });
      }
      if (txHash && request.txHash && request.txHash !== txHash) {
        throw new ConflictException({
          code: 'OFFICIAL_PUBLICATION_SUBMISSION_CONFLICT',
          message: 'La solicitud ya tiene un hash de transaccion distinto',
        });
      }
      const serialized = this.serializeMobileSummary(request, await this.loadContext(request));
      return {
        status: serialized.status,
        userOpHash: serialized.userOpHash,
        txHash: serialized.txHash,
        request: serialized,
      };
    }

    await this.assertPublicationWindowOpen(request);

    if (request.status !== 'SIGNING') {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_INVALID_TRANSITION',
        message: 'La solicitud debe estar en firma antes de registrar el envio',
      });
    }

    request = await this.requestService.registerSubmission({
      requestId: request.requestId,
      userOpHash,
      txHash,
      actor: this.actorFrom(requester),
    });
    const serialized = this.serializeMobileSummary(request, await this.loadContext(request));
    return {
      status: serialized.status,
      userOpHash: serialized.userOpHash,
      txHash: serialized.txHash,
      request: serialized,
    };
  }

  private async getRequestForMobile(requestId: string, requester: any) {
    try {
      const request = await this.requestService.getRequestById(requestId);
      await this.assertMobileCanAccessRequest(request, requester);
      return request;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw new NotFoundException({
          code: 'OFFICIAL_PUBLICATION_REQUEST_NOT_FOUND',
          message: 'Solicitud de publicacion oficial no encontrada',
        });
      }
      throw error;
    }
  }

  private async assertAdminCanAccessRequest(
    request: OfficialPublicationRequestDocument,
    requester: any,
  ) {
    const event = await this.loadEvent(request);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    if (String(event.tenantId) !== String(request.tenantId)) {
      throw new ForbiddenException({
        code: 'OFFICIAL_PUBLICATION_ACCESS_DENIED',
        message: 'No autorizado para consultar esta solicitud',
      });
    }
  }

  private async assertMobileCanAccessRequest(
    request: OfficialPublicationRequestDocument,
    requester: any,
  ) {
    if (String(request.signerUserId) !== String(requester?.sub ?? '')) {
      throw new ForbiddenException({
        code: 'OFFICIAL_PUBLICATION_SIGNER_MISMATCH',
        message: 'No autorizado para operar esta solicitud',
      });
    }

    const event = await this.loadEvent(request);
    const institution = await this.accessService.resolveOfficialPublicationInstitution(
      event,
      requester,
    );
    if (
      institution.institutionId !== request.institutionId ||
      institution.smartAccountAddress.toLowerCase() !== request.smartAccountAddress.toLowerCase()
    ) {
      throw new ForbiddenException({
        code: 'OFFICIAL_PUBLICATION_WALLET_MISMATCH',
        message: 'No autorizado para operar esta solicitud',
      });
    }
  }

  private async loadContext(request: OfficialPublicationRequestDocument) {
    const event = await this.loadEvent(request);
    const tenant = await this.tenantModel
      .findById(request.tenantId, { name: 1 })
      .lean();
    return {
      eventName: event.name,
      institutionName: tenant?.name ?? 'Institucion',
      votingStart: event.votingStart ?? null,
      votingEnd: event.votingEnd ?? null,
      resultsPublishAt: event.resultsPublishAt ?? null,
      publicationDeadline: event.publishDeadline ?? null,
      canPublish: this.canPublishNow(event, request),
      blockingReason: this.getPublicationBlockingReason(event, request),
    };
  }

  private async loadEvent(request: OfficialPublicationRequestDocument) {
    const event = await this.votingEventModel.findById(request.eventId);
    if (!event) {
      throw new NotFoundException({
        code: 'OFFICIAL_PUBLICATION_EVENT_NOT_FOUND',
        message: 'Evento de la solicitud no encontrado',
      });
    }
    return event;
  }

  private async assertNotExpired(request: OfficialPublicationRequestDocument) {
    const now = new Date();
    if (OFFICIAL_PUBLICATION_TERMINAL_STATUSES.includes(request.status)) {
      return;
    }
    if (request.expiresAt > now || request.userOpHash) {
      return;
    }
    if (['PENDING_APPROVAL', 'CLAIMED', 'SIGNING'].includes(request.status)) {
      await this.requestService.markExpired(request.requestId, 'system', now);
    }
    throw new GoneException({
      code: 'OFFICIAL_PUBLICATION_REQUEST_EXPIRED',
      message: 'La solicitud de publicacion oficial expiro',
    });
  }

  private async assertPublicationWindowOpen(
    request: OfficialPublicationRequestDocument,
  ) {
    if (request.userOpHash) return;
    if (!['PENDING_APPROVAL', 'CLAIMED', 'SIGNING'].includes(request.status)) return;
    const event = await this.loadEvent(request);
    if (this.canPublishNow(event, request)) return;
    throw new GoneException({
      code: this.getPublicationBlockingReason(event, request),
      message: 'El tiempo para confirmar esta publicacion ya termino',
    });
  }

  private assertCancelable(request: OfficialPublicationRequestDocument) {
    if (request.userOpHash) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_CANNOT_CANCEL_AFTER_SUBMISSION',
        message: 'La solicitud ya fue enviada a blockchain y no puede cancelarse',
      });
    }
    if (!PRE_SUBMISSION_CANCELABLE.includes(request.status)) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_CANNOT_CANCEL_AFTER_SUBMISSION',
        message: 'La solicitud ya no puede cancelarse de forma segura',
      });
    }
    if (
      request.status === 'FAILED_RETRYABLE' &&
      request.resumeFromStatus &&
      !PRE_SUBMISSION_RETRY_SOURCES.includes(request.resumeFromStatus)
    ) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_CANNOT_CANCEL_AFTER_SUBMISSION',
        message: 'La solicitud fallo despues del envio y no puede cancelarse',
      });
    }
  }

  private assertDeviceMatches(
    request: OfficialPublicationRequestDocument,
    deviceId: string,
  ) {
    if (!request.claimedByDeviceId || request.claimedByDeviceId !== deviceId) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_DEVICE_MISMATCH',
        message: 'La solicitud fue reclamada por otro dispositivo',
      });
    }
  }

  private normalizeDeviceId(deviceId: string) {
    const normalized = deviceId?.trim();
    if (!normalized) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_INVALID_DEVICE',
        message: 'deviceId es obligatorio',
      });
    }
    return normalized;
  }

  private serializeAdminRequest(request: OfficialPublicationRequestDocument) {
    return {
      requestId: request.requestId,
      eventId: String(request.eventId),
      status: request.status,
      expiresAt: this.iso(request.expiresAt),
      votersCount: String(request.enabledVotersCount),
      requiredCredits: request.creditsRequired,
      requiredTvd: request.tvdRequired,
      tvdPerCredit: request.tvdPerCredit,
      signerWallet: request.signerWallet,
      smartAccountAddress: request.smartAccountAddress,
      createdAt: this.iso(request.createdAt),
      updatedAt: this.iso(request.updatedAt),
      userOpHash: request.userOpHash ?? null,
      txHash: request.txHash ?? null,
      errorCode: request.errorCode ?? null,
      errorStage: request.errorStage ?? null,
      safeMessage: request.safeMessage ?? null,
    };
  }

  private serializeAdminAttempt(request: OfficialPublicationRequestDocument) {
    return {
      requestId: request.requestId,
      eventId: String(request.eventId),
      status: request.status,
      errorCode: request.errorCode ?? null,
      errorStage: request.errorStage ?? null,
      safeMessage: request.safeMessage ?? null,
      createdAt: this.iso(request.createdAt),
      updatedAt: this.iso(request.updatedAt),
      retryable: ['FAILED_RETRYABLE', 'EXPIRED'].includes(request.status),
      active: OFFICIAL_PUBLICATION_ADMIN_ACTIVE_STATUSES.includes(request.status),
    };
  }

  private serializeMobileSummary(
    request: OfficialPublicationRequestDocument,
    context: {
      eventName: string;
      institutionName: string;
      votingStart?: Date | null;
      votingEnd?: Date | null;
      resultsPublishAt?: Date | null;
      publicationDeadline?: Date | null;
      canPublish?: boolean;
      blockingReason?: string | null;
    },
  ) {
    return {
      ...this.serializeAdminRequest(request),
      eventName: context.eventName,
      institutionName: context.institutionName,
      votingStart: this.iso(context.votingStart),
      votingEnd: this.iso(context.votingEnd),
      resultsPublishAt: this.iso(context.resultsPublishAt),
      publicationDeadline: this.iso(context.publicationDeadline),
      canPublish: context.canPublish ?? false,
      blockingReason: context.blockingReason ?? null,
      chainId: request.chainId,
    };
  }

  private serializeClaimResponse(request: OfficialPublicationRequestDocument) {
    return {
      requestId: request.requestId,
      status: request.status,
      claimExpiresAt: this.iso(request.lockedUntil ?? request.expiresAt),
      execution: {
        executionMode: request.executionMode ?? 'SINGLE',
        chainId: request.chainId,
        smartAccountAddress: request.smartAccountAddress,
        targetAddress: request.callData.to,
        value: request.callData.value,
        callData: request.callData.data,
        callDataHash: request.callDataHash,
        callsHash: request.callsHash ?? request.callDataHash,
        spenderAddress: request.spender,
        calls: request.executionCalls ?? [
          {
            target: request.callData.to,
            value: request.callData.value,
            callData: request.callData.data,
            purpose: 'CREATE_VOTE',
          },
        ],
        onChainElectionId: request.onChainElectionId,
        walletDebitRequired: request.walletDebitRequired ?? '0',
        allowanceBefore: request.allowanceBefore ?? '0',
      },
      economicSummary: {
        votersCount: String(request.enabledVotersCount),
        requiredCredits: request.creditsRequired,
        requiredTvd: request.tvdRequired,
        tvdPerCredit: request.tvdPerCredit,
      },
    };
  }

  private iso(value?: Date | null) {
    return value ? new Date(value).toISOString() : null;
  }

  private canPublishNow(event: VotingEventDocument, request: OfficialPublicationRequestDocument) {
    if (request.userOpHash) return true;
    return Boolean(event.publishDeadline && new Date() < new Date(event.publishDeadline));
  }

  private getPublicationBlockingReason(
    event: VotingEventDocument,
    request: OfficialPublicationRequestDocument,
  ) {
    if (request.userOpHash) return null;
    if (!event.publishDeadline || new Date() >= new Date(event.publishDeadline)) {
      return 'PUBLICATION_WINDOW_CLOSED';
    }
    return null;
  }

  private actorFrom(requester: any) {
    return requester?.sub ? String(requester.sub) : 'system';
  }
}
