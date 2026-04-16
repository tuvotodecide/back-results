import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { MessageEvent } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { EMPTY, merge, Observable, of, Subject } from 'rxjs';
import { normalizeCarnet } from '../../utils/carnet-normalizer';
import {
  PresentialSession,
  PresentialSessionDocument,
} from '../../schemas/presential-session.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';
import {
  CreatePresentialSessionDto,
  ScanPresentialSessionDto,
} from '../../dto/presential-session.dto';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';
import { ParticipationService } from '../participation/participation.service';

type PresentialTerminalReason = 'EXPIRED' | 'CANCELLED';

type PresentialCurrentState = {
  eventId: string;
  eventName: string;
  stationId: string;
  kioskEnabled: boolean;
  eventState: string;
  isEventActive: boolean;
  session: {
    id: string;
    eventId: string;
    stationId: string;
    status: string;
    rotationNumber: number;
    expiresAt: Date | null;
    claimedAt: Date | null;
    completedAt: Date | null;
    qrToken: string | null;
    qrValue: string | null;
  } | null;
};

@Injectable()
export class PresentialSessionsService {
  private readonly primaryStationId = 'kiosco-principal';
  private readonly readyTtlSecondsDefault: number;
  private readonly claimTtlSecondsDefault: number;
  private readonly streamChannels = new Map<string, Subject<MessageEvent>>();

  constructor(
    @InjectModel(PresentialSession.name)
    private readonly presentialSessionModel: Model<PresentialSessionDocument>,
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    private readonly accessService: InstitutionalVotingAccessService,
    private readonly participationService: ParticipationService,
  ) {
    this.readyTtlSecondsDefault = 120;
    this.claimTtlSecondsDefault = 300;
  }

  async createOrRotateCurrentSession(
    eventId: string,
    dto: CreatePresentialSessionDto | undefined,
    requester: any,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const stationId = this.normalizeStationId(dto?.stationId);
    const shouldRotateKioskToken =
      dto?.regenerateKioskAccessToken === true ||
      !event.presentialKioskTokenHash;

    await this.expireStaleSessionsForEvent(event, stationId);

    const current = await this.getCurrentActiveSession(event._id, stationId);
    if (current?.status === 'CLAIMED') {
      throw new ConflictException(
        'No se puede rotar el QR mientras una sesión presencial está en curso',
      );
    }

    let kioskAccessToken: string | null = null;
    if (shouldRotateKioskToken) {
      kioskAccessToken = this.issueKioskAccessTokenValue();
      event.presentialKioskTokenHash = this.hashValue(kioskAccessToken);
      event.presentialKioskIssuedAt = new Date();
    }

    event.presentialKioskEnabled = true;
    await event.save();

    let cancelledSessionId: string | null = null;
    if (current?.status === 'READY') {
      const cancelled = await this.presentialSessionModel.findOneAndUpdate(
        {
          _id: current._id,
          status: 'READY',
        },
        {
          $set: {
            status: 'CANCELLED',
            expiresAt: new Date(),
          },
        },
        { new: true },
      );
      if (cancelled) {
        cancelledSessionId = String(cancelled._id);
      }
    }

    const readyTtlSeconds = this.clampSeconds(
      dto?.readyTtlSeconds,
      30,
      900,
      this.readyTtlSecondsDefault,
    );
    const claimTtlSeconds = this.clampSeconds(
      dto?.claimTtlSeconds,
      30,
      1800,
      this.claimTtlSecondsDefault,
    );

    let nextSession: PresentialSessionDocument | null = null;
    if (this.isEventActive(event)) {
      nextSession = await this.createReadySession(event, stationId, requester, {
        readyTtlSeconds,
        claimTtlSeconds,
        rotatedFromSessionId: cancelledSessionId,
      });
    }

    return {
      eventId: String(event._id),
      stationId,
      kioskEnabled: true,
      kioskAccessToken,
      kioskBootstrap: {
        authHeader: 'x-kiosk-token',
        currentPath: `/api/v1/voting/events/${String(event._id)}/presential-sessions/current?stationId=${encodeURIComponent(stationId)}`,
        streamPath: `/api/v1/voting/events/${String(event._id)}/presential-sessions/stream?stationId=${encodeURIComponent(stationId)}`,
      },
      currentSession: nextSession
        ? this.buildSessionPayload(nextSession)
        : null,
      claimTtlSeconds,
      readyTtlSeconds,
    };
  }

