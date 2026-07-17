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

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    // Si es ruta pública
    if (isPublic) {
      // pero NO lanzar excepción si falla o no existe
      if (token) {
        try {
          const payload = await this.jwtService.verifyAsync(token);
          if (await this.isAllowedPayloadForRequest(payload, request, true)) {
            request['user'] = payload;
          }
        } catch {
          // Token inválido en ruta pública: continuar sin usuario
          request['user'] = undefined;
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
      const payload = await this.jwtService.verifyAsync(token);
      if (!(await this.isAllowedPayloadForRequest(payload, request, false))) {
        throw new UnauthorizedException('Usuario inactivo');
      }
      // 💡 We're assigning the payload to the request object here
      // so that we can access it in our route handlers
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private async isAllowedPayloadForRequest(
    payload: any,
    request: Request,
    isPublicRoute: boolean,
  ): Promise<boolean> {
    if (!payload?.active) {
      return false;
    }
    if (isPublicRoute || !this.requiresInstitutionalFreshness(request)) {
      return true;
    }
    return this.isPayloadCurrent(payload);
  }

  private requiresInstitutionalFreshness(request: Request): boolean {
    const path = request.path ?? request.url ?? '';
    return (
      path.includes('/institutional-') ||
      path.includes('/api/v1/auth/access-status')
    );
  }

  private async isPayloadCurrent(payload: any): Promise<boolean> {
    const userId = payload?.sub ? String(payload.sub) : '';
    if (!userId || !Types.ObjectId.isValid(userId)) {
      return false;
    }
    if (typeof payload.authVersion !== 'number') {
      return false;
    }
    const user = await this.getRoledUserModel()
      .findById(userId, { active: 1, authVersion: 1 })
      .lean();
    return Boolean(
      user &&
        user.active === true &&
        (user.authVersion ?? 0) === payload.authVersion,
    );
  }

  private getRoledUserModel(): Model<RoledUserDocument> {
    return (
      (this.connection.models[RoledUser.name] as Model<RoledUserDocument> | undefined) ??
      this.connection.model<RoledUserDocument>(RoledUser.name, RoledUserSchema)
    );
  }
}
