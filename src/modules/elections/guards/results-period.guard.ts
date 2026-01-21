import {
  Injectable,
  CanActivate,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { ElectionConfigService } from '../services/election-config.service';

@Injectable()
export class ResultsPeriodGuard implements CanActivate {
  constructor(private electionConfigService: ElectionConfigService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const electionId =
      req.query?.electionId ??
      req.body?.electionId ??
      req.params?.electionId ??
      req.headers['x-election-id'];
    const actives = await this.electionConfigService.getActiveConfigs();
    if (!actives?.length) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Acceso denegado: no hay configuración electoral activa',
        error: 'NO_ELECTION_CONFIG',
      });
    }

    let cfg = null as any;
    if (electionId) {
      cfg = actives.find((c) => c.id === electionId);
      if (!cfg) {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'La elección indicada no está activa',
          error: 'NO_ELECTION_CONFIG_FOR_REQUEST',
        });
      }
    } else {
      if (actives.length > 1) {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Hay varias elecciones activas; envíe electionId',
          error: 'NO_ELECTION_CONFIG_FOR_REQUEST',
        });
      }
      cfg = actives[0];
    }

    const now = new Date();
    if (now < new Date(cfg.resultsStartDate)) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Acceso denegado: resultados no disponibles aún',
        error: 'RESULTS_NOT_AVAILABLE',
      });
    }
    return true;
  }
}
