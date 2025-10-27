import { Injectable, CanActivate, ForbiddenException, ExecutionContext } from '@nestjs/common';
import { ElectionConfigService } from '../services/election-config.service';

@Injectable()
export class VotingPeriodGuard implements CanActivate {
  constructor(private electionConfigService: ElectionConfigService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    const electionId: string | undefined = req.body?.electionId ?? req.query?.electionId;

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
    const withinVoting = now >= new Date(cfg.votingStartDate) && now <= new Date(cfg.votingEndDate);
    if (!(withinVoting || cfg.allowDataModification === true)) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Acceso denegado: fuera de horario electoral',
        error: 'OUTSIDE_VOTING_HOURS',
      });
    }
    return true;
  }
}