  async getCurrentSessionState(
    eventId: string,
    stationIdRaw?: string,
    kioskToken?: string,
    requester?: any,
  ): Promise<PresentialCurrentState> {
    const event = await this.authorizeKioskAccess(
      eventId,
      kioskToken,
      requester,
    );
    const stationId = this.normalizeStationId(stationIdRaw);

    await this.expireStaleSessionsForEvent(event, stationId);

    let current = await this.getCurrentActiveSession(event._id, stationId);
    if (!current && event.presentialKioskEnabled && this.isEventActive(event)) {
      current = await this.ensureCurrentReadySession(event, stationId);
    }

    return this.buildCurrentStatePayload(event, stationId, current);
  }

  async createAuthorizedStream(
    eventId: string,
    stationIdRaw?: string,
    kioskToken?: string,
    requester?: any,
  ): Promise<Observable<MessageEvent>> {
    const stationId = this.normalizeStationId(stationIdRaw);
    const currentState = await this.getCurrentSessionState(
      eventId,
      stationId,
      kioskToken,
      requester,
    );
    const initial$ = currentState.session
      ? of(
          this.buildMessageEvent(
            this.resolveCurrentEventName(currentState.session.status),
            currentState,
          ),
        )
      : EMPTY;

    return merge(
      initial$,
      this.getChannel(String(currentState.eventId), stationId).asObservable(),
    );
  }

  async scanAndClaim(dto: ScanPresentialSessionDto) {
    const token = String(dto.token || '').trim();
    if (!token) {
      throw new BadRequestException('token inválido');
    }

    const carnetNorm = normalizeCarnet(dto.carnet);
    if (!carnetNorm) {
      throw new BadRequestException('carnet inválido');
    }

    const parsed = this.parseSessionToken(token);
    if (!parsed) {
      throw new BadRequestException('token inválido');
    }

    const session = await this.presentialSessionModel.findById(
      parsed.sessionId,
    );
    if (!session) {
      throw new NotFoundException('Sesión presencial no encontrada');
    }

    if (
      session.tokenId !== parsed.tokenId ||
      !this.hashMatches(token, session.tokenHash)
    ) {
      throw new ForbiddenException({ error: 'INVALID_QR_TOKEN' });
    }

    const event = await this.votingEventModel.findById(session.eventId);
    if (!event) {
      throw new NotFoundException('Evento no encontrado');
    }

    await this.expireSessionIfStale(session);
    const freshSession =
      (await this.presentialSessionModel.findById(session._id)) ?? session;

    if (!event.presentialKioskEnabled) {
      throw new ForbiddenException({ error: 'KIOSK_DISABLED' });
    }
    if (!this.isEventActive(event)) {
      throw new ForbiddenException({ error: 'EVENT_NOT_ACTIVE' });
    }

    const status = await this.participationService.checkParticipationStatus(
      String(event._id),
      carnetNorm,
    );
    if (status.status === 'ALREADY_VOTED') {
      throw new ConflictException('Ya participaste en este evento');
    }
    if (status.status !== 'CAN_VOTE') {
      throw new ForbiddenException({ error: status.status });
    }

    if (
      freshSession.status === 'CLAIMED' &&
      freshSession.claimedByCarnetNorm === carnetNorm &&
      freshSession.expiresAt.getTime() > Date.now()
    ) {
      return {
        statusCode: 200,
        body: this.buildClaimResponse(freshSession),
      };
    }

    if (freshSession.status !== 'READY') {
      throw new ConflictException({
        error:
          freshSession.status === 'COMPLETED'
            ? 'QR_ALREADY_USED'
            : freshSession.status === 'EXPIRED'
              ? 'QR_EXPIRED'
              : freshSession.status === 'CANCELLED'
                ? 'QR_CANCELLED'
                : 'QR_ALREADY_CLAIMED',
      });
    }

    const now = new Date();
    const claimed = await this.presentialSessionModel.findOneAndUpdate(
      {
        _id: freshSession._id,
        status: 'READY',
        expiresAt: { $gt: now },
      },
      {
        $set: {
          status: 'CLAIMED',
          claimedAt: now,
          claimedByCarnetNorm: carnetNorm,
          expiresAt: this.computeFutureDate(
            this.clampSeconds(
              freshSession.claimTtlSeconds,
              30,
              1800,
              this.claimTtlSecondsDefault,
            ),
          ),
        },
      },
      { new: true },
    );

    if (!claimed) {
      const latest = await this.presentialSessionModel.findById(
        freshSession._id,
      );
      if (
        latest?.status === 'CLAIMED' &&
        latest.claimedByCarnetNorm === carnetNorm &&
        latest.expiresAt.getTime() > Date.now()
      ) {
        return {
          statusCode: 200,
          body: this.buildClaimResponse(latest),
        };
      }

      throw new ConflictException({ error: 'QR_ALREADY_CLAIMED' });
    }

    this.publishStateEvent(
      'session.claimed',
      event,
      claimed.stationId,
      claimed,
    );

    return {
      statusCode: 201,
      body: this.buildClaimResponse(claimed),
    };
  }

