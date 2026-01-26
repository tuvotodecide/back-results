import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ResultsService } from '@/modules/results/services/results.service';
import { ElectionTypeFilterDto } from '@/modules/results/dto/results.dto';
import { ContractsService } from './contracts.service';

@Injectable()
export class ClientResultsService {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly resultsService: ResultsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async getResultsRestrictedToMyContract(
    params: Pick<ElectionTypeFilterDto, 'electionType' | 'electionId'> & {
      mode?: 'final' | 'live';
      // Sub-filtros opcionales
      province?: string;
      municipality?: string;
      electoralSeat?: string;
      electoralLocation?: string;
      tableCode?: string;
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
      mode: params.mode || 'final',
    };

    if (c.municipalityId) {
      // MAYOR: territorio forzado a municipio, sub-filtros permitidos: electoralSeat, electoralLocation, tableCode
      if (!c.municipalityName) {
        throw new ForbiddenException('Contrato sin municipalityName');
      }
      forcedFilters.municipality = c.municipalityName;

      // Bloquear province/municipality como sub-filtro para Mayor (ya tiene municipio forzado)
      if (params.province) {
        throw new ForbiddenException(
          'Alcaldes no pueden filtrar por provincia',
        );
      }
      if (params.municipality && params.municipality !== c.municipalityName) {
        throw new ForbiddenException(
          'No puede filtrar por un municipio diferente al de su contrato',
        );
      }

      // Validar que electoralSeat esté dentro del municipio del contrato
      if (params.electoralSeat) {
        const seatInMunicipality = await this.connection
          .collection('ballots')
          .findOne({
            'location.municipality': c.municipalityName,
            'location.electoralSeat': params.electoralSeat,
          });
        if (!seatInMunicipality) {
          throw new ForbiddenException(
            `El recinto electoral '${params.electoralSeat}' no pertenece a su municipio`,
          );
        }
        forcedFilters.electoralSeat = params.electoralSeat;
      }

      if (params.electoralLocation) forcedFilters.electoralLocation = params.electoralLocation;
      if (params.tableCode) forcedFilters.tableCode = params.tableCode;
    } else if (c.departmentId) {
      // GOVERNOR: territorio forzado a departamento, sub-filtros permitidos: province, municipality, electoralSeat, etc.
      if (!c.departmentName) {
        throw new ForbiddenException('Contrato sin departmentName');
      }
      forcedFilters.department = c.departmentName;

      // Validar que province esté dentro del departamento del contrato
      if (params.province) {
        const provinceInDept = await this.connection
          .collection('ballots')
          .findOne({
            'location.department': c.departmentName,
            'location.province': params.province,
          });
        if (!provinceInDept) {
          throw new ForbiddenException(
            `La provincia '${params.province}' no pertenece a su departamento`,
          );
        }
        forcedFilters.province = params.province;
      }

      // Validar que municipality esté dentro del departamento del contrato
      if (params.municipality) {
        const municipalityInDept = await this.connection
          .collection('ballots')
          .findOne({
            'location.department': c.departmentName,
            'location.municipality': params.municipality,
          });
        if (!municipalityInDept) {
          throw new ForbiddenException(
            `El municipio '${params.municipality}' no pertenece a su departamento`,
          );
        }
        forcedFilters.municipality = params.municipality;
      }

      if (params.electoralSeat) forcedFilters.electoralSeat = params.electoralSeat;
      if (params.electoralLocation) forcedFilters.electoralLocation = params.electoralLocation;
      if (params.tableCode) forcedFilters.tableCode = params.tableCode;
    } else {
      throw new ForbiddenException('Territorio de contrato inválido');
    }

    return this.resultsService.getResultsByLocation(forcedFilters);
  }
}
