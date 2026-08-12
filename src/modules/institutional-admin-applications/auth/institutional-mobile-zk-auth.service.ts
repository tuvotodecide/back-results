import { auth, resolver } from '@iden3/js-iden3-auth';
import {
  AuthorizationRequestMessage,
  AuthorizationResponseMessage,
} from '@iden3/js-iden3-auth/dist/types/types-sdk';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Cache } from 'cache-manager';
import { createHash, randomBytes } from 'crypto';
import path from 'path';
import { ClientSession, Model, Types } from 'mongoose';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationDocument,
} from '../schemas/institutional-admin-application.schema';
import {
  InstitutionalAdminInvitation,
  InstitutionalAdminInvitationDocument,
} from '../schemas/institutional-admin-invitation.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  RoledUser,
  RoledUserDocument,
} from '@/modules/auth/schemas/roledUser.schema';
import {
  INSTITUTIONAL_INVITATION_MOBILE_AUTH_PURPOSE,
  InstitutionalInvitationRegistrationContinuation,
  INSTITUTIONAL_MOBILE_AUTH_PURPOSE,
  InstitutionalMobileAuthContext,
  InstitutionalInvitationMobileAuthContext,
} from './institutional-mobile-auth.types';

type PendingInstitutionalAuthorizationAuthRequest = {
  kind: 'AUTHORIZATION';
  apiKeyHash: string;
  applicationId: string;
  tenantId: string;
  signerUserId: string;
  smartAccountAddress: string;
  request: AuthorizationRequestMessage;
  expiresAt: number;
};

type PendingInstitutionalInvitationAuthRequest = {
  kind: 'INVITATION';
  apiKeyHash: string;
  invitationId: string;
  tenantId: string;
  dni: string;
  smartAccountAddress: string;
  request: AuthorizationRequestMessage;
  expiresAt: number;
};

type PendingInstitutionalAuthRequest =
  | PendingInstitutionalAuthorizationAuthRequest
  | PendingInstitutionalInvitationAuthRequest;

type InstitutionalMobileAuthAnyContext =
  | InstitutionalMobileAuthContext
  | InstitutionalInvitationMobileAuthContext;

