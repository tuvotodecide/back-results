import { Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ElectionConfigService } from '../services/election-config.service';

/**
 * Guard para proteger endpoints de resultados
 * Solo permite acceso cuando el período de resultados está activo
 */
@Injectable()
export class ResultsPeriodGuard implements CanActivate {
  constructor(private electionConfigService: ElectionConfigService) {}

  canActivate(): boolean | Promise<boolean> | Observable<boolean> {
    return this.validateResultsPeriod();
  }

  private async validateResultsPeriod(): Promise<boolean> {
    try {
      const isAllowed = await this.electionConfigService.isResultsPeriod();

      if (!isAllowed) {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Acceso denegado: resultados no disponibles aún',
          error: 'RESULTS_NOT_AVAILABLE',
          details:
            'Los resultados solo estarán disponibles después de la hora configurada',
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