  async assertSessionCanRegisterParticipation(
    eventId: string,
    presentialSessionId: string,
    carnet: string,
  ) {
    const carnetNorm = normalizeCarnet(carnet);
    if (!carnetNorm) {
      throw new BadRequestException('carnet inválido');
    }

    const session = await this.requireSessionForEvent(
      eventId,
      presentialSessionId,
    );
    await this.expireSessionIfStale(session);
    const latest =
      (await this.presentialSessionModel.findById(session._id)) ?? session;

    if (
      latest.status === 'COMPLETED' &&
      latest.claimedByCarnetNorm === carnetNorm
    ) {
      return latest;
    }
    if (latest.status !== 'CLAIMED') {
      throw new ConflictException({ error: 'PRESENTIAL_SESSION_NOT_CLAIMED' });
    }
    if (latest.claimedByCarnetNorm !== carnetNorm) {
      throw new ForbiddenException({ error: 'PRESENTIAL_SESSION_NOT_OWNED' });
    }
    if (latest.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({ error: 'PRESENTIAL_SESSION_EXPIRED' });
    }

    return latest;
  }

  async completeSessionForParticipation(
    eventId: string,
    presentialSessionId: string,
    carnet: string,
  ) {
    const carnetNorm = normalizeCarnet(carnet);
    if (!carnetNorm) {
      throw new BadRequestException('carnet inválido');
    }

    const session = await this.requireSessionForEvent(
      eventId,
      presentialSessionId,
    );
    const event = await this.votingEventModel.findById(session.eventId);
    if (!event) {
      throw new NotFoundException('Evento no encontrado');
    }

    await this.expireSessionIfStale(session);
    const latest =
      (await this.presentialSessionModel.findById(session._id)) ?? session;

    if (
      latest.status === 'COMPLETED' &&
      latest.claimedByCarnetNorm === carnetNorm
    ) {
      return latest;
    }
    if (latest.status !== 'CLAIMED') {
      throw new ConflictException({ error: 'PRESENTIAL_SESSION_NOT_CLAIMED' });
    }
    if (latest.claimedByCarnetNorm !== carnetNorm) {
      throw new ForbiddenException({ error: 'PRESENTIAL_SESSION_NOT_OWNED' });
    }

    const completedAt = new Date();
    const completed = await this.presentialSessionModel.findOneAndUpdate(
      {
        _id: latest._id,
        status: 'CLAIMED',
        claimedByCarnetNorm: carnetNorm,
      },
      {
        $set: {
          status: 'COMPLETED',
          completedAt,
          expiresAt: completedAt,
        },
      },
      { new: true },
    );

    if (!completed) {
      const refetched = await this.presentialSessionModel.findById(latest._id);
      if (
        refetched?.status === 'COMPLETED' &&
        refetched.claimedByCarnetNorm === carnetNorm
      ) {
        return refetched;
      }
      throw new ConflictException({
        error: 'PRESENTIAL_SESSION_COMPLETE_FAILED',
      });
    }

    this.publishStateEvent(
      'session.completed',
      event,
      completed.stationId,
      completed,
    );
    await this.ensureCurrentReadySession(event, completed.stationId, null, {
      rotatedFromSessionId: String(completed._id),
    });

    return completed;
  }

