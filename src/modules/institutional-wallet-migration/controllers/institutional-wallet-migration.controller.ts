import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { InstitutionalWalletMigrationService } from '../services/institutional-wallet-migration.service';

@ApiTags('Institutional Wallet Migration')
@Controller('api/v1/institutional-wallet-migrations')
@UseGuards(JwtAuthGuard)
export class InstitutionalWalletMigrationController {
  constructor(private readonly migrationService: InstitutionalWalletMigrationService) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Indica si la institución puede crear y publicar votaciones o si espera la migración de billeteras',
  })
  getStatus(@Query('tenantId') tenantId: string | undefined, @Req() req: any) {
    return this.migrationService.getGateForUser(req.user, tenantId);
  }
}
