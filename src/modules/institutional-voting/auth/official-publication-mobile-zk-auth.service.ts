import { auth, resolver } from '@iden3/js-iden3-auth';
import {
  AuthorizationRequestMessage,
  AuthorizationResponseMessage,
} from '@iden3/js-iden3-auth/dist/types/types-sdk';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { Cache } from 'cache-manager';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import path from 'path';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  RoledUser,
  RoledUserDocument,
} from '@/modules/auth/schemas/roledUser.schema';
import { User, UserDocument } from '@/modules/users/schemas/user.schema';
import {
  OfficialPublicationRequest,
  OfficialPublicationRequestDocument,
} from '../schemas/official-publication-request.schema';
import { normalizeCarnet } from '../utils/carnet-normalizer';
import {
  OFFICIAL_PUBLICATION_MOBILE_AUTH_PURPOSE,
  OfficialPublicationMobileAuthContext,
} from './official-publication-mobile-auth.types';

type PendingAuthRequest = {
  apiKeyHash: string;
  requestId: string;
  eventId: string;
  signerUserId: string;
  smartAccountAddress: string;
  request: AuthorizationRequestMessage;
  expiresAt: number;
};

@Injectable()
export class OfficialPublicationMobileZkAuthService {
  private readonly pendingPrefix = 'official-publication-mobile-auth:pending';
  private readonly contextPrefix = 'official-publication-mobile-auth';
  private readonly pending = new Map<string, PendingAuthRequest>();
  private readonly ttlMs: number;
  private readonly pendingTtlMs: number;
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
    @InjectModel(OfficialPublicationRequest.name)
    private readonly requestModel: Model<OfficialPublicationRequestDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {
    this.ttlMs = this.resolvePositiveNumber(
      'app.officialPublicationMobileAuth.ttlMs',
      10 * 60 * 1000,
    );
    this.pendingTtlMs = this.resolvePositiveNumber(
      'app.officialPublicationMobileAuth.pendingTtlMs',
      3 * 60 * 1000,
    );
    this.callbackUrl =
      this.config.get<string>('app.officialPublicationMobileAuth.callbackUrl') || '';
    this.audience = this.config.get<string>('app.zkAuth.audience') || '';
    this.rpcUrl = this.config.get<string>('app.zkAuth.rpcUrl') || '';
    this.network = this.config.get<string>('app.zkAuth.network') || '';
    this.stateContract = this.config.get<string>('app.zkAuth.stateContract') || '';
    this.ipfsGatewayUrl = this.config.get<string>('app.zkAuth.ipfsGatewayUrl') || 'https://ipfs.io';
    this.identityBaseUrl = this.config.get<string>('app.identity.baseUrl') || '';
    this.identityApiKey = this.config.get<string>('app.identity.apiKey') || '';
  }

  async createAuthRequest(requestId: string) {
    this.assertConfigured(['callbackUrl', 'audience']);
    const requestDoc = await this.loadRequest(requestId);
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

    const pending: PendingAuthRequest = {
      apiKeyHash,
      requestId: requestDoc.requestId,
      eventId: String(requestDoc.eventId),
      signerUserId: String(requestDoc.signerUserId),
      smartAccountAddress: requestDoc.smartAccountAddress.toLowerCase(),
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
      throw new BadRequestException('Invalid or expired official publication auth session');
    }

    const verifyResponse = await this.verifyProof(proof, pending.request);
    const did = this.extractDid(verifyResponse);
    if (!did) {
      throw new UnauthorizedException('Verified proof does not contain a subject DID');
    }

    const context = await this.buildContextFromDid(pending, did);
    await this.cacheSet(this.contextCacheKey(context.apiKeyHash), context, this.ttlMs);
    await this.cacheDel(this.pendingCacheKey(sessionId));
    this.pending.delete(sessionId);
    return verifyResponse;
  }

