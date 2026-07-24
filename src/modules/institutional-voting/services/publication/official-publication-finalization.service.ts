import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EnabledSession,
  EnabledSessionDocument,
} from '../../schemas/enabled-session.shcema';
import { VotingEvent, VotingEventDocument } from '../../schemas/voting-event.schema';
import { IssuerService } from '../core/issuer.service';
import { VoteWritterService } from '../core/vote-writter.service';
import { OfficialPublicationArtifactsService } from './official-publication-artifacts.service';
import { OfficialPublicationRequestService } from './official-publication-request.service';

@Injectable()
export class OfficialPublicationFinalizationService {
  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    @InjectModel(EnabledSession.name)
    private readonly enabledSessionModel: Model<EnabledSessionDocument>,
    private readonly requestService: OfficialPublicationRequestService,
    private readonly artifactsService: OfficialPublicationArtifactsService,
    private readonly voteWritterService: VoteWritterService,
    private readonly issuerService: IssuerService,
  ) {}

  async finalizeOfficialPublication(requestId: string, actor = 'system') {
    const current = await this.requestService.getRequestById(requestId);
    if (current.status === 'COMPLETED') {
      return {
        request: current,
        completed: true,
        reused: true,
      };
    }

    let request = current;
    if (request.status === 'FAILED_RETRYABLE' && request.resumeFromStatus === 'FINALIZING') {
      request = await this.requestService.retryFinalization(requestId, actor);
    }

    if (request.status !== 'FINALIZING') {
      if (request.status !== 'CHAIN_CONFIRMED') {
        throw new ConflictException({
          code: 'OFFICIAL_PUBLICATION_FINALIZATION_INVALID_STATE',
          message: 'La finalizacion requiere blockchain confirmada',
          status: request.status,
        });
      }
      request = await this.requestService.startFinalization(requestId, actor);
    }

    try {
      const event = await this.votingEventModel.findById(request.eventId);
      if (!event) {
        throw new NotFoundException({
          code: 'OFFICIAL_PUBLICATION_EVENT_NOT_FOUND',
          message: 'Votacion no encontrada para finalizar publicacion',
        });
      }

      const { artifact, payload } =
        await this.artifactsService.loadArtifactPayload(request.requestId);
      this.assertIntegrity(request, artifact);
      const preparedVote = this.artifactsService.deserializePreparedVote(
        payload.preparedVote,
      );

      if (!request.finalizationProgress?.treesPersistedAt) {
        await this.voteWritterService.persistPreparedMerkleTrees(event, preparedVote);
        request = await this.requestService.markProgress(
          request.requestId,
          'treesPersistedAt',
        );
      }

      let credentialData = payload.credentialData;
      if (!request.finalizationProgress?.credentialsIssuedAt) {
        if (!credentialData) {
          if (request.finalizationProgress?.credentialsIssuingAt) {
            const review = await this.requestService.markNeedsReview(
              request.requestId,
              actor,
              'OFFICIAL_PUBLICATION_CREDENTIALS_AMBIGUOUS',
              'La emision de credenciales quedo ambigua y requiere revision antes de reintentar',
              'FINALIZING',
            );
            return {
              request: review,
              completed: false,
              needsReview: true,
            };
          }
          request = await this.requestService.markProgress(
            request.requestId,
            'credentialsIssuingAt',
          );
          credentialData = await this.issuerService.issueCredential(
            payload.dids,
            String(event._id),
            [...preparedVote.secrets],
          );
          await this.artifactsService.saveCredentialData(
            request.requestId,
            credentialData,
          );
        }
        request = await this.requestService.markProgress(
          request.requestId,
          'credentialsIssuedAt',
        );
      }

      if (!credentialData) {
        const loaded = await this.artifactsService.loadArtifactPayload(request.requestId);
        credentialData = loaded.payload.credentialData;
      }
      if (!credentialData) {
        throw new ConflictException({
          code: 'OFFICIAL_PUBLICATION_CREDENTIALS_MISSING',
          message: 'No existen credenciales preparadas para crear sesiones',
        });
      }

      if (!request.finalizationProgress?.sessionsCreatedAt) {
        await this.upsertEnabledSessions(event._id, payload.voters, credentialData);
        request = await this.requestService.markProgress(
          request.requestId,
          'sessionsCreatedAt',
        );
      }

      if (!request.finalizationProgress?.eventPublishedAt) {
        await this.votingEventModel.updateOne(
          { _id: event._id },
          {
            $set: {
              state: 'OFFICIALLY_PUBLISHED',
              canEditStructure: false,
              publicEligibilityEnabled: true,
              officialPublishedAt: new Date(),
              publicationConfirmed: true,
              officialPublicationTxHash: request.txHash ?? undefined,
              officialPublicationWallet: request.signerWallet,
              officialPublicationChainId: String(request.chainId),
            },
            $unset: { publicationExpiredAt: '' },
          },
        );
        request = await this.requestService.markProgress(
          request.requestId,
          'eventPublishedAt',
        );
      }

      const completed = await this.requestService.markCompleted(request.requestId, actor);
      return {
        request: completed,
        completed: true,
        reused: false,
      };
    } catch (error) {
      await this.requestService.markFailedRetryable(
        request.requestId,
        actor,
        this.safeErrorCode(error),
        'La publicacion fue confirmada en blockchain y requiere reintentar la finalizacion local',
        'FINALIZING',
        undefined,
        'FINALIZATION',
      );
      throw error;
    }
  }

  private assertIntegrity(request: any, artifact: any) {
    if (String(request.eventId) !== String(artifact.eventId)) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_ARTIFACT_EVENT_MISMATCH',
        message: 'El artefacto preparado no pertenece a la votacion',
      });
    }
    if (request.institutionId !== artifact.institutionId) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_ARTIFACT_INSTITUTION_MISMATCH',
        message: 'El artefacto preparado no pertenece a la institucion',
      });
    }
    if (request.snapshotHash !== artifact.snapshotHash) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_SNAPSHOT_MISMATCH',
        message: 'El snapshot preparado no coincide con la solicitud',
      });
    }
    if (Number(request.enabledVotersCount) !== Number(artifact.votersCount)) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_VOTERS_COUNT_MISMATCH',
        message: 'El conteo preparado no coincide con la solicitud',
      });
    }
  }

  private async upsertEnabledSessions(
    eventId: Types.ObjectId,
    voters: string[],
    credentialData: Record<string, { credentialData: string }>,
  ) {
    if (!voters.length) return;
    await this.enabledSessionModel.bulkWrite(
      voters.map((dni) => ({
        updateOne: {
          filter: { eventId, dni },
          update: {
            $setOnInsert: {
              eventId,
              dni,
              sessionToken: credentialData[dni]?.credentialData,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  private safeErrorCode(error: unknown) {
    const code = (error as any)?.response?.code ?? (error as any)?.code;
    return typeof code === 'string' && code.trim()
      ? code.trim()
      : 'OFFICIAL_PUBLICATION_FINALIZATION_FAILED';
  }
}
