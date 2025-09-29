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

        return {
          uri,
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
      // useFactory: (configService: ConfigService) => {
      //   const uri = configService.get<string>('app.database.uri')!;
      //   // Local si host es 127.0.0.1 o localhost
      //   const isLocal = /(^mongodb:\/\/)([^@]*@)?(127\.0\.0\.1|localhost)/.test(
      //     uri,
      //   );

      //   console.log('Database URI being used:', uri);

      //   return {
      //     uri, // ya trae user/pass y ?authSource=electoral_db
      //     directConnection: true,
      //     serverSelectionTimeoutMS: 10000,
      //     maxPoolSize: 10,
      //     retryWrites: false,
      //     w: 'majority',

      //     // TLS solo en no-local; en local debe ir OFF para evitar SSLHandshakeFailed
      //     tls: !isLocal,
      //     // Solo apunta al bundle en no-local; en local debe ser undefined
      //     tlsCAFile: !isLocal
      //       ? path.resolve(__dirname, '../../global-bundle.pem')
      //       : undefined,

      //     // No aceptes hostnames inválidos (también en prod)
      //     tlsAllowInvalidHostnames: false,
      //   };
      // },

      inject: [ConfigService],
    }),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