  async getContextByApiKey(
    apiKey: string,
  ): Promise<OfficialPublicationMobileAuthContext | null> {
    const apiKeyHash = this.hashApiKey(apiKey);
    const context = await this.cacheGet<OfficialPublicationMobileAuthContext>(
      this.contextCacheKey(apiKeyHash),
    );
    if (!context || context.purpose !== OFFICIAL_PUBLICATION_MOBILE_AUTH_PURPOSE) {
      return null;
    }
    if (context.apiKeyHash !== apiKeyHash) {
      return null;
    }
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
    pending: PendingAuthRequest,
    did: string,
  ): Promise<OfficialPublicationMobileAuthContext> {
    const requestDoc = await this.loadRequest(pending.requestId);
    if (String(requestDoc.eventId) !== pending.eventId) {
      throw new ForbiddenException('Official publication auth request mismatch');
    }
    const identityAccount = await this.resolveAccountByDid(did);
    if (
      identityAccount.toLowerCase() !==
      String(requestDoc.smartAccountAddress).toLowerCase()
    ) {
      throw new ForbiddenException('Verified identity is not the assigned signer wallet');
    }

    const signerUserId = String(requestDoc.signerUserId);
    if (!Types.ObjectId.isValid(signerUserId)) {
      throw new ForbiddenException('Invalid official publication signer');
    }

    const assignment = await this.assignmentModel
      .findOne({
        tenantId: requestDoc.tenantId,
        userId: new Types.ObjectId(signerUserId),
        active: true,
        accountAddressNormalized: requestDoc.smartAccountAddress.toLowerCase(),
        $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
      })
      .lean();
    if (!assignment) {
      throw new ForbiddenException('Institutional signer assignment not found');
    }

    const roledUser = await this.roledUserModel
      .findOne(
        { _id: new Types.ObjectId(signerUserId), active: true },
        { dni: 1 },
      )
      .lean();
    const dni = normalizeCarnet(roledUser?.dni);
    if (!dni) {
      throw new ForbiddenException('Institutional signer identity is incomplete');
    }

    const mobileUser = await this.userModel
      .findOne({ dni, active: { $ne: false } }, { _id: 1 })
      .lean();
    if (!mobileUser) {
      throw new ForbiddenException('Mobile user not found for institutional signer');
    }

    const apiKeyHash = pending.apiKeyHash;
    if (!apiKeyHash) {
      throw new ForbiddenException('Official publication API key binding missing');
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + this.ttlMs);
    return {
      apiKeyHash,
      requestId: requestDoc.requestId,
      eventId: String(requestDoc.eventId),
      did,
      dni,
      subjectId: signerUserId,
      smartAccountAddress: requestDoc.smartAccountAddress.toLowerCase(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      purpose: OFFICIAL_PUBLICATION_MOBILE_AUTH_PURPOSE,
    };
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
      [this.network]: new resolver.EthStateResolver(
        this.rpcUrl,
        this.stateContract,
      ),
    };
    const verifier = await auth.Verifier.newVerifier({
      stateResolver: resolvers,
      circuitsDir: keyDir,
      ipfsGatewayURL: this.ipfsGatewayUrl,
    });

    try {
      const opts = {
        acceptedStateTransitionDelay: 5 * 60 * 1000,
      };
      return await verifier.fullVerify(proof, request, opts);
    } catch {
      throw new UnauthorizedException('Official publication ZK verification failed');
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

  private async loadRequest(requestId: string) {
    const request = await this.requestModel.findOne({ requestId });
    if (!request) {
      throw new BadRequestException('Official publication request not found');
    }
    return request;
  }

  private async getPending(sessionId: string): Promise<PendingAuthRequest | null> {
    const inMemory = this.pending.get(sessionId);
    if (inMemory) {
      return inMemory;
    }
    return this.cacheGet<PendingAuthRequest>(this.pendingCacheKey(sessionId));
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
        `Missing official publication mobile auth configuration: ${missing.join(', ')}`,
      );
    }
  }

  private resolvePositiveNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<number>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
