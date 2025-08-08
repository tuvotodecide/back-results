import { Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ElectionConfigService } from '../services/election-config.service';

/**
 * Guard para proteger endpoints de modificación de datos
 * Solo permite acceso durante el período de votación o si allowDataModification está habilitado
 */

@Injectable()
export class VotingPeriodGuard implements CanActivate {
  constructor(private electionConfigService: ElectionConfigService) {}

  canActivate(): boolean | Promise<boolean> | Observable<boolean> {
    return this.validateVotingPeriod();
  }

  private async validateVotingPeriod(): Promise<boolean> {
    try {
      const isAllowed = await this.electionConfigService.isVotingPeriod();

      if (!isAllowed) {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Acceso denegado: fuera de horario electoral',
          error: 'OUTSIDE_VOTING_HOURS',
          details:
            'Este endpoint solo está disponible durante el período de votación configurado',
        });
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      // Si no hay configuración activa, denegar acceso
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Acceso denegado: no hay configuración electoral activa',
        error: 'NO_ELECTION_CONFIG',
        details: 'No se ha configurado un período electoral activo',
      });
    }
  }
}
