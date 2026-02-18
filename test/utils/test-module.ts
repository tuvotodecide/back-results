import appConfig from "@/config/app.config";
import { JwtAuthGuard } from "@/core/guards/jwt-auth.guard";
import { CacheModule } from "@nestjs/cache-manager";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { MongooseModule } from "@nestjs/mongoose";
import { TestLoggerModule } from "./module-helpers";

export function getBaseTestingModuleImports(mongoUri: string) {
  return [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    MongooseModule.forRoot(mongoUri),
    CacheModule.register({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('app.jwt.secret'),
        signOptions: {
          expiresIn: configService.get('app.jwt.expirationTime'),
        },
      }),
      inject: [ConfigService],
    }),
    TestLoggerModule,
  ];
};

export function getBaseTestingModuleProviders() {
  return [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ];
}