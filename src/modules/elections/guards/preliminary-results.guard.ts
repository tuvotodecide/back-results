import { Injectable, CanActivate, ForbiddenException, ExecutionContext } from '@nestjs/common';
import { ElectionConfigService } from '../services/election-config.service';

@Injectable()
export class PreliminaryResultsGuard implements CanActivate {
  constructor(private readonly electionConfigService: ElectionConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const electionId: string | undefined = req.query?.electionId;

    const actives = await this.electionConfigService.getActiveConfigs();
    if (!actives?.length) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'No hay configuración electoral activa',
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
          message: 'Hay varias elecciones activas; envíe electionId para usar LIVE',
          error: 'NO_ELECTION_CONFIG_FOR_REQUEST',
        });
      }
      cfg = actives[0];
    }

    const now = new Date();
    const votingStart = new Date(cfg.votingStartDate);
    const votingEnd = new Date(cfg.votingEndDate);
    const withinVoting = now >= votingStart && now <= votingEnd;

    if (!(withinVoting || cfg.allowDataModification === true)) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Resultados LIVE solo disponibles durante la jornada electoral',
        error: 'LIVE_NOT_AVAILABLE',
      });
    }
    return true;
  }
}