  async expireSessionNow(sessionId: string) {
    const session = await this.presentialSessionModel.findById(sessionId);
    if (!session) return null;
    return this.expireSession(session, 'EXPIRED');
  }

  @Cron('*/15 * * * * *')
  async expireTimedOutSessions() {
    const stale = await this.presentialSessionModel
      .find({
        status: { $in: ['READY', 'CLAIMED'] },
        expiresAt: { $lte: new Date() },
      })
      .sort({ expiresAt: 1, _id: 1 })
      .limit(100);

    for (const session of stale) {
      await this.expireSession(session, 'EXPIRED');
    }
  }

  private async authorizeKioskAccess(
    eventId: string,
    kioskToken?: string,
    requester?: any,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);

    if (requester?.sub) {
      await this.accessService.assertTenantWriteAccess(
        event.tenantId,
        requester,
      );
      return event;
    }

    const normalizedToken = String(kioskToken || '').trim();
    if (!normalizedToken) {
      throw new UnauthorizedException('Debe enviar x-kiosk-token');
    }
    if (!event.presentialKioskEnabled || !event.presentialKioskTokenHash) {
      throw new ForbiddenException('El kiosco presencial no está habilitado');
    }
    if (!this.hashMatches(normalizedToken, event.presentialKioskTokenHash)) {
      throw new UnauthorizedException('x-kiosk-token inválido');
    }

    event.presentialKioskLastUsedAt = new Date();
    await event.save();

