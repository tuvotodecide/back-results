import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

@Injectable()
export class InstitutionalPublicRateLimitGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const routeKey = `${request.method}:${request.route?.path ?? request.path ?? 'unknown'}`;
    const clientKey = this.resolveClientKey(request);
    const windowMs = this.configService.get<number>(
      'INSTITUTIONAL_PUBLIC_RATE_LIMIT_WINDOW_MS',
      60_000,
    );
    const limit = this.resolveLimit(routeKey);
    const now = Date.now();
    const key = `${routeKey}:${clientKey}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (current.count >= limit) {
      throw new HttpException(
        'Demasiadas solicitudes. Intente nuevamente mas tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    current.count += 1;
    return true;
  }

  private resolveLimit(routeKey: string): number {
    if (routeKey.includes('verify-email')) {
      return this.configService.get<number>('INSTITUTIONAL_VERIFY_EMAIL_RATE_LIMIT', 30);
    }
    if (routeKey.includes('institutional-access-recovery-requests')) {
      return this.configService.get<number>('INSTITUTIONAL_RECOVERY_RATE_LIMIT', 20);
    }
    return this.configService.get<number>('INSTITUTIONAL_APPLICATION_RATE_LIMIT', 30);
  }

  private resolveClientKey(request: any): string {
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }
}
