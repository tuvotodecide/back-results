import { Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ElectionConfigService } from '../services/election-config.service';

/**
 * Guard opcional para endpoints que requieren configuración electoral
 * pero permiten acceso sin restricciones temporales
 */
@Injectable()
export class ElectionConfigGuard implements CanActivate {
  constructor(private electionConfigService: ElectionConfigService) {}

  canActivate(): boolean | Promise<boolean> | Observable<boolean> {
    return this.validateElectionConfig();
  }

  private async validateElectionConfig(): Promise<boolean> {
    try {
      const config = await this.electionConfigService.getActiveConfig();

      if (!config) {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Acceso denegado: no hay configuración electoral activa',
          error: 'NO_ELECTION_CONFIG',
          details:
            'Debe configurar un período electoral antes de usar este endpoint',
        });
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      throw new ForbiddenException({
        statusCode: 403,
        message: 'Error al verificar configuración electoral',
        error: 'ELECTION_CONFIG_ERROR',
      });
    }
  }
}
