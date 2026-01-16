import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Guard que valida el acceso territorial basado en el rol del usuario.
 * - GOVERNOR: Solo puede acceder a datos de su departamento
 * - MAYOR: Solo puede acceder a datos de su municipio
 * - Sin autenticación: Acceso libre (público)
 */
@Injectable()
export class TerritorialScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Si no hay usuario autenticado, permitir acceso público
    if (!user) {
      return true;
    }

    // Extraer parámetros y query params
    const params = request.params;
    const query = request.query;

    if (user.role === 'GOVERNOR') {
      return this.validateGovernorAccess(user, params, query, request);
    }

    if (user.role === 'MAYOR') {
      return this.validateMayorAccess(user, params, query, request);
    }

    return true;
  }

  private validateGovernorAccess(user: any, params: any, query: any, request: any): boolean {
    const userDepartmentId = user.votingDepartmentId;

    if (!userDepartmentId) {
      throw new ForbiddenException('Usuario gobernador sin departamento asignado');
    }

    // Verificar acceso a departamento por parámetro
    if (params.departmentId && params.departmentId !== userDepartmentId) {
      throw new ForbiddenException('No puede acceder a datos de otro departamento');
    }

    if (params.departmentName) {
      // Se validará en el servicio comparando con el nombre del departamento del usuario
      request.userDepartmentId = userDepartmentId;
    }

    // Verificar acceso a departamento por query
    if (query.departmentId && query.departmentId !== userDepartmentId) {
      throw new ForbiddenException('No puede acceder a datos de otro departamento');
    }

    // Inyectar automáticamente el filtro de departamento si no existe
    if (!query.departmentId && !params.departmentId && !params.departmentName) {
      request.query.departmentId = userDepartmentId;
    }

    // Para otros endpoints que filtran por ubicaciones inferiores, también inyectar
    request.userDepartmentId = userDepartmentId;
    request.userRole = 'GOVERNOR';

    return true;
  }

  private validateMayorAccess(user: any, params: any, query: any, request: any): boolean {
    const userMunicipalityId = user.votingMunicipalityId;

    if (!userMunicipalityId) {
      throw new ForbiddenException('Usuario alcalde sin municipio asignado');
    }

    // Los alcaldes NO pueden filtrar por departamento o provincia
    if (params.departmentId || query.departmentId || params.departmentName || 
        params.provinceId || query.provinceId) {
      throw new ForbiddenException('Los alcaldes no pueden filtrar por departamento o provincia');
    }

    // Verificar acceso a municipio por parámetro
    if (params.municipalityId && params.municipalityId !== userMunicipalityId) {
      throw new ForbiddenException('No puede acceder a datos de otro municipio');
    }

    // Verificar acceso a municipio por query
    if (query.municipalityId && query.municipalityId !== userMunicipalityId) {
      throw new ForbiddenException('No puede acceder a datos de otro municipio');
    }

    // Inyectar automáticamente el filtro de municipio
    if (!query.municipalityId && !params.municipalityId) {
      request.query.municipalityId = userMunicipalityId;
    }

    request.userMunicipalityId = userMunicipalityId;
    request.userRole = 'MAYOR';

    return true;
  }
}

