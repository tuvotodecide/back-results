import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

@Injectable()
export class OfficialPublicationMobileRateLimitGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const windowMs = this.config.get<number>(
      'OFFICIAL_PUBLICATION_MOBILE_AUTH_RATE_LIMIT_WINDOW_MS',
      60_000,
    );
    const limit = this.config.get<number>(
      'OFFICIAL_PUBLICATION_MOBILE_AUTH_RATE_LIMIT',
      30,
    );
    const key = `${request.method}:${request.route?.path ?? request.path}:${this.clientKey(request)}`;
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (current.count >= limit) {
      throw new HttpException(
        { message: 'Se realizaron demasiados intentos. Intente nuevamente mas tarde.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    current.count += 1;
    return true;
  }

  private clientKey(request: any): string {
    const forwarded = request.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
      return String(forwarded[0]).split(',')[0].trim();
    }
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }
}
