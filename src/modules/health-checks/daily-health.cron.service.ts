import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { HealthService } from '@/core/services/health.service';

type HealthCheckResult = {
  service: string;
  ok: boolean;
};

@Injectable()
export class DailyHealthCronService {
  private readonly logger = new Logger(DailyHealthCronService.name);
  private readonly emailTo: string;
  private readonly pinataJwt: string;
  private readonly coinbaseRpc: string;
  private readonly polygonRpc: string;
  private readonly issuerUrl: string;
  private readonly geminiApiKey: string;

  constructor(
    private configService: ConfigService,
    private readonly mailService: MailService,
    private readonly httpService: HttpService,
    private readonly healthService: HealthService
  ) {
    const to = this.configService.get<string>('app.errorAlerts.to');
    const pinataJwt = this.configService.get<string>('app.healthChecks.pinataJwt');
    const coinbaseRpc = this.configService.get<string>('app.healthChecks.coinbaseRpc');
    const polygonRpc = this.configService.get<string>('app.zkAuth.rpcUrl');
    const issuerUrl = this.configService.get<string>('app.issuer.baseUrl');
    const geminiApiKey = this.configService.get<string>('app.ai.gemini.apiKey');
    
    if (!to) {
      throw new Error('Health checks error alert email recipient is not configured');
    }
    if (!pinataJwt) {
      throw new Error('Pinata JWT is not configured');
    }
    if (!coinbaseRpc) {
      throw new Error('Coinbase RPC is not configured');
    }
    if (!polygonRpc) {
      throw new Error('Polygon RPC is not configured');
    }
    if (!issuerUrl) {
      throw new Error('Issuer URL is not configured');
    }
    if (!geminiApiKey) {
      throw new Error('Gemini API key is not configured');
    }

    this.emailTo = to;
    this.pinataJwt = pinataJwt;
    this.coinbaseRpc = coinbaseRpc;
    this.polygonRpc = polygonRpc;
    this.issuerUrl = issuerUrl;
    this.geminiApiKey = geminiApiKey;
  }

