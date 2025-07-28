/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private configService: ConfigService,
  ) {}

  getHealthStatus() {
    const mongoStatus = this.getMongoStatus();
    const appInfo = this.getAppInfo();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: this.configService.get<string>('app.nodeEnv'),
      version: process.env.npm_package_version || '1.0.0',
      services: {
        database: mongoStatus,
        // Redis status se agregará en el módulo de cache
      },
      ...appInfo,
    };
  }

  private getMongoStatus() {
    const state: number = this.connection.readyState;
    const states: { [key: number]: string } = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };

    return {
      status: states[state] || 'unknown',
      host: this.connection.host,
      name: this.connection.name,
    };
  }

  private getAppInfo() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    };
  }
}
