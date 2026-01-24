// src/modules/contracts/guards/territorial-restriction.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contract } from '../schemas/contract.schema';

/**
 * UC5: Restringir consultas y filtros por rol y territorio
 * 
 * Este guard valida que un Alcalde/Gobernador solo acceda a datos
 * dentro de su territorio contratado
 */
@Injectable()
export class TerritorialRestrictionGuard implements CanActivate {
  constructor(
    @InjectModel(Contract.name) private contractModel: Model<Contract>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Del JWT

    if (!user) {
      throw new ForbiddenException('No autenticado');
    }

    // Si no es Alcalde ni Gobernador, permitir acceso (ej: Superadmin)
    if (!user.role || !['MAYOR', 'GOVERNOR'].includes(user.role)) {
      return true;
    }

    // Obtener el contrato activo del usuario
    const electionId = request.query.electionId || request.body?.electionId;
    if (!electionId) {
      throw new ForbiddenException(
        'electionId es requerido para usuarios con rol',
      );
    }

    const contract = await this.contractModel
      .findOne({
        clientId: new Types.ObjectId(user.sub as string),
        electionId: new Types.ObjectId(electionId as string),
        active: true,
      })
      .lean();

    if (!contract) {
      throw new ForbiddenException(
        'No tiene un contrato activo para esta elección',
      );
    }

    // Aplicar restricciones según el territorio del contrato
    this.applyTerritorialRestrictions(request, contract);

    // Guardar contrato en request para uso posterior
    request.contract = contract;

    return true;
  }

  /**
   * Aplicar restricciones territoriales a los parámetros de la request
   */
  private applyTerritorialRestrictions(request: any, contract: any) {
    const params = { ...request.query, ...request.body };

    if (contract.municipalityId) {
      // Alcalde: solo puede ver su municipio
      if (
        params.municipality &&
        params.municipality !== contract.municipalityName
      ) {
        throw new ForbiddenException(
          'No tiene acceso a datos fuera de su municipio',
        );
      }
      // Forzar filtro por municipio
      request.query.municipality = contract.municipalityName;
      if (request.body) {
        request.body.municipality = contract.municipalityName;
      }
    } else if (contract.departmentId) {
      // Gobernador: solo puede ver su departamento
      if (
        params.department &&
        params.department !== contract.departmentName
      ) {
        throw new ForbiddenException(
          'No tiene acceso a datos fuera de su departamento',
        );
      }
      // Forzar filtro por departamento
      request.query.department = contract.departmentName;
      if (request.body) {
        request.body.department = contract.departmentName;
      }
    }
  }
}