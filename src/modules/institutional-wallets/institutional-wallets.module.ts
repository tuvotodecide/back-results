import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { InstitutionalPublicRateLimitGuard } from '@/modules/institutional-admin-applications/guards/institutional-public-rate-limit.guard';
import { InstitutionalWalletsController } from './controllers/institutional-wallets.controller';
import { InstitutionalWalletsService } from './services/institutional-wallets.service';

@Module({
  imports: [HttpModule],
  controllers: [InstitutionalWalletsController],
  providers: [InstitutionalWalletsService, InstitutionalPublicRateLimitGuard],
  exports: [InstitutionalWalletsService],
})
export class InstitutionalWalletsModule {}
