import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger
} from '@nestjs/common';

/**
 * Guard para endpoints de RESULTADOS y GEOGRAPHIC (públicos)
 * - Sin autenticación: Acceso libre a cualquier filtro
 * - Con autenticación: Restringe por territorio asignado en JWT
 */
@Injectable()
export class TerritorialScopeGuard implements CanActivate {
  private readonly logger = new Logger(TerritorialScopeGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    this.logger.debug(`🔍 TerritorialScopeGuard - Ruta: ${request.method} ${request.url}`);

    // Si NO hay usuario autenticado, permitir acceso público SIN restricciones
    if (!user) {
      this.logger.debug('✅ Usuario NO autenticado - Acceso público permitido');
      return true;
    }

    this.logger.debug(`👤 Usuario autenticado - Role: ${user.role}, ID: ${user.sub}`);

    // Si es SUPERADMIN o ADMIN, permitir acceso total
    if (user.role === 'SUPERADMIN' || user.role === 'ADMIN') {
      this.logger.debug('✅ ADMIN/SUPERADMIN - Acceso total permitido');
      return true;
    }

    // Extraer parámetros
    const query = request.query;
    const params = request.params;

    this.logger.debug(`📝 Query params (antes): ${JSON.stringify(query)}`);
    this.logger.debug(`📝 URL params: ${JSON.stringify(params)}`);

    // Validar según el rol
    if (user.role === 'GOVERNOR') {
      this.validateGovernorAccess(user, params, query, request);
    } else if (user.role === 'MAYOR') {
      this.validateMayorAccess(user, params, query, request);
    }

    this.logger.debug(`📝 Query params (después): ${JSON.stringify(request.query)}`);

    return true;
  }

  private validateGovernorAccess(
    user: any,
    params: any,
    query: any,
    request: any
  ): void {
    const userDepartmentId = user.votingDepartmentId;

    this.logger.debug(`🏛️ GOVERNOR - Department asignado: ${userDepartmentId}`);

    if (!userDepartmentId) {
      this.logger.error('❌ GOVERNOR sin departamento asignado en JWT');
      throw new ForbiddenException('Usuario gobernador sin departamento asignado');
    }

    // VALIDACIÓN: Si está accediendo a GET /departments/:id
    if (params.id && request.url.includes('/departments/')) {
      if (params.id !== userDepartmentId) {
        this.logger.warn(`❌ BLOQUEADO - Acceso a department ${params.id} (permitido: ${userDepartmentId})`);
        throw new ForbiddenException(
          `Acceso denegado. Solo puede ver su departamento: ${userDepartmentId}`
        );
      }
      this.logger.debug('✅ Acceso a su propio departamento permitido');
      return; // No forzar filtros adicionales para este caso
    }

    // VALIDACIÓN: Si está accediendo a /provinces/:id o /municipalities/:id
    // Bloquear acceso directo a recursos fuera de su jurisdicción
    if (params.id && (request.url.includes('/provinces/') || request.url.includes('/municipalities/'))) {
      this.logger.warn(`❌ BLOQUEADO - GOVERNOR intentando acceder directamente a provincia/municipio por ID`);
      throw new ForbiddenException(
        'Acceso denegado. Use filtros por departamento en lugar de acceso directo'
      );
    }

    // BLOQUEAR si intenta filtrar por OTRO departamento
    if (query.departmentId && query.departmentId !== userDepartmentId) {
      this.logger.warn(`❌ BLOQUEADO - Query departmentId: ${query.departmentId} (permitido: ${userDepartmentId})`);
      throw new ForbiddenException(
        `Acceso denegado. Solo puede ver datos del departamento: ${userDepartmentId}`
      );
    }

    if (params.departmentId && params.departmentId !== userDepartmentId) {
      this.logger.warn(`❌ BLOQUEADO - Param departmentId: ${params.departmentId} (permitido: ${userDepartmentId})`);
      throw new ForbiddenException(
        `Acceso denegado. Solo puede ver datos del departamento: ${userDepartmentId}`
      );
    }

    // PERMITIR subfiltros (provinceId, municipalityId, electoralSeat, etc.)
    // sin validación - confiamos en la integridad referencial de la BD

    // FORZAR el filtro por departamento en TODOS los casos
    request.query.departmentId = userDepartmentId;

    // LIMPIAR filtros contradictorios por nombre
    delete request.query.department;

    // Adjuntar metadata para el servicio
    request.userDepartmentId = userDepartmentId;
    request.userRole = 'GOVERNOR';

    this.logger.debug(`✅ GOVERNOR - Filtro forzado departmentId=${userDepartmentId}, subfiltros permitidos`);
  }

