import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitRule = {
  name: string;
  windowMs: number;
  limit: number;
};

const buckets = new Map<string, RateLimitBucket>();

@Injectable()
export class InstitutionalPublicRateLimitGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const routeKey = `${request.method}:${request.route?.path ?? request.path ?? 'unknown'}`;
    const clientKey = this.resolveClientKey(request);
    const now = Date.now();

    for (const rule of this.resolveRules(routeKey)) {
      const key = `${routeKey}:${rule.name}:${clientKey}`;
      const current = buckets.get(key);

      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
        continue;
      }

      if (current.count >= rule.limit) {
        throw new HttpException(
          { message: 'Se realizaron demasiados intentos. Intente nuevamente más tarde.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      current.count += 1;
    }

    return true;
  }

  private resolveRules(routeKey: string): RateLimitRule[] {
    if (routeKey.includes('institutional-wallets') && routeKey.includes('resolve-by-dni')) {
      return [
        {
          name: 'minute',
          windowMs: this.configService.get<number>(
            'INSTITUTIONAL_WALLET_RESOLUTION_RATE_LIMIT_MINUTE_WINDOW_MS',
            60_000,
          ),
          limit: this.configService.get<number>(
            'INSTITUTIONAL_WALLET_RESOLUTION_RATE_LIMIT_PER_MINUTE',
            5,
          ),
        },
        {
          name: 'hour',
          windowMs: this.configService.get<number>(
            'INSTITUTIONAL_WALLET_RESOLUTION_RATE_LIMIT_HOUR_WINDOW_MS',
            3_600_000,
          ),
          limit: this.configService.get<number>(
            'INSTITUTIONAL_WALLET_RESOLUTION_RATE_LIMIT_PER_HOUR',
            20,
          ),
        },
      ];
    }

    const windowMs = this.configService.get<number>(
      'INSTITUTIONAL_PUBLIC_RATE_LIMIT_WINDOW_MS',
      60_000,
    );
    return [{ name: 'default', windowMs, limit: this.resolveLegacyLimit(routeKey) }];
  }

  private resolveLegacyLimit(routeKey: string): number {
    if (routeKey.includes('verify-email')) {
      return this.configService.get<number>('INSTITUTIONAL_VERIFY_EMAIL_RATE_LIMIT', 30);
    }
    if (routeKey.includes('institutional-access-recovery-requests')) {
      return this.configService.get<number>('INSTITUTIONAL_RECOVERY_RATE_LIMIT', 20);
    }
    return this.configService.get<number>('INSTITUTIONAL_APPLICATION_RATE_LIMIT', 30);
  }

  private resolveClientKey(request: any): string {
    const forwardedFor = request.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }
    if (Array.isArray(forwardedFor) && forwardedFor[0]?.trim()) {
      return forwardedFor[0].split(',')[0].trim();
    }
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }
}
