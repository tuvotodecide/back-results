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
  OfficialPublicationRequest,
  OfficialPublicationRequestDocument,
} from '../schemas/official-publication-request.schema';
import { OfficialPublicationMobileZkAuthService } from './official-publication-mobile-zk-auth.service';
import {
  OfficialPublicationMobileAuthContext,
  OfficialPublicationMobileRequestUser,
} from './official-publication-mobile-auth.types';

@Injectable()
export class OfficialPublicationMobileZkAuthGuard implements CanActivate {
  constructor(
    private readonly authService: OfficialPublicationMobileZkAuthService,
    @InjectModel(OfficialPublicationRequest.name)
    private readonly requestModel: Model<OfficialPublicationRequestDocument>,
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

    const routeRequestId = String(request.params?.requestId ?? '').trim();
    if (!routeRequestId || authContext.requestId !== routeRequestId) {
      throw new ForbiddenException({
        code: 'OFFICIAL_PUBLICATION_AUTH_REQUEST_MISMATCH',
        message: 'La credencial movil no corresponde a esta solicitud',
      });
    }

    const publicationRequest = await this.requestModel
      .findOne({ requestId: routeRequestId })
      .lean();
    if (!publicationRequest) {
      throw new ForbiddenException({
        code: 'OFFICIAL_PUBLICATION_REQUEST_NOT_FOUND',
        message: 'Solicitud de publicacion oficial no encontrada',
      });
    }

    if (String(publicationRequest.eventId) !== authContext.eventId) {
      throw new ForbiddenException({
        code: 'OFFICIAL_PUBLICATION_AUTH_CONTEXT_MISMATCH',
        message: 'La credencial movil no coincide con la solicitud',
      });
    }

    const user = this.buildRequestUser(authContext, publicationRequest);
    request.user = user;
    return true;
  }

  private buildRequestUser(
    authContext: OfficialPublicationMobileAuthContext | null,
    publicationRequest: any,
  ): OfficialPublicationMobileRequestUser {
    if (!authContext) {
      throw new UnauthorizedException();
    }
    const signerUserId = String(publicationRequest.signerUserId);
    const smartAccountAddress = String(publicationRequest.smartAccountAddress).toLowerCase();
    if (signerUserId !== authContext.subjectId) {
      throw new ForbiddenException({
        code: 'OFFICIAL_PUBLICATION_SIGNER_MISMATCH',
        message: 'La credencial movil no corresponde al firmante asignado',
      });
    }
    if (smartAccountAddress !== authContext.smartAccountAddress.toLowerCase()) {
      throw new ForbiddenException({
        code: 'OFFICIAL_PUBLICATION_WALLET_MISMATCH',
        message: 'La credencial movil no corresponde a la wallet firmante',
      });
    }
    return {
      sub: signerUserId,
      dni: authContext.dni,
      smartAccountAddress: authContext.smartAccountAddress,
      requestId: authContext.requestId,
      authType: 'OFFICIAL_PUBLICATION_MOBILE_ZK',
    };
  }

  private extractApiKey(request: any): string {
    const raw = request.headers?.['x-api-key'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value.trim() : '';
  }
}
