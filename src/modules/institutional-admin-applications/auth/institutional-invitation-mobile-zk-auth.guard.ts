import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InstitutionalMobileZkAuthService } from './institutional-mobile-zk-auth.service';
import { InstitutionalInvitationMobileAuthContext } from './institutional-mobile-auth.types';

@Injectable()
export class InstitutionalInvitationMobileZkAuthGuard implements CanActivate {
  constructor(private readonly authService: InstitutionalMobileZkAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);
    if (!apiKey) throw new UnauthorizedException();

    const authContext = await this.authService.getContextByApiKey(apiKey);
    if (!authContext || authContext.purpose !== 'INSTITUTIONAL_INVITATION') {
      throw new UnauthorizedException();
    }
    const routeInvitationId = String(request.params?.invitationId ?? '').trim();
    if (!routeInvitationId || authContext.invitationId !== routeInvitationId) {
      throw new ForbiddenException({
        code: 'INSTITUTIONAL_INVITATION_REQUEST_MISMATCH',
        message: 'La credencial móvil no corresponde a esta invitación',
      });
    }
    request.user = this.buildRequestUser(authContext);
    return true;
  }

  private buildRequestUser(authContext: InstitutionalInvitationMobileAuthContext) {
    return {
      sub: authContext.invitedUserId,
      dni: authContext.dni,
      smartAccountAddress: authContext.smartAccountAddress,
      invitationId: authContext.invitationId,
      authType: 'INSTITUTIONAL_INVITATION_MOBILE_ZK' as const,
    };
  }

  private extractApiKey(request: any): string {
    const raw = request.headers?.['x-api-key'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value.trim() : '';
  }
}
