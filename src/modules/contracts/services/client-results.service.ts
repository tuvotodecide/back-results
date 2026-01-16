import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ResultsService } from '@/modules/results/services/results.service';
import { ElectionTypeFilterDto } from '@/modules/results/dto/results.dto';
import { ContractsService } from './contracts.service';

@Injectable()
export class ClientResultsService {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly resultsService: ResultsService,
  ) {}

  async getResultsRestrictedToMyContract(
    params: Pick<ElectionTypeFilterDto, 'electionType' | 'electionId'> & {
      mode?: 'final' | 'live'; // ← Agregar mode
    },
    userId: string,
  ) {
    if (!userId) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    if (!params?.electionType) {
      throw new ForbiddenException('Debe enviar electionType');
    }
    if (!params?.electionId) {
      throw new ForbiddenException('Debe enviar electionId');
    }

    const my = await this.contractsService.getMyContract({
      userId,
      electionId: params.electionId,
    });

    if (!my?.hasContract || !my.contract?.active) {
      throw new ForbiddenException(
        'No tiene contrato activo para esta elección',
      );
    }

    const c = my.contract;

    // Forzar territorio según el contrato
    const forcedFilters: any = {
      electionType: params.electionType,
      electionId: params.electionId,
      mode: params.mode || 'final', // ← Pasar el mode
    };

    if (c.municipalityId) {
      if (!c.municipalityName) {
        throw new ForbiddenException('Contrato sin municipalityName');
      }
      forcedFilters.municipality = c.municipalityName;
    } else if (c.departmentId) {
      if (!c.departmentName) {
        throw new ForbiddenException('Contrato sin departmentName');
      }
      forcedFilters.department = c.departmentName;
    } else {
      throw new ForbiddenException('Territorio de contrato inválido');
    }

    return this.resultsService.getResultsByLocation(forcedFilters);
  }
}
