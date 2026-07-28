import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationDocument,
} from '../schemas/institutional-admin-application.schema';
import { InstitutionalMobileZkAuthService } from './institutional-mobile-zk-auth.service';
import {
  InstitutionalMobileAuthContext,
  InstitutionalMobileRequestUser,
} from './institutional-mobile-auth.types';

@Injectable()
export class InstitutionalMobileZkAuthGuard implements CanActivate {
  constructor(
    private readonly authService: InstitutionalMobileZkAuthService,
    @InjectModel(InstitutionalAdminApplication.name)
    private readonly applicationModel: Model<InstitutionalAdminApplicationDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);
    if (!apiKey) {
      throw new UnauthorizedException();
    }

    const authContext = await this.authService.getContextByApiKey(apiKey);
    if (!authContext) {
      throw new UnauthorizedException();
    }

    const routeApplicationId = String(request.params?.applicationId ?? '').trim();
    if (!routeApplicationId || authContext.applicationId !== routeApplicationId) {
      throw new ForbiddenException({
        code: 'INSTITUTIONAL_AUTH_REQUEST_MISMATCH',
        message: 'La credencial móvil no corresponde a esta autorización',
      });
    }

    const application = await this.applicationModel.findById(routeApplicationId).lean();
    if (!application) {
      throw new ForbiddenException({
        code: 'INSTITUTIONAL_AUTHORIZATION_NOT_FOUND',
        message: 'Autorización institucional no encontrada',
      });
    }
    if (String(application.tenantId) !== authContext.tenantId) {
      throw new ForbiddenException({
        code: 'INSTITUTIONAL_AUTH_CONTEXT_MISMATCH',
        message: 'La credencial móvil no coincide con la institución',
      });
    }

    request.user = this.buildRequestUser(authContext);
    return true;
  }

  private buildRequestUser(
    authContext: InstitutionalMobileAuthContext | null,
  ): InstitutionalMobileRequestUser {
    if (!authContext) {
      throw new UnauthorizedException();
    }
    return {
      sub: authContext.signerUserId,
      dni: authContext.dni,
      smartAccountAddress: authContext.smartAccountAddress,
      applicationId: authContext.applicationId,
      authType: 'INSTITUTIONAL_MOBILE_ZK',
    };
  }

  private extractApiKey(request: any): string {
    const raw = request.headers?.['x-api-key'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value.trim() : '';
  }
}
