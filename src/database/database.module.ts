/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const uri =
          configService.get<string>('app.database.uri') ??
          process.env.MONGODB_URI ??
          '';
        const username = configService.get<string>('app.database.username');
        const password = configService.get<string>('app.database.password');

        if (typeof uri !== 'string' || !uri.trim()) {
          throw new Error(
            'MongoDB URI no configurada. Defina MONGODB_URI en el entorno o en .env antes de iniciar Nest o ejecutar scripts.',
          );
        }

        // Preservar esta heurística: en local no se fuerza TLS para no alterar
        // el comportamiento de desarrollo ya validado.
        const isLocal = configService.get<string>('app.nodeEnv') === 'development';
        const caPath = isLocal
          ? undefined
          : path.resolve(__dirname, '../../global-bundle.pem'); // Solo para no-local

        return {
          uri: uri.trim(),
          // authSource: username ? 'admin' : undefined, // Solo si hay username
          auth: username && password ? { username, password } : undefined,
          retryWrites: false,
          w: 'majority',
          maxPoolSize: 10,
          tls: !isLocal,
          tlsCAFile: caPath,
          tlsAllowInvalidHostnames: !isLocal,
          directConnection: true,
          serverSelectionTimeoutMS: 30000,
        };
      },
      inject: [ConfigService],
    }),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
