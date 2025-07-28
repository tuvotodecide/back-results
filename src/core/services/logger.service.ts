/* eslint-disable prettier/prettier */
import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoggerService implements NestLoggerService {
  constructor(private configService: ConfigService) {}

  private formatMessage(level: string, message: any, context?: string): string {
    const timestamp = new Date().toISOString();
    const env = this.configService.get<string>('app.nodeEnv');
    const contextStr = context ? `[${context}] ` : '';

    return `${timestamp} [${env}] ${level.toUpperCase()} ${contextStr}${message}`;
  }

  log(message: any, context?: string) {
    console.log(this.formatMessage('info', message, context));
  }

  error(message: any, trace?: string, context?: string) {
    console.error(this.formatMessage('error', message, context));
    if (trace) {
      console.error(trace);
    }
  }

  warn(message: any, context?: string) {
    console.warn(this.formatMessage('warn', message, context));
  }

  debug(message: any, context?: string) {
    if (this.configService.get('app.nodeEnv') === 'development') {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  verbose(message: any, context?: string) {
    if (this.configService.get('app.nodeEnv') === 'development') {
      console.log(this.formatMessage('verbose', message, context));
    }
  }
}
