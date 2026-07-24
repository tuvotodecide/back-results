import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { InstitutionalPublicRateLimitGuard } from '@/modules/institutional-admin-applications/guards/institutional-public-rate-limit.guard';
import { ResolveInstitutionalWalletByDniDto } from '../dto/resolve-institutional-wallet-by-dni.dto';
import { InstitutionalWalletsService } from '../services/institutional-wallets.service';

@ApiTags('Institutional Wallets')
@Controller('api/v1/institutional-wallets')
export class InstitutionalWalletsController {
  constructor(private readonly institutionalWalletsService: InstitutionalWalletsService) {}

  @Post('resolve-by-dni')
  @Public()
  @UseGuards(InstitutionalPublicRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resuelve la wallet institucional por DNI' })
  @ApiBody({ type: ResolveInstitutionalWalletByDniDto })
  @ApiResponse({ status: 200, description: 'Resultado de resolución de wallet.' })
  resolveByDni(@Body() dto: ResolveInstitutionalWalletByDniDto) {
    return this.institutionalWalletsService.resolveByDni(dto.dni);
  }
}
