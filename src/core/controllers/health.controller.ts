/* eslint-disable prettier/prettier */
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from '../services/health.service';
import { Public } from '../decorators/public.decorator';

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
