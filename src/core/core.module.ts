/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { DatabaseModule } from '../database/database.module';
import { LoggerService } from './services/logger.service';
import { HealthService } from './services/health.service';
import { HealthController } from './controllers/health.controller';
import appConfig from '../config/app.config';

@Global()
@Module({
  imports: [
    // Configuración global
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: '.env',
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
      },
    }),

    // Base de datos
    DatabaseModule,
  ],
  controllers: [HealthController],
  providers: [LoggerService, HealthService],
  exports: [LoggerService, HealthService, CacheModule],
})
export class CoreModule {}
