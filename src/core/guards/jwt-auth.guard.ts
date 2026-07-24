import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection } from '@nestjs/mongoose';
import { Request } from 'express';
import { Connection, Model, Types } from 'mongoose';
import {
  RoledUser,
  RoledUserDocument,
  RoledUserSchema,
} from '@/modules/auth/schemas/roledUser.schema';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

type JwtPayload = Record<string, unknown> & {
  sub?: unknown;
  active?: unknown;
  authVersion?: unknown;
};

type AuthenticatedRequest = Request & {
  user?: JwtPayload;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    // Si es ruta pública
    if (isPublic) {
      // pero NO lanzar excepción si falla o no existe
      if (token) {
        try {
          const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
          if (await this.isAllowedPayloadForRequest(payload, request, true)) {
            request.user = payload;
          }
        } catch {
          // Token inválido en ruta pública: continuar sin usuario
          request.user = undefined;
        }
      }
      return true;
    }

    // Si NO es ruta pública, requerir autenticación
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      // 💡 Here the JWT secret key that's used for verifying the payload
      // is the key that was passsed in the JwtModule
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      if (!(await this.isAllowedPayloadForRequest(payload, request, false))) {
        throw new UnauthorizedException('Usuario inactivo');
      }
      // 💡 We're assigning the payload to the request object here
      // so that we can access it in our route handlers
      request.user = payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private async isAllowedPayloadForRequest(
    payload: JwtPayload,
    request: Request,
    isPublicRoute: boolean,
  ): Promise<boolean> {
    if (payload.active !== true) {
      return false;
    }
    if (isPublicRoute || !this.requiresInstitutionalFreshness(request)) {
      return true;
    }
    const freshness = await this.resolvePayloadFreshness(payload);
    if (freshness === 'AUTH_VERSION_MISMATCH') {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_VERSION_MISMATCH',
        message: 'Authentication session is no longer valid',
      });
    }
    return freshness === 'CURRENT';
  }

  private requiresInstitutionalFreshness(request: Request): boolean {
    const path = request.path ?? request.url ?? '';
    return (
      path.includes('/institutional-') ||
      path.includes('/api/v1/auth/access-status')
    );
  }

  private async resolvePayloadFreshness(
    payload: JwtPayload,
  ): Promise<'CURRENT' | 'AUTH_VERSION_MISMATCH' | 'INVALID'> {
    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    if (!userId || !Types.ObjectId.isValid(userId)) {
      return 'INVALID';
    }
    if (typeof payload.authVersion !== 'number') {
      return 'INVALID';
    }
    const user = await this.getRoledUserModel()
      .findById(userId, { active: 1, authVersion: 1 })
      .lean();
    if (!user || user.active !== true) {
      return 'INVALID';
    }
    return (user.authVersion ?? 0) === payload.authVersion
      ? 'CURRENT'
      : 'AUTH_VERSION_MISMATCH';
  }

  private getRoledUserModel(): Model<RoledUserDocument> {
    return (
      (this.connection.models[RoledUser.name] as Model<RoledUserDocument> | undefined) ??
      this.connection.model<RoledUserDocument>(RoledUser.name, RoledUserSchema)
    );
  }
}
