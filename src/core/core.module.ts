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
import * as redisStore from 'cache-manager-redis-store';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: '.env',
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
      },
    }),

    DatabaseModule,
    CacheModule.registerAsync <any>({
      imports: [ConfigModule],
      isGlobal: true,
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('app.redis.host');
        const ttl = configService.get<string>('app.cache.ttl');
        const max = configService.get<string>('app.cache.max');

        if (!host) {
          // fallback en memoria
          return {
            ttl: ttl ? Number(ttl) : undefined,
            max: max ? Number(max) : undefined,
          };
        }

        // Redis (se activa solo si hay host)
        return {
          store: redisStore as any,
          host,
          port: Number(configService.get<string>('app.redis.port')),
          password: configService.get<string>('app.redis.password'), // ← quitado el paréntesis extra
          ttl: ttl ? Number(ttl) : undefined,
          max: max ? Number(max) : undefined,
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [HealthController],
  providers: [LoggerService, HealthService],
  exports: [LoggerService, HealthService, CacheModule],
})
export class CoreModule {}
