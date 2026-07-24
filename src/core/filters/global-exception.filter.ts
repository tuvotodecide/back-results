import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { ErrorAlertService } from '../services/error-alert.service';
import { LoggerService } from '../services/logger.service';
import { ErrorAlertEvent } from '../types/error-alert-event';
import { ObservabilityRequest } from '../types/observability-request';

const MAX_REQUEST_BODY_LENGTH = 8000;
const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'accessToken'.toLowerCase(),
  'refreshToken'.toLowerCase(),
]);

type SafeErrorResponse = {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  requestId: string;
  code?: string;
  message: string | string[];
};

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly errorAlertService: ErrorAlertService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<ObservabilityRequest>();
    const timestamp = new Date().toISOString();
    const statusCode = this.getStatusCode(exception);
    const method = request.method;
    const path = request.originalUrl || request.url;
    const durationMs = this.getDurationMs(request);
    const requestId = request.requestId || 'unknown';
    const errorName = this.getErrorName(exception);
    const errorMessage = this.getErrorMessage(exception);
    const stacktrace = exception instanceof Error ? exception.stack || '' : '';
    const environment = this.config.get<string>('app.nodeEnv') || 'unknown';
    const requestBody = this.serializeRequestBody(request.body);
    const event: ErrorAlertEvent = {
      timestamp,
      environment,
      statusCode,
      method,
      path,
      durationMs,
      requestId,
      errorName,
      errorMessage,
      stacktrace,
      requestBody,
    };

    this.logger.error(
      JSON.stringify({
        event: 'backend_request_failed',
        timestamp,
        environment,
        statusCode,
        method,
        path,
        durationMs,
        requestId,
        errorName,
        errorMessage,
        requestBody,
      }),
      stacktrace,
      GlobalExceptionFilter.name,
    );
    this.errorAlertService.notifyCriticalError(event);

    response.status(statusCode).json({
      statusCode,
      timestamp,
      path,
      method,
      requestId,
      code: this.getClientCode(exception),
      message: this.getClientMessage(exception),
    } satisfies SafeErrorResponse);
  }

  private getStatusCode(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getDurationMs(request: ObservabilityRequest): number {
    return typeof request.startedAt === 'number'
      ? Math.max(0, Date.now() - request.startedAt)
      : 0;
  }

  private getErrorName(exception: unknown): string {
    return exception instanceof Error ? exception.name : 'UnknownError';
  }

  private getErrorMessage(exception: unknown): string {
    if (exception instanceof Error) return exception.message;
    if (typeof exception === 'string') return exception;
    return 'Unknown error';
  }

  private getClientMessage(exception: unknown): string | string[] {
    if (!(exception instanceof HttpException)) return 'Internal server error';

    const exceptionResponse = exception.getResponse();
    if (typeof exceptionResponse === 'string') return exceptionResponse;
    if (
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      'message' in exceptionResponse
    ) {
      const message = (exceptionResponse as { message?: unknown }).message;
      if (Array.isArray(message)) return message.map(String);
      if (typeof message === 'string') return message;
    }

    return exception.message;
  }

  private getClientCode(exception: unknown): string | undefined {
    if (!(exception instanceof HttpException)) return undefined;

    const exceptionResponse = exception.getResponse();
    if (
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      'code' in exceptionResponse
    ) {
      const code = (exceptionResponse as { code?: unknown }).code;
      if (typeof code === 'string' && code.trim()) return code;
    }

    return undefined;
  }

  private serializeRequestBody(body: unknown): string {
    if (body === undefined) return 'undefined';

    try {
      const redacted = this.redactSensitiveBodyValues(body, new WeakSet<object>());
      const serialized = JSON.stringify(redacted, null, 2);
      return serialized.length > MAX_REQUEST_BODY_LENGTH
        ? `${serialized.slice(0, MAX_REQUEST_BODY_LENGTH)}\n[TRUNCATED]`
        : serialized;
    } catch (error: unknown) {
      return `[Unserializable request body: ${
        error instanceof Error ? error.message : String(error)
      }]`;
    }
  }

  private redactSensitiveBodyValues(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || typeof value !== 'object') return value;

    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => this.redactSensitiveBodyValues(item, seen));
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        this.isSensitiveBodyKey(key)
          ? '[REDACTED]'
          : this.redactSensitiveBodyValues(nestedValue, seen),
      ]),
    );
  }

  private isSensitiveBodyKey(key: string): boolean {
    return SENSITIVE_BODY_KEYS.has(key.toLowerCase());
  }
}
