/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('app.database.uri');
        const username = configService.get<string>('app.database.username');
        const password = configService.get<string>('app.database.password');

        return {
          uri,
          authSource: 'admin',
          auth: username && password ? { username, password } : undefined,
          retryWrites: true,
          w: 'majority',
          maxPoolSize: 10,
        };
      },
      inject: [ConfigService],
    }),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
