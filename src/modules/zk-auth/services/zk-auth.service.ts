import { auth, resolver } from '@iden3/js-iden3-auth';
import { AuthorizationRequestMessage, AuthorizationResponseMessage } from '@iden3/js-iden3-auth/dist/types/types-sdk';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { randomBytes } from 'crypto';
import path from 'path';

@Injectable()
export class ZkAuthService {
  private readonly cachePrefix = 'zk-auth:api-key';
  private readonly ttlSeconds: number;
  private readonly callbackUrl: string;
  private readonly audience: string;
	private readonly network: string;
	private readonly rpcUrl: string;
	private readonly stateContract: string;
	private readonly ipfsGatewayUrl: string;
	private requests: Map<string, AuthorizationRequestMessage> = new Map();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly config: ConfigService,
  ) {
    const ttl = Number(this.config.get<number>('app.zkAuth.zkAuthTtl'));
    this.ttlSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 24 * 60 * 60;
    const callback = this.config.get<string>('app.zkAuth.callbackUrl');
    const audience = this.config.get<string>('app.zkAuth.audience');
		const rpc = this.config.get<string>('app.zkAuth.rpcUrl');
		const network = this.config.get<string>('app.zkAuth.network');
		const stateContract = this.config.get<string>('app.zkAuth.stateContract');
		const ipfsGateway = this.config.get<string>('app.zkAuth.ipfsGatewayUrl');

    if (!audience || !callback || !rpc || !network || !stateContract || !ipfsGateway) {
      throw new Error('ZK Auth env variables are not configured');
    }
    this.callbackUrl = callback;
    this.audience = audience;
		this.rpcUrl = rpc;
		this.network = network;
		this.stateContract = stateContract;
		this.ipfsGatewayUrl = ipfsGateway;
  }

  generateRequest(): { apiKey: string; request: AuthorizationRequestMessage } {
    const sessionId = randomBytes(32).toString('hex');
    const uri = `${this.callbackUrl}?sessionId=${sessionId}`;

    const request = auth.createAuthorizationRequest(
			"Auth request to get api-key",
			this.audience,
			uri
		);

		this.requests.set(sessionId, request);
    return { apiKey: sessionId, request };
  }

	async zkAuthCallback(sessionId: string, zkProof: string): Promise<AuthorizationResponseMessage> {
		const request = this.requests.get(sessionId);
		if (!request) {
			throw new BadRequestException('Invalid session ID');
		}

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
			const authResponse = await verifier.fullVerify(zkProof, request, opts);
			this.saveApiKey(sessionId); // Save the API key associated with this session, making it valid for future requests
			return authResponse
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