    return event;
  }

  private normalizeStationId(value?: string) {
    const normalized = String(value || '').trim();
    return normalized || this.primaryStationId;
  }

  private clampSeconds(
    value: number | undefined,
    min: number,
    max: number,
    fallback: number,
  ) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  private issueKioskAccessTokenValue() {
    return `pkc_${randomBytes(24).toString('hex')}`;
  }

  private hashValue(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private hashMatches(rawValue: string, expectedHash?: string | null) {
    if (!expectedHash) return false;

    const actual = Buffer.from(this.hashValue(rawValue), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }

  private parseSessionToken(token: string) {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'pqs') {
      return null;
    }

    const [, sessionId, tokenId] = parts;
    if (!Types.ObjectId.isValid(sessionId) || !tokenId) {
      return null;
    }

    return { sessionId, tokenId };
  }

  private buildSessionToken(session: {
    _id: Types.ObjectId | string;
    tokenId: string;
  }) {
    return `pqs.${String(session._id)}.${session.tokenId}`;
  }

  private computeFutureDate(seconds: number) {
    return new Date(Date.now() + seconds * 1000);
  }

  private isEventActive(
    event: VotingEventDocument | (VotingEvent & { _id: Types.ObjectId }),
  ) {
    const now = Date.now();
    const start = event.votingStart ? new Date(event.votingStart).getTime() : 0;
    const end = event.votingEnd ? new Date(event.votingEnd).getTime() : 0;
    return (
      ['OFFICIALLY_PUBLISHED', 'PUBLISHED'].includes(event.state) &&
      Boolean(start) &&
      Boolean(end) &&
      now >= start &&
      now <= end
    );
  }

  private async getCurrentActiveSession(
    eventId: Types.ObjectId,
    stationId: string,
  ): Promise<PresentialSessionDocument | null> {
    return this.presentialSessionModel
      .findOne({
        eventId,
        stationId,
        status: { $in: ['READY', 'CLAIMED'] },
        expiresAt: { $gt: new Date() },
      })
      .sort({ rotationNumber: -1, _id: -1 })
      .exec();
  }

  private buildSessionPayload(session: PresentialSessionDocument) {
    const qrToken =
      session.status === 'READY' ? this.buildSessionToken(session) : null;

    return {
      id: String(session._id),
      eventId: String(session.eventId),
      stationId: session.stationId,
      status: session.status,
      rotationNumber: session.rotationNumber,
      expiresAt: session.expiresAt ?? null,
      claimedAt: session.claimedAt ?? null,
      completedAt: session.completedAt ?? null,
      qrToken,
      qrValue: qrToken,
    };
  }

  private buildCurrentStatePayload(
    event: VotingEventDocument,
    stationId: string,
    session: PresentialSessionDocument | null,
  ): PresentialCurrentState {
    return {
      eventId: String(event._id),
      eventName: event.name,
      stationId,
      kioskEnabled: Boolean(event.presentialKioskEnabled),
      eventState: event.state,
      isEventActive: this.isEventActive(event),
      session: session ? this.buildSessionPayload(session) : null,
    };
  }

  private resolveCurrentEventName(status: string) {
    if (status === 'CLAIMED') return 'session.claimed';
    if (status === 'COMPLETED') return 'session.completed';
    if (status === 'EXPIRED') return 'session.expired';
    return 'session.ready';
  }

  private buildClaimResponse(session: PresentialSessionDocument) {
    return {
      presentialSessionId: String(session._id),
      eventId: String(session.eventId),
      stationId: session.stationId,
      status: session.status,
      claimedAt: session.claimedAt ?? null,
      expiresAt: session.expiresAt ?? null,
      nextAction: 'CONTINUE_VOTING',
    };
  }

  private getChannel(eventId: string, stationId: string) {
    const key = `${eventId}:${stationId}`;
    const existing = this.streamChannels.get(key);
    if (existing) {
      return existing;
    }

    const created = new Subject<MessageEvent>();
    this.streamChannels.set(key, created);
    return created;
  }

private buildMessageEvent(type: string, data: string | object): MessageEvent {
  return {
    type,
    data,
  };
}

  private publishStateEvent(
    type: string,
    event: VotingEventDocument,
    stationId: string,
    session: PresentialSessionDocument,
  ) {
    const payload = this.buildCurrentStatePayload(event, stationId, session);
    this.getChannel(String(event._id), stationId).next(
      this.buildMessageEvent(type, payload),
    );
  }

  private publishRotatedEvent(
    event: VotingEventDocument,
    stationId: string,
    previousSessionId: string,
    session: PresentialSessionDocument,
  ) {
    this.getChannel(String(event._id), stationId).next(
      this.buildMessageEvent('session.rotated', {
        eventId: String(event._id),
        eventName: event.name,
        stationId,
        previousSessionId,
        session: this.buildSessionPayload(session),
      }),
    );
  }

  private async ensureCurrentReadySession(
    event: VotingEventDocument,
    stationId: string,
    requester?: any,
    options?: {
      readyTtlSeconds?: number;
      claimTtlSeconds?: number;
      rotatedFromSessionId?: string | null;
    },
  ): Promise<PresentialSessionDocument | null> {
    const active = await this.getCurrentActiveSession(
      event._id as Types.ObjectId,
      stationId,
    );
    if (active) {
      return active;
    }
    if (!event.presentialKioskEnabled || !this.isEventActive(event)) {
      return null;
    }

    return this.createReadySession(event, stationId, requester, options);
  }

  private async createReadySession(
    event: VotingEventDocument,
    stationId: string,
    requester?: any,
    options?: {
      readyTtlSeconds?: number;
      claimTtlSeconds?: number;
      rotatedFromSessionId?: string | null;
    },
  ): Promise<PresentialSessionDocument> {
    const readyTtlSeconds = this.clampSeconds(
      options?.readyTtlSeconds,
      30,
      900,
      this.readyTtlSecondsDefault,
    );
    const sessionId = new Types.ObjectId();
    const tokenId = randomBytes(24).toString('hex');
    const token = this.buildSessionToken({ _id: sessionId, tokenId });
    const tokenHash = this.hashValue(token);

    const latest = await this.presentialSessionModel
      .findOne({ eventId: event._id, stationId })
      .sort({ rotationNumber: -1, _id: -1 })
      .lean();
    const rotationNumber = Number(latest?.rotationNumber || 0) + 1;

    let created: PresentialSessionDocument;
    try {
      created = await this.presentialSessionModel.create({
        _id: sessionId,
        eventId: event._id,
        stationId,
        tokenId,
        tokenHash,
        status: 'READY',
        expiresAt: this.computeFutureDate(readyTtlSeconds),
        claimedAt: null,
        completedAt: null,
        claimedByCarnetNorm: null,
        createdBy: this.toObjectIdOrNull(requester?.sub),
        rotationNumber,
        claimTtlSeconds: this.clampSeconds(
          options?.claimTtlSeconds,
          30,
          1800,
          this.claimTtlSecondsDefault,
        ),
      });
    } catch (error) {
      if (this.isDuplicateActiveSessionError(error)) {
        const current = await this.getCurrentActiveSession(
          event._id as Types.ObjectId,
          stationId,
        );
        if (current) {
          return current;
        }
      }
      throw error;
    }

    if (options?.rotatedFromSessionId) {
      this.publishRotatedEvent(
        event,
        stationId,
        options.rotatedFromSessionId,
        created,
      );
    }
    this.publishStateEvent('session.ready', event, stationId, created);
    return created;
  }

  private toObjectIdOrNull(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null;
    }
    return new Types.ObjectId(value);
  }

  private isDuplicateActiveSessionError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      Number((error as { code?: unknown }).code) === 11000
    );
  }

  private async requireSessionForEvent(
    eventId: string,
    presentialSessionId: string,
  ) {
    if (!Types.ObjectId.isValid(presentialSessionId)) {
      throw new BadRequestException('presentialSessionId inválido');
    }

    const session =
      await this.presentialSessionModel.findById(presentialSessionId);
    if (!session || String(session.eventId) !== String(eventId)) {
      throw new NotFoundException('Sesión presencial no encontrada');
    }
    return session;
  }

  private async expireStaleSessionsForEvent(
    event: VotingEventDocument,
    stationId?: string,
  ) {
    const filter: Record<string, unknown> = {
      eventId: event._id,
      status: { $in: ['READY', 'CLAIMED'] },
      expiresAt: { $lte: new Date() },
    };
    if (stationId) {
      filter.stationId = stationId;
    }

    const stale = await this.presentialSessionModel
      .find(filter)
      .sort({ expiresAt: 1, _id: 1 })
      .limit(50);

    for (const session of stale) {
      await this.expireSession(session, 'EXPIRED');
    }
  }

  private async expireSessionIfStale(session: PresentialSessionDocument) {
    if (
      ['READY', 'CLAIMED'].includes(session.status) &&
      session.expiresAt.getTime() <= Date.now()
    ) {
      await this.expireSession(session, 'EXPIRED');
    }
  }

  private async expireSession(
    session: PresentialSessionDocument,
    targetStatus: PresentialTerminalReason,
  ) {
    const updated = await this.presentialSessionModel.findOneAndUpdate(
      {
        _id: session._id,
        status: { $in: ['READY', 'CLAIMED'] },
      },
      {
        $set: {
          status: targetStatus,
          expiresAt: new Date(),
        },
      },
      { new: true },
    );

    if (!updated) {
      return null;
    }

    const event = await this.votingEventModel.findById(updated.eventId);
    if (!event) {
      return updated;
    }

    if (targetStatus === 'EXPIRED') {
      this.publishStateEvent(
        'session.expired',
        event,
        updated.stationId,
        updated,
      );
    }

    await this.ensureCurrentReadySession(event, updated.stationId, null, {
      rotatedFromSessionId: String(updated._id),
    });

    return updated;
  }
}
