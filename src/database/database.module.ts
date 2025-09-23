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
        const uri = configService.get<string>('app.database.uri');
        const username = configService.get<string>('app.database.username');
        const password = configService.get<string>('app.database.password');
        const isLocal = process.env.NODE_ENV === 'development'; // O usa configService.get('app.env') == 'local'
        const caPath = isLocal
          ? undefined
          : path.resolve(__dirname, '../../global-bundle.pem'); // Solo para no-local

        console.log('Database URI being used:', uri);

        return {
          uri,
          authSource: username ? 'admin' : undefined, // Solo si hay username
          auth: username && password ? { username, password } : undefined,
          retryWrites: false,
          w: 'majority',
          maxPoolSize: 10,
          tls: !isLocal, // Desactiva TLS para local
          tlsCAFile: caPath, // Solo si tls está activo
          tlsAllowInvalidHostnames: !isLocal, // Solo si tls está activo
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