  private validateMayorAccess(
    user: any,
    params: any,
    query: any,
    request: any
  ): void {
    const userMunicipalityId = user.votingMunicipalityId;

    this.logger.debug(`🏛️ MAYOR - Municipality asignado: ${userMunicipalityId}`);

    if (!userMunicipalityId) {
      this.logger.error('❌ MAYOR sin municipio asignado en JWT');
      throw new ForbiddenException('Usuario alcalde sin municipio asignado');
    }

    // VALIDACIÓN: Si está accediendo a GET /municipalities/:id
    if (params.id && request.url.includes('/municipalities/')) {
      if (params.id !== userMunicipalityId) {
        this.logger.warn(`❌ BLOQUEADO - Acceso a municipality ${params.id} (permitido: ${userMunicipalityId})`);
        throw new ForbiddenException(
          `Acceso denegado. Solo puede ver su municipio: ${userMunicipalityId}`
        );
      }
      this.logger.debug('✅ Acceso a su propio municipio permitido');
      return; // No forzar filtros adicionales
    }

    // VALIDACIÓN: Bloquear acceso directo a recursos fuera de su jurisdicción
    if (params.id && (request.url.includes('/departments/') || request.url.includes('/provinces/'))) {
      this.logger.warn(`❌ BLOQUEADO - MAYOR intentando acceder a department/province por ID`);
      throw new ForbiddenException(
        'Acceso denegado. Solo puede ver datos de su municipio'
      );
    }

    // BLOQUEAR filtros por departamento o provincia
    if (query.departmentId || params.departmentId ||
        query.provinceId || params.provinceId) {
      this.logger.warn(`❌ BLOQUEADO - MAYOR intentando filtrar por department/province`);
      throw new ForbiddenException(
        'Los alcaldes solo pueden filtrar por su municipio'
      );
    }

    // BLOQUEAR si intenta filtrar por OTRO municipio
    if (query.municipalityId && query.municipalityId !== userMunicipalityId) {
      this.logger.warn(`❌ BLOQUEADO - Query municipalityId: ${query.municipalityId} (permitido: ${userMunicipalityId})`);
      throw new ForbiddenException(
        `Acceso denegado. Solo puede ver datos del municipio: ${userMunicipalityId}`
      );
    }

    if (params.municipalityId && params.municipalityId !== userMunicipalityId) {
      this.logger.warn(`❌ BLOQUEADO - Param municipalityId: ${params.municipalityId} (permitido: ${userMunicipalityId})`);
      throw new ForbiddenException(
        `Acceso denegado. Solo puede ver datos del municipio: ${userMunicipalityId}`
      );
    }

    // PERMITIR subfiltros (electoralSeat, electoralLocation, tableCode)
    // sin validación - confiamos en la integridad referencial

    // FORZAR el filtro por municipio en TODOS los casos
    request.query.municipalityId = userMunicipalityId;

    // LIMPIAR filtros contradictorios
    delete request.query.department;
    delete request.query.province;
    delete request.query.municipality;

    // Adjuntar metadata para el servicio
    request.userMunicipalityId = userMunicipalityId;
    request.userRole = 'MAYOR';

    this.logger.debug(`✅ MAYOR - Filtro forzado municipalityId=${userMunicipalityId}, subfiltros permitidos`);
  }
}