@Injectable()
export class InstitutionalMobileZkAuthService {
  private readonly pendingPrefix = 'institutional-mobile-auth:pending';
  private readonly contextPrefix = 'institutional-mobile-auth';
  private readonly pending = new Map<string, PendingInstitutionalAuthRequest>();
  private readonly ttlMs: number;
  private readonly pendingTtlMs: number;
  private readonly registrationContinuationTtlMs: number;
  private readonly callbackUrl: string;
  private readonly audience: string;
  private readonly network: string;
  private readonly rpcUrl: string;
  private readonly stateContract: string;
  private readonly ipfsGatewayUrl: string;
  private readonly identityBaseUrl: string;
  private readonly identityApiKey: string;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    @InjectModel(InstitutionalAdminApplication.name)
    private readonly applicationModel: Model<InstitutionalAdminApplicationDocument>,
    @InjectModel(InstitutionalAdminInvitation.name)
    private readonly invitationModel: Model<InstitutionalAdminInvitationDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
  ) {
    this.ttlMs = this.resolvePositiveNumber(
      'app.institutionalMobileAuth.ttlMs',
      this.resolvePositiveNumber('app.officialPublicationMobileAuth.ttlMs', 10 * 60 * 1000),
    );
    this.pendingTtlMs = this.resolvePositiveNumber(
      'app.institutionalMobileAuth.pendingTtlMs',
      this.resolvePositiveNumber('app.officialPublicationMobileAuth.pendingTtlMs', 3 * 60 * 1000),
    );
    this.registrationContinuationTtlMs = this.resolvePositiveNumber(
      'app.institutionalMobileAuth.registrationContinuationTtlMs',
      5 * 60 * 1000,
    );
    this.callbackUrl =
      this.config.get<string>('app.institutionalMobileAuth.callbackUrl') || '';
    this.audience = this.config.get<string>('app.zkAuth.audience') || '';
    this.rpcUrl = this.config.get<string>('app.zkAuth.rpcUrl') || '';
    this.network = this.config.get<string>('app.zkAuth.network') || '';
    this.stateContract = this.config.get<string>('app.zkAuth.stateContract') || '';
    this.ipfsGatewayUrl = this.config.get<string>('app.zkAuth.ipfsGatewayUrl') || 'https://ipfs.io';
    this.identityBaseUrl = this.config.get<string>('app.identity.baseUrl') || '';
    this.identityApiKey = this.config.get<string>('app.identity.apiKey') || '';
  }

  async createAuthRequest(applicationId: string): Promise<{
    apiKey: string,
    request: AuthorizationRequestMessage,
    expiresAt: string,
  }> {
    this.assertConfigured(['callbackUrl', 'audience']);
    const { application, primary } = await this.loadApplicationContext(applicationId);
    const sessionId = randomBytes(32).toString('hex');
    const apiKey = sessionId;
    const apiKeyHash = this.hashApiKey(apiKey);
    const expiresAt = Date.now() + this.pendingTtlMs;
    const uri = `${this.callbackUrl}?sessionId=${sessionId}`;
    const request = auth.createAuthorizationRequest(
      'Auth request to get api-key',
      this.audience,
      uri,
    );

    const pending: PendingInstitutionalAuthRequest = {
      kind: 'AUTHORIZATION',
      apiKeyHash,
      applicationId: String(application._id),
      tenantId: String(application.tenantId),
      signerUserId: String(primary.userId),
      smartAccountAddress: String(primary.accountAddress).toLowerCase(),
      request,
      expiresAt,
    };
    this.pending.set(sessionId, pending);
    await this.cacheSet(this.pendingCacheKey(sessionId), pending, this.pendingTtlMs);

    return {
      apiKey,
      request,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    };
  }

  async createInvitationAuthRequest(invitationId: string): Promise<{
    apiKey: string,
    request: AuthorizationRequestMessage,
    expiresAt: string,
  }> {
    this.assertConfigured(['callbackUrl', 'audience']);
    const invitation = await this.loadInvitationContext(invitationId);
    const sessionId = randomBytes(32).toString('hex');
    const apiKey = sessionId;
    const apiKeyHash = this.hashApiKey(apiKey);
    const expiresAt = Date.now() + this.pendingTtlMs;
    const uri = `${this.callbackUrl}?sessionId=${sessionId}`;
    const request = auth.createAuthorizationRequest(
      'Auth request to access an institutional invitation',
      this.audience,
      uri,
    );

    const pending: PendingInstitutionalInvitationAuthRequest = {
      kind: 'INVITATION',
      apiKeyHash,
      invitationId: String(invitation._id),
      tenantId: String(invitation.tenantId),
      dni: invitation.dni,
      smartAccountAddress: String(invitation.accountAddress).toLowerCase(),
      request,
      expiresAt,
    };
    this.pending.set(sessionId, pending);
    await this.cacheSet(this.pendingCacheKey(sessionId), pending, this.pendingTtlMs);

    return {
      apiKey,
      request,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    };
  }

  async callback(
    sessionId: string,
    proof: string,
  ): Promise<AuthorizationResponseMessage> {
    const pending = await this.getPending(sessionId);
    if (!pending || pending.expiresAt <= Date.now()) {
      throw new BadRequestException('Invalid or expired institutional auth session');
    }

    const verifyResponse = await this.verifyProof(proof, pending.request);
    const did = this.extractDid(verifyResponse);
    if (!did) {
      throw new UnauthorizedException('Verified proof does not contain a subject DID');
    }

    const context = pending.kind === 'INVITATION'
      ? await this.buildInvitationContextFromDid(pending, did)
      : await this.buildContextFromDid(pending, did);
    await this.cacheSet(this.contextCacheKey(context.apiKeyHash), context, this.ttlMs);
    await this.cacheDel(this.pendingCacheKey(sessionId));
    this.pending.delete(sessionId);
    return verifyResponse;
  }

  async getContextByApiKey(apiKey: string): Promise<InstitutionalMobileAuthAnyContext | null> {
    const apiKeyHash = this.hashApiKey(apiKey);
    const context = await this.cacheGet<InstitutionalMobileAuthAnyContext>(
      this.contextCacheKey(apiKeyHash),
    );
    if (!context || ![INSTITUTIONAL_MOBILE_AUTH_PURPOSE, INSTITUTIONAL_INVITATION_MOBILE_AUTH_PURPOSE].includes(context.purpose)) return null;
    if (context.apiKeyHash !== apiKeyHash) return null;
    if (!context.expiresAt || new Date(context.expiresAt).getTime() <= Date.now()) {
      await this.cacheDel(this.contextCacheKey(apiKeyHash));
      return null;
    }
    return context;
  }

  hashApiKey(apiKey: string) {
    return createHash('sha256').update(apiKey).digest('hex');
  }

  private async buildContextFromDid(
    pending: PendingInstitutionalAuthorizationAuthRequest,
    did: string,
  ): Promise<InstitutionalMobileAuthContext> {
    const { application, primary } = await this.loadApplicationContext(pending.applicationId);
    if (String(application.tenantId) !== pending.tenantId) {
      throw new ForbiddenException('Institutional auth request mismatch');
    }
    if (String(primary.userId) !== pending.signerUserId) {
      throw new ForbiddenException('Institutional signer mismatch');
    }

    const identityAccount = await this.resolveAccountByDid(did);
    if (identityAccount.toLowerCase() !== String(primary.accountAddress).toLowerCase()) {
      throw new ForbiddenException('Verified identity is not the assigned signer wallet');
    }

    const roledUser = await this.roledUserModel
      .findOne({ _id: primary.userId, active: true }, { dni: 1 })
      .lean();
    const dni = String(roledUser?.dni || '').trim();
    if (!dni) {
      throw new ForbiddenException('Institutional signer identity is incomplete');
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + this.ttlMs);
    return {
      apiKeyHash: pending.apiKeyHash,
      applicationId: String(application._id),
      tenantId: String(application.tenantId),
      signerUserId: String(primary.userId),
      did,
      dni,
      smartAccountAddress: String(primary.accountAddress).toLowerCase(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      purpose: INSTITUTIONAL_MOBILE_AUTH_PURPOSE,
    };
  }

  /**
   * Exchanges a verified mobile-ZK context for a short-lived, opaque D3
   * continuation.  It intentionally does not carry an API key, proof, or
   * administrative user id to the browser.
   */
  async issueInvitationRegistrationContinuation(
    mobileAuthContextHash: string,
  ): Promise<{ continuationCode: string; expiresAt: string }> {
    const context = await this.cacheGet<InstitutionalInvitationMobileAuthContext>(
      this.contextCacheKey(mobileAuthContextHash),
    );
    if (
      !context ||
      context.purpose !== INSTITUTIONAL_INVITATION_MOBILE_AUTH_PURPOSE ||
      context.apiKeyHash !== mobileAuthContextHash ||
      new Date(context.expiresAt).getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Institutional invitation mobile session expired');
    }

    const now = Date.now();
    const remainingContextMs = new Date(context.expiresAt).getTime() - now;
    const ttlMs = Math.min(this.registrationContinuationTtlMs, remainingContextMs);
    if (ttlMs <= 0) {
      throw new UnauthorizedException('Institutional invitation mobile session expired');
    }
    const continuationCode = randomBytes(32).toString('hex');
    const expiresAt = new Date(now + ttlMs).toISOString();
    const continuation: InstitutionalInvitationRegistrationContinuation = {
      purpose: 'D3_ADMIN_REGISTRATION',
      invitationId: context.invitationId,
      tenantId: context.tenantId,
      dni: context.dni,
      smartAccountAddress: context.smartAccountAddress,
      did: context.did,
      mobileAuthContextHash,
      issuedAt: new Date(now).toISOString(),
      expiresAt,
    };
    const updated = await this.invitationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(context.invitationId),
        status: 'PENDING',
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          registrationContinuationCodeHash: this.hashApiKey(continuationCode),
          registrationContinuationState: 'AVAILABLE',
          registrationContinuationExpiresAt: new Date(expiresAt),
          registrationContinuationClaimExpiresAt: null,
          registrationContinuationClaimId: null,
          registrationContinuationCompletedAt: null,
          registrationContinuationDid: context.did,
          registrationContinuationMobileAuthContextHash: mobileAuthContextHash,
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      throw new UnauthorizedException('Institutional invitation is no longer available');
    }
    return { continuationCode, expiresAt };
  }

  async getInvitationRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
  ): Promise<InstitutionalInvitationRegistrationContinuation> {
    const code = String(continuationCode || '').trim();
    if (!code) {
      throw new UnauthorizedException('Institutional registration continuation is required');
    }
    return this.loadRegistrationContinuation(code, invitationId);
  }

  async claimInvitationRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
  ): Promise<{ claimId: string; continuation: InstitutionalInvitationRegistrationContinuation }> {
    const code = String(continuationCode || '').trim();
    const continuation = await this.loadRegistrationContinuation(code, invitationId);
    if (continuation.state === 'COMPLETED') {
      throw new ForbiddenException('Institutional registration continuation already completed');
    }
    const now = new Date();
    const claimId = randomBytes(32).toString('hex');
    const claimed = await this.invitationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(invitationId),
        registrationContinuationCodeHash: this.hashApiKey(code),
        registrationContinuationExpiresAt: { $gt: now },
        $or: [
          { registrationContinuationState: 'AVAILABLE' },
          {
            registrationContinuationState: 'CLAIMED',
            registrationContinuationClaimExpiresAt: { $lte: now },
          },
        ],
      },
      {
        $set: {
          registrationContinuationState: 'CLAIMED',
          registrationContinuationClaimId: claimId,
          registrationContinuationClaimExpiresAt: new Date(
            Math.min(
              new Date(continuation.expiresAt).getTime(),
              now.getTime() + 2 * 60_000,
            ),
          ),
        },
      },
      { returnDocument: 'after' },
    );
    if (!claimed) {
      const current = await this.loadRegistrationContinuation(code, invitationId);
      if (current.state === 'COMPLETED') {
        throw new ForbiddenException('Institutional registration continuation already completed');
      }
      throw new ConflictException('Institutional registration is already being processed');
    }
    return { claimId, continuation: { ...continuation, state: 'CLAIMED' } };
  }

  async completeInvitationRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
    claimId: string,
    applicationId: string,
    session?: ClientSession,
  ): Promise<void> {
    const query = this.invitationModel.updateOne(
      {
        _id: new Types.ObjectId(invitationId),
        registrationContinuationCodeHash: this.hashApiKey(String(continuationCode || '').trim()),
        registrationContinuationState: 'CLAIMED',
        registrationContinuationClaimId: claimId,
      },
      {
        $set: {
          registrationContinuationState: 'COMPLETED',
          registrationContinuationCompletedAt: new Date(),
          applicationId: new Types.ObjectId(applicationId),
        },
        $unset: {
          registrationContinuationClaimId: '',
          registrationContinuationClaimExpiresAt: '',
        },
      },
    );
    if (session) query.session(session);
    const result = await query;
    if (result.modifiedCount !== 1) {
      throw new ConflictException('Institutional registration continuation claim was lost');
    }
  }

  async releaseInvitationRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
    claimId: string,
  ): Promise<void> {
    await this.invitationModel.updateOne(
      {
        _id: new Types.ObjectId(invitationId),
        registrationContinuationCodeHash: this.hashApiKey(String(continuationCode || '').trim()),
        registrationContinuationState: 'CLAIMED',
        registrationContinuationClaimId: claimId,
      },
      {
        $set: { registrationContinuationState: 'AVAILABLE' },
        $unset: {
          registrationContinuationClaimId: '',
          registrationContinuationClaimExpiresAt: '',
        },
      },
    );
  }

  private async loadRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
  ): Promise<InstitutionalInvitationRegistrationContinuation> {
    const code = String(continuationCode || '').trim();
    if (!code) {
      throw new UnauthorizedException('Institutional registration continuation is required');
    }
    if (!Types.ObjectId.isValid(invitationId)) {
      throw new ForbiddenException('Institutional registration continuation mismatch');
    }
    const invitation = await this.invitationModel.findById(invitationId).select(
      '+registrationContinuationCodeHash +registrationContinuationClaimId',
    ).lean();
    if (!invitation) {
      throw new ForbiddenException('Institutional registration continuation mismatch');
    }
    if (
      invitation.registrationContinuationCodeHash !== this.hashApiKey(code) ||
      !invitation.registrationContinuationExpiresAt ||
      invitation.registrationContinuationExpiresAt.getTime() <= Date.now() ||
      !invitation.registrationContinuationDid ||
      !invitation.registrationContinuationMobileAuthContextHash
    ) {
      throw new UnauthorizedException('Institutional registration continuation expired');
    }
    return {
      purpose: 'D3_ADMIN_REGISTRATION',
      invitationId: String(invitation._id),
      tenantId: String(invitation.tenantId),
      dni: invitation.dni,
      smartAccountAddress: String(invitation.accountAddress).toLowerCase(),
      did: invitation.registrationContinuationDid,
      mobileAuthContextHash: invitation.registrationContinuationMobileAuthContextHash,
      issuedAt: (invitation as any).createdAt?.toISOString?.() ?? new Date().toISOString(),
      expiresAt: invitation.registrationContinuationExpiresAt.toISOString(),
      usedAt: invitation.registrationContinuationCompletedAt?.toISOString(),
      state: invitation.registrationContinuationState ?? 'AVAILABLE',
    };
  }

  private async buildInvitationContextFromDid(
    pending: PendingInstitutionalInvitationAuthRequest,
    did: string,
  ): Promise<InstitutionalInvitationMobileAuthContext> {
    const invitation = await this.loadInvitationContext(pending.invitationId);
    if (
      String(invitation.tenantId) !== pending.tenantId ||
      invitation.dni !== pending.dni ||
      String(invitation.accountAddress).toLowerCase() !== pending.smartAccountAddress
    ) {
      throw new ForbiddenException('Institutional invitation request mismatch');
    }

    const identityAccount = await this.resolveAccountByDid(did);
    if (identityAccount.toLowerCase() !== pending.smartAccountAddress) {
      throw new ForbiddenException('Verified identity is not the invited wallet');
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + this.ttlMs);
    return {
      apiKeyHash: pending.apiKeyHash,
      invitationId: String(invitation._id),
      tenantId: String(invitation.tenantId),
      did,
      dni: invitation.dni,
      smartAccountAddress: pending.smartAccountAddress,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      purpose: INSTITUTIONAL_INVITATION_MOBILE_AUTH_PURPOSE,
    };
  }

  private async loadApplicationContext(applicationId: string) {
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new BadRequestException('Institutional authorization request not found');
    }
    const application = await this.applicationModel.findById(applicationId).lean();
    if (!application?.tenantId) {
      throw new BadRequestException('Institutional authorization request not found');
    }
    const primaryFilter: Record<string, any> = {
      tenantId: application.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    };
    const isPendingPrimaryTransfer =
      application.mobileAuthorizationAction === 'CHANGE_INSTITUTION_ADMIN' &&
      !['APPROVED', 'REJECTED', 'REVOKED'].includes(String(application.status));
    if (isPendingPrimaryTransfer) {
      if (!application.approvedBy) {
        throw new ForbiddenException('Institutional primary signer not found');
      }
      if (!application.initiatedByAssignmentId || !application.initiatedByWallet) {
        throw new ForbiddenException('Institutional primary signer is not bound to this request');
      }
      primaryFilter._id = application.initiatedByAssignmentId;
      primaryFilter.userId = application.approvedBy;
    }
    const primary = await this.assignmentModel
      .findOne(primaryFilter)
      .lean();
    if (!primary?.userId || !primary.accountAddress) {
      throw new ForbiddenException('Institutional primary signer not found');
    }
    if (isPendingPrimaryTransfer) {
      if (
        String(primary.accountAddress).toLowerCase() !==
        String(application.initiatedByWallet).toLowerCase()
      ) {
        throw new ForbiddenException('Institutional primary signer wallet changed');
      }
      const target = await this.assignmentModel.findOne({
        _id: application.targetAssignmentId,
        tenantId: application.tenantId,
        userId: application.userId,
        institutionalRole: 'SECONDARY',
        active: true,
        status: 'APPROVED',
      }).lean();
      if (
        !target?.accountAddress ||
        String(target.accountAddress).toLowerCase() !==
          String(application.accountAddress).toLowerCase()
      ) {
        throw new ForbiddenException('Institutional primary transfer target is not eligible');
      }
    }
    return { application, primary };
  }

  private async loadInvitationContext(invitationId: string) {
    if (!Types.ObjectId.isValid(invitationId)) {
      throw new BadRequestException('Institutional invitation not found');
    }
    const invitation = await this.invitationModel.findById(invitationId).lean();
    if (
      !invitation ||
      invitation.status !== 'PENDING' ||
      new Date(invitation.expiresAt).getTime() <= Date.now()
    ) {
      throw new BadRequestException('Institutional invitation is not available');
    }
    return invitation;
  }

  private async resolveAccountByDid(did: string): Promise<string> {
    this.assertConfigured(['identityBaseUrl', 'identityApiKey']);
    const url = `${this.identityBaseUrl.replace(/\/+$/, '')}/registry/by-did`;
    const response = await this.http.axiosRef.get(url, {
      params: { did },
      headers: { 'x-api-key': this.identityApiKey },
    });
    const account = response.data?.record?.accountAddress;
    if (!response.data?.ok || typeof account !== 'string' || !account.trim()) {
      throw new ForbiddenException('Verified DID is not registered with a wallet');
    }
    return account.trim();
  }

  private async verifyProof(
    proof: string,
    request: AuthorizationRequestMessage,
  ): Promise<AuthorizationResponseMessage> {
    this.assertConfigured(['network', 'rpcUrl', 'stateContract']);
    const keyDir = path.join(__dirname, '../../../../../circuits');
    const resolvers = {
      [this.network]: new resolver.EthStateResolver(this.rpcUrl, this.stateContract),
    };
    const verifier = await auth.Verifier.newVerifier({
      stateResolver: resolvers,
      circuitsDir: keyDir,
      ipfsGatewayURL: this.ipfsGatewayUrl,
    });
    try {
      return await verifier.fullVerify(proof, request, {
        acceptedStateTransitionDelay: 5 * 60 * 1000,
      });
    } catch {
      throw new UnauthorizedException('Institutional mobile ZK verification failed');
    }
  }

  private extractDid(response: any): string {
    const candidates = [
      response?.from,
      response?.body?.from,
      response?.body?.message?.from,
      response?.body?.scope?.[0]?.credentialSubject?.id,
      response?.body?.scope?.[0]?.claim?.credentialSubject?.id,
    ];
    return String(candidates.find((value) => typeof value === 'string' && value.trim()) ?? '').trim();
  }

  private async getPending(sessionId: string): Promise<PendingInstitutionalAuthRequest | null> {
    const inMemory = this.pending.get(sessionId);
    if (inMemory) return inMemory;
    return this.cacheGet<PendingInstitutionalAuthRequest>(this.pendingCacheKey(sessionId));
  }

  private pendingCacheKey(sessionId: string) {
    return `${this.pendingPrefix}:${sessionId}`;
  }

  private contextCacheKey(apiKeyHash: string) {
    return `${this.contextPrefix}:${apiKeyHash}`;
  }

  private async cacheGet<T>(key: string): Promise<T | null> {
    const value = await this.cache.get<T | string>(key);
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    return value as T;
  }

  private async cacheSet(key: string, value: unknown, ttlMs: number) {
    await this.cache.set(key, value, ttlMs);
  }

  private async cacheDel(key: string) {
    const store = this.cache as any;
    if (typeof store.del === 'function') {
      await store.del(key);
    }
  }

  private assertConfigured(keys: Array<
    | 'callbackUrl'
    | 'audience'
    | 'network'
    | 'rpcUrl'
    | 'stateContract'
    | 'identityBaseUrl'
    | 'identityApiKey'
  >) {
    const missing = keys.filter((key) => !this[key]);
    if (missing.length) {
      throw new InternalServerErrorException(
        `Missing institutional mobile auth configuration: ${missing.join(', ')}`,
      );
    }
  }

  private resolvePositiveNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<number>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
