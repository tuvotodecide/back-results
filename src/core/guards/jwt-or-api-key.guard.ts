import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  private readonly headerName: string;
  private readonly allowedKeys: string[];

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.headerName = (
      this.config.get<string>('app.apiKey.header') || 'x-api-key'
    ).toLowerCase();
    this.allowedKeys = (
      this.config.get<string[]>('app.apiKey.keys') || []
    ).filter(Boolean);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();

    const payload = await this.verifyJwt(request);
    if (payload) {
      request['user'] = payload;
      return true;
    }

    if (this.hasValidApiKey(request)) {
      return true;
    }

    throw new UnauthorizedException('Missing or invalid JWT token or API key');
  }

  private async verifyJwt(request: Request): Promise<Record<string, any> | null> {
    const token = this.extractTokenFromHeader(request);
    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync(token);
      return payload?.active ? payload : null;
    } catch {
      return null;
    }
  }

  private hasValidApiKey(request: Request): boolean {
    if (this.allowedKeys.length === 0) return false;

    const raw = request.headers[this.headerName];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided) return false;

    return this.allowedKeys.some((key) => safeEqual(key, provided));
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);

  if (A.length !== B.length) return false;

  try {
    return timingSafeEqual(A, B);
  } catch {
    return false;
  }
}
