/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { MiddlewareConsumer, Module, Global, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { AppConfigModule } from '../config/app-config.module';
import { MailModule } from '../modules/mail/mail.module';
import { LoggerService } from './services/logger.service';
import { ErrorAlertService } from './services/error-alert.service';
import { HealthService } from './services/health.service';
import { HealthController } from './controllers/health.controller';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { PerformanceLoggingInterceptor } from './interceptors/performance-logging.interceptor';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import Keyv from 'keyv';
import { createClient, RedisClientType } from 'redis';

@Global()
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    MailModule,
    CacheModule.registerAsync<any>({
      imports: [ConfigModule],
      isGlobal: true,
      useFactory: async (configService: ConfigService) => {
        const host = configService.get<string>('app.redis.host');
        const ttlSeconds = configService.get<number>('app.cache.ttl');
        const max = configService.get<number>('app.cache.max');
        const ttl = typeof ttlSeconds === 'number' ? ttlSeconds * 1000 : undefined;

        if (!host) {
          // fallback en memoria
          return {
            ttl,
            max,
          };
        }

        // Redis (se activa solo si hay host)
        const port = Number(configService.get<string>('app.redis.port'));
        const password = configService.get<string>('app.redis.password') || undefined;
        const namespace = 'back-results-cache';
        const client: RedisClientType = createClient({
          socket: { host, port },
          password,
        });
        await client.connect();

        const keyv = new Keyv({
          namespace,
          ttl,
          store: {
            async get(key: string) {
              return client.get(key);
            },
            async set(key: string, value: string, ttlMs?: number) {
              if (typeof ttlMs === 'number') {
                await client.pSetEx(key, Math.max(1, Math.floor(ttlMs)), value);
              } else {
                await client.set(key, value);
              }
              return true;
            },
            async delete(key: string) {
              const removed = await client.del(key);
              return removed > 0;
            },
            async clear() {
              const keys = await client.keys(`${namespace}:*`);
              if (keys.length > 0) {
                await client.del(keys);
              }
            },
            async disconnect() {
              await client.quit();
            },
          },
        });

        return {
          ttl,
          max,
          stores: [keyv],
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [HealthController],
  providers: [
    LoggerService,
    HealthService,
    ErrorAlertService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PerformanceLoggingInterceptor,
    },
  ],
  exports: [LoggerService, HealthService, CacheModule],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
