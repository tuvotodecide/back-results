/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly headerName: string;
  private readonly allowedKeys: string[];

  constructor(private readonly config: ConfigService) {
    this.headerName = (
      this.config.get<string>('app.apiKey.header') || 'x-api-key'
    ).toLowerCase();
    this.allowedKeys = (
      this.config.get<string[]>('app.apiKey.keys') || []
    ).filter(Boolean);
  }

  canActivate(context: ExecutionContext): boolean {
    const req: Request = context.switchToHttp().getRequest();

    // Only open GET.
    if (req.method === 'GET') return true;

    // Allow pinning mock endpoints without API key.
    if (
      req.path === '/api/v1/pinning/pinFileToIPFS' ||
      req.path === '/api/v1/pinning/pinJSONToIPFS'
    ) return true;

    // Allow requesting new ZK auth API keys.
    if (
      req.path === '/api/v1/zk-auth/request' ||
      req.path === '/api/v1/zk-auth/callback'
    ) return true;

    // Endpoints replaced by ZK Auth.
    if (
      req.path === '/api/v1/attestations'
    ) return true;

    if (this.allowedKeys.length === 0) {
      throw new ForbiddenException('API key no configurada en el servidor');
    }

    // Header reader
    const raw =
      req.headers[this.headerName] ?? req.headers[this.headerName as any];
    const provided = Array.isArray(raw) ? raw[0] : raw;

    if (!provided) {
      throw new ForbiddenException('Missing API key (header)');
    }

    const ok = this.allowedKeys.some((k) => safeEqual(k, provided));
    if (!ok) {
      throw new ForbiddenException('Not valid API key');
    }

    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);

  if (A.length !== B.length) {
    try {
      timingSafeEqual(A, Buffer.alloc(A.length));
    } catch {
      console.log('Timing error');
    }
    return false;
  }

  try {
    return timingSafeEqual(A, B);
  } catch {
    return false;
  }
}
