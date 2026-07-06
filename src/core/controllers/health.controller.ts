/* eslint-disable prettier/prettier */
import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { HealthService } from '../services/health.service';
import { Public } from '../decorators/public.decorator';
import { AdminOnlyGuard } from '../guards/admin-only.guard';

@ApiTags('Sistema')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check del sistema' })
  @ApiResponse({
    status: 200,
    description: 'Sistema funcionando correctamente',
  })
  checkHealth() {
    return this.healthService.getHealthStatus();
  }
}

@ApiTags('Sistema')
@Controller('api/v1/health')
export class ApiHealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check del sistema' })
  @ApiResponse({
    status: 200,
    description: 'Sistema funcionando correctamente',
  })
  checkHealth() {
    return this.healthService.getHealthStatus();
  }

  @Get('liveness')
  @Public()
  @ApiOperation({ summary: 'Liveness check del proceso' })
  @ApiResponse({
    status: 200,
    description: 'Proceso funcionando',
  })
  checkLiveness() {
    return this.healthService.getLivenessStatus();
  }

  @Get('readiness')
  @Public()
  @ApiOperation({ summary: 'Readiness check del sistema' })
  @ApiResponse({
    status: 200,
    description: 'Dependencias criticas disponibles',
  })
  @ApiResponse({
    status: 503,
    description: 'Dependencias criticas no disponibles',
  })
  async checkReadiness(@Res({ passthrough: true }) response: Response) {
    const readiness = await this.healthService.getReadinessStatus();
    response.status(readiness.status === 'ok' ? 200 : 503);
    return readiness;
  }

  @Get('externals')
  @UseGuards(AdminOnlyGuard)
  @ApiOperation({ summary: 'Health check manual de externos' })
  @ApiResponse({
    status: 200,
    description: 'Externos validados bajo demanda por administrador',
  })
  @ApiResponse({
    status: 401,
    description: 'Token requerido o invalido',
  })
  @ApiResponse({
    status: 403,
    description: 'Rol ADMIN requerido',
  })
  async checkExternals() {
    return this.healthService.getExternalHealthStatus();
  }
}
