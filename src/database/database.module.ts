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
        const caPath = path.resolve(__dirname, '../../global-bundle.pem');
        console.log('Database URI being used:', uri);

        return {
          uri,
          authSource: 'admin',
          auth: username && password ? { username, password } : undefined,
          retryWrites: false,
          w: 'majority',
          maxPoolSize: 10,
          tls: true,
          tlsCAFile: caPath,
          tlsAllowInvalidHostnames: true,
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