  private async checkPinataHealth(): Promise<HealthCheckResult> {
    try {
      const response = await this.httpService.axiosRef.get(
        'https://api.pinata.cloud/data/testAuthentication',
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.pinataJwt}`,
          },
        },
      );

      if (response.status !== 200) {
        throw new Error(`Pinata returned status ${response.status}`, { cause: new Error(JSON.stringify(response.data)) });
      }

      this.logger.log(`Pinata health check passed`);
      return { service: 'Pinata', ok: true };
    } catch (error: unknown) {
      this.logError('Pinata health check failed', error);
      return { service: 'Pinata', ok: false };
    }
  }

  private async checkCoinbaseHealth(): Promise<HealthCheckResult> {
    try {
      const response = await this.httpService.axiosRef.post(
        this.coinbaseRpc,
        { "jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": [] },
        {
          headers: {
            Accept: 'application/json',
          },
        },
      );

      if (response.status !== 200) {
        throw new Error(`Coinbase returned status ${response.status}`, { cause: new Error(JSON.stringify(response.data)) });
      }

      this.logger.log(`Coinbase health check passed`);
      return { service: 'Coinbase', ok: true };
    } catch (error: unknown) {
      this.logError('Coinbase health check failed', error);
      return { service: 'Coinbase', ok: false };
    }
  }

  private async checkReadinessHealth(): Promise<HealthCheckResult> {
    try {
      const response = await this.healthService.getReadinessStatus();

      if (response.status === 'down') {
        this.logger.error(`Readiness health check failed:`);
        this.logger.error(response);
        return { service: 'Database, redis, firebase', ok: false };
      }

      this.logger.log(`Readiness health check passed`);
      return { service: 'Database, redis, firebase', ok: true };
    } catch (error: unknown) {
      this.logError('Readiness health check failed', error);
      return { service: 'Database, redis, firebase', ok: false };
    }
  }

  private async checkPolygonHealth(): Promise<HealthCheckResult> {
    try {
      const response = await this.httpService.axiosRef.post(
        this.polygonRpc,
        { "jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber" },
        {
          headers: {
            Accept: 'application/json',
          },
        },
      );

      if (response.status !== 200) {
        throw new Error(`Polygon returned status ${response.status}`, { cause: new Error(JSON.stringify(response.data)) });
      }

      this.logger.log(`Polygon health check passed`);
      return { service: 'Polygon', ok: true };
    } catch (error: unknown) {
      this.logError('Polygon health check failed', error);
      return { service: 'Polygon', ok: false };
    }
  }

  private async checkIssuerHealth(): Promise<HealthCheckResult> {
    try {
      const response = await this.httpService.axiosRef.get(
        this.issuerUrl + '/status',
        {
          headers: {
            Accept: 'application/json',
          },
        },
      );

      if (response.status !== 200) {
        throw new Error(`Issuer Node returned status ${response.status}`, { cause: new Error(JSON.stringify(response.data)) });
      }

      this.logger.log(`Issuer Node health check passed`);
      return { service: 'Issuer Node', ok: true };
    } catch (error: unknown) {
      this.logError('Issuer Node health check failed', error);
      return { service: 'Issuer Node', ok: false };
    }
  }

  private async checkGeminiHealth(): Promise<HealthCheckResult> {
    try {
      const response = await this.httpService.axiosRef.get(
        'https://generativelanguage.googleapis.com/v1beta/models',
        {
          headers: {
            Accept: 'application/json',
            'X-goog-api-key': this.geminiApiKey,
          },
        },
      );

      if (response.status !== 200) {
        throw new Error(`Gemini returned status ${response.status}`, { cause: new Error(JSON.stringify(response.data)) });
      }

      this.logger.log(`Gemini health check passed`);
      return { service: 'Gemini', ok: true };
    } catch (error: unknown) {
      this.logError('Gemini health check failed', error);
      return { service: 'Gemini', ok: false };
    }
  }

  private async checkSentryHealth(): Promise<HealthCheckResult> {
    try {
      const response = await this.httpService.axiosRef.get(
        'https://sentry.io/_health',
        {
          headers: {
            Accept: 'application/json',
          },
        },
      );

      if (response.status !== 200) {
        throw new Error(`Sentry returned status ${response.status}`, { cause: new Error(JSON.stringify(response.data)) });
      }

      this.logger.log(`Sentry health check passed`);
      return { service: 'Sentry', ok: true };
    } catch (error: unknown) {
      this.logError('Sentry health check failed', error);
      return { service: 'Sentry', ok: false };
    }
  }

  private async sendFailureAlert(failedServices: string[]): Promise<void> {
    try {
      await this.mailService.sendEmail(
        this.emailTo,
        `Daily health checks failed`,
        'error-alert',
        {
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV ?? 'development',
          statusCode: 503,
          method: 'CRON',
          path: '/health-checks/daily',
          durationMs: 0,
          requestId: `cron-daily-health-${Date.now()}`,
          errorName: 'DailyHealthCheckError',
          errorMessage: `Failed services: ${failedServices.join(', ')}`,
          stacktrace: 'Hidden for security. Check application logs for details.',
          requestBody: JSON.stringify({ failedServices }),
        },
      );
    } catch (error: unknown) {
      this.logError('Failed to send health checks alert email', error);
    }
  }

  private logError(message: string, error: unknown) {
    const errorMessage = error instanceof Error ? message + ': ' + error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : 'No stack trace available';
    this.logger.error(errorMessage, errorStack);
  }

  @Cron('00 11 * * *', { timeZone: 'UTC' })
  async runDailyHealthCheck() {
    const results = await Promise.all([
      this.checkPinataHealth(),
      this.checkCoinbaseHealth(),
      this.checkPolygonHealth(),
      this.checkReadinessHealth(),
      this.checkIssuerHealth(),
      this.checkGeminiHealth(),
      this.checkSentryHealth(),
    ]);
    const failedServices = results.filter((result) => !result.ok).map((result) => result.service);

    if (failedServices.length === 0) {
      this.logger.log('Daily health checks completed successfully.');
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      await this.sendFailureAlert(failedServices);
    }
  }
}