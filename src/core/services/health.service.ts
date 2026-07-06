/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import * as admin from 'firebase-admin';
import { Connection } from 'mongoose';
import { createClient, RedisClientType } from 'redis';
import { arbitrum, arbitrumSepolia, base, baseSepolia } from 'viem/chains';

type HealthState = 'ok' | 'degraded' | 'down' | 'skipped';

type HealthCheck = {
  status: HealthState;
  critical: boolean;
  configured?: boolean;
  message?: string;
  latencyMs?: number;
};

type ReadinessStatus = {
  status: 'ok' | 'down';
  timestamp: string;
  uptime: number;
  environment: string | undefined;
  version: string;
  checks: {
    database: HealthCheck & {
      readyState: string;
      name?: string;
    };
    redis: HealthCheck;
    firebase: HealthCheck;
    gemini?: HealthCheck;
    ipfs?: HealthCheck;
    blockchainRpc?: HealthCheck;
  };
};

type ExternalHealthStatus = {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  checks: {
    gemini: HealthCheck;
    ipfsGateway: HealthCheck;
    blockchainRpc: HealthCheck;
  };
};

const CHECK_TIMEOUT_MS = 2000;
const EXTERNAL_CHECK_TIMEOUT_MS = 2500;

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private configService: ConfigService,
  ) {}

  getHealthStatus() {
    const mongoStatus = this.getMongoStatus();
    const appInfo = this.getAppInfo();
    const preparedExternals = this.getPreparedExternalChecks();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: this.configService.get<string>('app.nodeEnv'),
      version: this.configService.get<string>('app.version') || '1.0.0',
      services: {
        database: mongoStatus,
        redis: this.getRedisConfigStatus(),
        firebase: this.getFirebaseStatus(),
      },
      externals: preparedExternals,
      ...appInfo,
    };
  }

  getLivenessStatus() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: this.configService.get<string>('app.nodeEnv'),
      version: this.configService.get<string>('app.version') || '1.0.0',
    };
  }

  async getReadinessStatus(): Promise<ReadinessStatus> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const firebase = this.getFirebaseStatus();

    const checks = {
      database,
      redis,
      firebase,
    };
    const criticalChecks = [database, redis, firebase];
    const hasCriticalDown = criticalChecks.some((check) => check.status !== 'ok');

    return {
      status: hasCriticalDown ? 'down' : 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: this.configService.get<string>('app.nodeEnv'),
      version: this.configService.get<string>('app.version') || '1.0.0',
      checks,
    };
  }

  async getExternalHealthStatus(): Promise<ExternalHealthStatus> {
    const [gemini, ipfsGateway, blockchainRpc] = await Promise.all([
      this.checkGeminiExternal(),
      this.checkIpfsGatewayExternal(),
      this.checkBlockchainRpcExternal(),
    ]);
    const checks = { gemini, ipfsGateway, blockchainRpc };
    const values = Object.values(checks);
    const configuredChecks = values.filter((check) => check.configured);
    const allConfiguredChecksDown =
      configuredChecks.length > 0 &&
      configuredChecks.every((check) => check.status === 'down');
    const hasIssue = values.some((check) => check.status !== 'ok');

    return {
      status: allConfiguredChecksDown ? 'down' : hasIssue ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private getMongoStatus() {
    const state: number = this.connection.readyState;
    const states: { [key: number]: string } = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };

    return {
      status: states[state] || 'unknown',
      host: this.connection.host,
      name: this.connection.name,
    };
  }

  private async checkDatabase(): Promise<ReadinessStatus['checks']['database']> {
    const startedAt = Date.now();
    const readyState = this.getMongoStatus().status;

    if (this.connection.readyState !== 1) {
      return {
        status: 'down',
        critical: true,
        readyState,
        name: this.connection.name,
        latencyMs: Date.now() - startedAt,
        message: 'MongoDB connection is not ready',
      };
    }

    if (!this.connection.db) {
      return {
        status: 'down',
        critical: true,
        readyState,
        name: this.connection.name,
        latencyMs: Date.now() - startedAt,
        message: 'MongoDB database handle is not ready',
      };
    }

    try {
      await this.withTimeout(
        this.connection.db.admin().ping(),
        CHECK_TIMEOUT_MS,
        'MongoDB ping timed out',
      );

      return {
        status: 'ok',
        critical: true,
        readyState,
        name: this.connection.name,
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return {
        status: 'down',
        critical: true,
        readyState,
        name: this.connection.name,
        latencyMs: Date.now() - startedAt,
        message: 'MongoDB ping failed',
      };
    }
  }

  private async checkRedis(): Promise<HealthCheck> {
    const startedAt = Date.now();
    const host = this.configService.get<string>('app.redis.host');
    const port = this.configService.get<number>('app.redis.port');
    const password = this.configService.get<string>('app.redis.password') || undefined;

    if (!host || !String(host).trim()) {
      return {
        status: 'down',
        critical: true,
        configured: false,
        latencyMs: Date.now() - startedAt,
        message: 'Redis host is not configured',
      };
    }

    if (!Number.isFinite(Number(port)) || Number(port) <= 0) {
      return {
        status: 'down',
        critical: true,
        configured: false,
        latencyMs: Date.now() - startedAt,
        message: 'Redis port is not configured',
      };
    }

    let client: RedisClientType | undefined;
    try {
      client = createClient({
        socket: { host: host.trim(), port: Number(port) },
        password,
      });
      client.on('error', () => undefined);

      await this.withTimeout(client.connect(), CHECK_TIMEOUT_MS, 'Redis connect timed out');
      await this.withTimeout(client.ping(), CHECK_TIMEOUT_MS, 'Redis ping timed out');

      return {
        status: 'ok',
        critical: true,
        configured: true,
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return {
        status: 'down',
        critical: true,
        configured: true,
        latencyMs: Date.now() - startedAt,
        message: 'Redis ping failed',
      };
    } finally {
      if (client?.isOpen) {
        await client.quit().catch(() => undefined);
      } else {
        client?.destroy();
      }
    }
  }

  private getRedisConfigStatus(): HealthCheck {
    const host = this.configService.get<string>('app.redis.host');
    const port = this.configService.get<number>('app.redis.port');
    const configured = Boolean(host && String(host).trim() && Number(port) > 0);

    return {
      status: configured ? 'ok' : 'down',
      critical: true,
      configured,
      message: configured ? undefined : 'Redis configuration is required for readiness',
    };
  }

  private getFirebaseStatus(): HealthCheck {
    const configured = Boolean(
      this.configService.get<string>('app.firebase.projectId') &&
        this.configService.get<string>('app.firebase.clientEmail') &&
        this.configService.get<string>('app.firebase.privateKey'),
    );
    const initialized = admin.apps.length > 0;

    if (!configured) {
      return {
        status: 'down',
        critical: true,
        configured: false,
        message: 'Firebase Admin configuration is missing',
      };
    }

    if (!initialized) {
      return {
        status: 'down',
        critical: true,
        configured: true,
        message: 'Firebase Admin is not initialized',
      };
    }

    return {
      status: 'ok',
      critical: true,
      configured: true,
    };
  }

  private getPreparedExternalChecks(): Pick<
    ReadinessStatus['checks'],
    'gemini' | 'ipfs' | 'blockchainRpc'
  > {
    const geminiConfigured = Boolean(
      this.configService.get<string>('app.ai.gemini.apiKey') &&
        this.configService.get<string>('app.ai.gemini.model'),
    );
    const ipfsConfigured = Boolean(
      this.configService.get<string>('app.zkAuth.ipfsGatewayUrl'),
    );
    const blockchainConfigured = Boolean(this.getConfiguredBlockchainRpcUrl());

    return {
      gemini: {
        status: 'skipped',
        critical: false,
        configured: geminiConfigured,
        message: 'Real Gemini health check is pending for a future phase',
      },
      ipfs: {
        status: 'skipped',
        critical: false,
        configured: ipfsConfigured,
        message: 'Real IPFS gateway health check is pending for a future phase',
      },
      blockchainRpc: {
        status: 'skipped',
        critical: false,
        configured: blockchainConfigured,
        message: 'Real blockchain RPC health check is pending for a future phase',
      },
    };
  }

  private async checkGeminiExternal(): Promise<HealthCheck> {
    const startedAt = Date.now();
    const apiKey = this.configService.get<string>('app.ai.gemini.apiKey');
    const model = this.configService.get<string>('app.ai.gemini.model');

    if (!apiKey || !model) {
      return {
        status: 'skipped',
        critical: false,
        configured: false,
        message: 'Gemini configuration is missing',
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      await this.withTimeout(
        ai.models.get({ model }),
        EXTERNAL_CHECK_TIMEOUT_MS,
        'Gemini model metadata check timed out',
      );

      return {
        status: 'ok',
        critical: false,
        configured: true,
        latencyMs: Date.now() - startedAt,
        message: 'Gemini model metadata reachable',
      };
    } catch {
      return {
        status: 'degraded',
        critical: false,
        configured: true,
        latencyMs: Date.now() - startedAt,
        message: 'Gemini model metadata check failed',
      };
    }
  }

  private async checkIpfsGatewayExternal(): Promise<HealthCheck> {
    const startedAt = Date.now();
    const gatewayUrl = this.configService.get<string>('app.zkAuth.ipfsGatewayUrl');

    if (!gatewayUrl || !String(gatewayUrl).trim()) {
      return {
        status: 'skipped',
        critical: false,
        configured: false,
        message: 'IPFS gateway configuration is missing',
      };
    }

    try {
      const response = await this.fetchWithTimeout(
        gatewayUrl,
        { method: 'HEAD' },
        EXTERNAL_CHECK_TIMEOUT_MS,
      );

      if (!response.ok) {
        throw new Error('IPFS gateway did not respond with success');
      }

      return {
        status: 'ok',
        critical: false,
        configured: true,
        latencyMs: Date.now() - startedAt,
        message: 'IPFS gateway reachable',
      };
    } catch {
      return {
        status: 'degraded',
        critical: false,
        configured: true,
        latencyMs: Date.now() - startedAt,
        message: 'IPFS gateway check failed',
      };
    }
  }

  private async checkBlockchainRpcExternal(): Promise<HealthCheck> {
    const startedAt = Date.now();
    const rpcUrl = this.getConfiguredBlockchainRpcUrl();

    if (!rpcUrl) {
      return {
        status: 'skipped',
        critical: false,
        configured: false,
        message: 'Blockchain RPC configuration is missing',
      };
    }

    try {
      const response = await this.fetchWithTimeout(
        rpcUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_chainId',
            params: [],
          }),
        },
        EXTERNAL_CHECK_TIMEOUT_MS,
      );

      if (!response.ok) {
        throw new Error('Blockchain RPC did not respond with success');
      }

      const payload = await response.json().catch(() => undefined);
      if (!payload?.result || payload.error) {
        throw new Error('Blockchain RPC response is invalid');
      }

      return {
        status: 'ok',
        critical: false,
        configured: true,
        latencyMs: Date.now() - startedAt,
        message: 'Blockchain RPC reachable',
      };
    } catch {
      return {
        status: 'degraded',
        critical: false,
        configured: true,
        latencyMs: Date.now() - startedAt,
        message: 'Blockchain RPC check failed',
      };
    }
  }

  private getConfiguredBlockchainRpcUrl(): string {
    const chain = this.configService.get<string>('app.blockchain.chain');
    const chainConfigByKey: Record<string, { rpcUrls: { default: { http: readonly string[] } } }> = {
      'base-sepolia': baseSepolia,
      base,
      'arbitrum-sepolia': arbitrumSepolia,
      arbitrum,
    };
    const chainConfig = chain ? chainConfigByKey[chain] : undefined;
    return chainConfig?.rpcUrls.default.http[0] || '';
  }

  private getAppInfo() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
