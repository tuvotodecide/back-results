import { Module } from '@nestjs/common';
import { ZkAuthController } from './controllers/zk-auth.controller';
import { ZkAuthService } from './services/zk-auth.service';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';

@Module({
  imports: [],
  controllers: [ZkAuthController],
  providers: [ZkAuthService, ZkAuthGuard],
  exports: [ZkAuthService, ZkAuthGuard],
})
export class ZkAuthModule {}
