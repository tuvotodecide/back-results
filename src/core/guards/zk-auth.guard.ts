import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ZkAuthService } from '@/modules/zk-auth/services/zk-auth.service';

@Injectable()
export class ZkAuthGuard implements CanActivate {
  private readonly headerName: string;

  constructor(
    private readonly config: ConfigService,
    private readonly zkAuthService: ZkAuthService,
  ) {
    this.headerName = (
      this.config.get<string>('app.apiKey.header') || 'x-api-key'
    ).toLowerCase();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: Request = context.switchToHttp().getRequest();

    const raw =
      req.headers[this.headerName] ?? req.headers[this.headerName as any];
    const provided = Array.isArray(raw) ? raw[0] : raw;

    if (!provided) {
      throw new ForbiddenException('Missing API key (header)');
    }

    const ok = await this.zkAuthService.isApiKeyValid(provided);
    if (!ok) {
      throw new ForbiddenException('Not valid or expired ZK API key');
    }

    return true;
  }
}
