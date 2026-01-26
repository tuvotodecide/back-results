import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { Contract } from '@/modules/contracts/schemas/contract.schema';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';

/**
 * Guard para validar que el usuario pueda atestiguar
 * basándose en:
 * 1. La ubicación de la ballot (recinto electoral)
 * 2. Contratos activos en ese territorio
 * 3. Elección activa
 */
@Injectable()
export class AttestationAvailabilityGuard implements CanActivate {
  constructor(
    @InjectModel(Contract.name) private contractModel: Model<Contract>,
    @InjectModel(Ballot.name) private ballotModel: Model<Ballot>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Obtener datos del request
    const attestations = request.body?.attestations;

    if (!attestations || !Array.isArray(attestations)) {
      throw new BadRequestException('Se requiere el campo attestations');
    }

    // Validar cada attestation
    for (const attestation of attestations) {
      if (!attestation.ballotId) {
        throw new BadRequestException('Cada attestation debe tener ballotId');
      }

      // Obtener la ballot para conocer su ubicación y elección
      const ballot = await this.getBallotInfo(attestation.ballotId);

      if (!ballot) {
        throw new ForbiddenException(
          `Ballot ${attestation.ballotId} no encontrada`,
        );
      }

      // Verificar que exista un contrato activo para este territorio
      await this.validateContractCoverage(
        ballot.electionId,
        ballot.location.department,
        ballot.location.municipality,
      );
    }

    return true;
  }

  private async getBallotInfo(ballotId: string): Promise<{
    electionId: Types.ObjectId;
    location: {
      department: string;
      municipality: string;
    };
  } | null> {
    const ballot = await this.ballotModel
      .findById(new Types.ObjectId(ballotId))
      .select('electionId location.department location.municipality')
      .lean()
      .exec();
    if (!ballot) {
      return null;
    }
    return {
      electionId: ballot.electionId as Types.ObjectId,
      location: {
        department: ballot.location?.department || '',
        municipality: ballot.location?.municipality || '',
      },
    };
  }
  private norm(s: any): string {
    return String(s ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private async validateContractCoverage(
    electionId: Types.ObjectId,
    departmentName: string,
    municipalityName: string,
  ): Promise<void> {
    const dept = this.norm(departmentName);
    const muni = this.norm(municipalityName);

    const or: any[] = [];
    if (dept) or.push({ departmentName: dept });
    if (muni) or.push({ municipalityName: muni });

    if (or.length === 0) {
      throw new BadRequestException(
        'Ballot sin department/municipality válidos',
      );
    }

    const contracts = await this.contractModel
      .find({ electionId, active: true, $or: or })
      .select('_id clientRole departmentName municipalityName')
      .lean()
      .exec();

    if (contracts.length === 0) {
      throw new ForbiddenException({
        statusCode: 403,
        message: `No hay cobertura de contratos para atestiguar en ${muni || '(municipio?)'}, ${dept || '(departamento?)'}`,
        error: 'NO_CONTRACT_COVERAGE',
        details: {
          department: dept,
          municipality: muni,
          suggestion:
            'Contacte con su alcalde o gobernador para habilitar el atestiguamiento en esta zona',
        },
      });
    }
  }
}
