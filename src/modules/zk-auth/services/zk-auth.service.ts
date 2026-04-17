import { auth, resolver } from '@iden3/js-iden3-auth';
import { AuthorizationRequestMessage, AuthorizationResponseMessage, ZeroKnowledgeProofRequest } from '@iden3/js-iden3-auth/dist/types/types-sdk';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, Inject, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { randomBytes } from 'crypto';
import path from 'path';

export type ZkRequestType = 'vote';

@Injectable()
export class ZkAuthService {
  private readonly cachePrefix = 'zk-auth:api-key';
  private readonly ttlSeconds: number;
  private readonly callbackUrl: string;
	private readonly voteCallbackUrl: string;
  private readonly audience: string;
	private readonly network: string;
	private readonly rpcUrl: string;
	private readonly stateContract: string;
	private readonly ipfsGatewayUrl: string;
	private readonly credContext: string;
	private readonly credType: string;
  private readonly issuerDid: string;
	private authRequests: Map<string, AuthorizationRequestMessage> = new Map();
	private requests: Map<ZkRequestType, AuthorizationRequestMessage> = new Map();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly config: ConfigService,
  ) {
    const ttl = Number(this.config.get<number>('app.zkAuth.zkAuthTtl'));
    this.ttlSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 24 * 60 * 60;
    const callback = this.config.get<string>('app.zkAuth.callbackUrl');
    const voteCallback = this.config.get<string>('app.zkAuth.voteCallbackUrl');
    const audience = this.config.get<string>('app.zkAuth.audience');
		const rpc = this.config.get<string>('app.zkAuth.rpcUrl');
		const network = this.config.get<string>('app.zkAuth.network');
		const stateContract = this.config.get<string>('app.zkAuth.stateContract');
		const ipfsGateway = this.config.get<string>('app.zkAuth.ipfsGatewayUrl');
		const credContext = this.config.get<string>('app.zkAuth.credContext');
		const credType = this.config.get<string>('app.zkAuth.credType');
		const issuerDid = this.config.get<string>('app.issuer.did');	

    if (!audience || !callback || !voteCallback || !rpc || !network || !stateContract || !ipfsGateway || !credContext || !credType || !issuerDid) {
      throw new Error('ZK Auth env variables are not configured');
    }
    this.callbackUrl = callback;
    this.voteCallbackUrl = voteCallback;
    this.audience = audience;
		this.rpcUrl = rpc;
		this.network = network;
		this.stateContract = stateContract;
		this.ipfsGatewayUrl = ipfsGateway;
		this.credContext = credContext;
		this.credType = credType;
		this.issuerDid = issuerDid;

		this.generateVoteRequest();
  }

	private generateVoteRequest() {
    const uri = `${this.voteCallbackUrl}`;

		const request = auth.createAuthorizationRequest(
			"Auth request to submit a vote",
			this.audience,
			uri
		);

		const eventIdProof: ZeroKnowledgeProofRequest = {
			id: 1,
			circuitId: 'credentialAtomicQuerySigV2' as any,
			query: {
				allowedIssuers: [this.issuerDid],
				type: this.credType,
				context: this.credContext,
				credentialSubject: {
					eventId: {},
				},
			},
		};

		const nullifierProof: ZeroKnowledgeProofRequest = {
			id: 2,
			circuitId: 'credentialAtomicQuerySigV2' as any,
			query: {
				allowedIssuers: [this.issuerDid],
				type: this.credType,
				context: this.credContext,
				credentialSubject: {
					nullifier: {},
				},
			},
		};

		const scope = request.body.scope ?? [];
		request.body.scope = [...scope, eventIdProof, nullifierProof];

		this.requests.set('vote', request);
	}

  getAuthRequest(): { apiKey: string; request: AuthorizationRequestMessage } {
    const sessionId = randomBytes(32).toString('hex');
		const uri = `${this.callbackUrl}?sessionId=${sessionId}`;

		const request = auth.createAuthorizationRequest(
			"Auth request to get api-key",
			this.audience,
			uri
		);

		this.authRequests.set(sessionId, request);
    return { apiKey: sessionId, request };
  }

	getVoteRequest(): { request: AuthorizationRequestMessage } {
		const request = this.requests.get('vote');
		if (!request) {
			throw new InternalServerErrorException('Vote request not found');
		}

		return { request };
	}

	async zkAuthCallback(sessionId: string, zkProof: string): Promise<AuthorizationResponseMessage> {
		const request = this.authRequests.get(sessionId);
		if (!request) {
			throw new BadRequestException('Invalid session ID');
		}

		const response = await this.callback(request, zkProof);
		this.saveApiKey(sessionId); // Save the API key associated with this session, making it valid for future requests
		return response;
	}

	async zkRequestCallback(sessionId: ZkRequestType, zkProof: string): Promise<AuthorizationResponseMessage> {
		const request = this.requests.get(sessionId);
		if (!request) {
			throw new BadRequestException('Invalid session ID');
		}

		return await this.callback(request, zkProof);
	}

	private async callback(request: AuthorizationRequestMessage, zkProof: string): Promise<AuthorizationResponseMessage> {
		const keyDir = path.join(__dirname, '../../../../../circuits');

		const resolvers = {
			[this.network]: new resolver.EthStateResolver(
				this.rpcUrl,
				this.stateContract
			)
		};

		const verifier = await auth.Verifier.newVerifier({
			stateResolver: resolvers,
			circuitsDir: keyDir,
			ipfsGatewayURL: this.ipfsGatewayUrl
		});

		try {
			const opts = {
				acceptedStateTransitionDelay: 5 * 60 * 1000, // 5 minutes
			};
			const verifyResponse = await verifier.fullVerify(zkProof, request, opts);
			return verifyResponse
		} catch (error) {
			console.log('ZK verification error:', error);
			throw new UnauthorizedException('ZK verification failed');
		}
	}

  async saveApiKey(apiKey: string): Promise<void> {
    await this.cache.set(`${this.cachePrefix}:${apiKey}`, true, this.ttlSeconds);
  }

  async isApiKeyValid(apiKey: string): Promise<boolean> {
    const stored = await this.cache.get<boolean>(`${this.cachePrefix}:${apiKey}`);
    return Boolean(stored);
  }
}
