import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { RED_ENLACE_API_KEY_HEADER } from '../payments.constants';

@Injectable()
export class RedEnlaceWebhookGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected =
      this.configService.get<string>('app.redEnlace.callbackToken')?.trim() ||
      this.configService.get<string>('app.redEnlace.webhookSecret')?.trim() ||
      '';

    if (!expected) {
      throw new UnauthorizedException('Webhook authentication not configured');
    }

    const provided = this.getHeader(request, RED_ENLACE_API_KEY_HEADER);

    if (!provided || !this.safeEquals(provided, expected)) {
      throw new UnauthorizedException('Invalid webhook authentication');
    }

    return true;
  }

  private getHeader(request: Request, name: string) {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private safeEquals(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
