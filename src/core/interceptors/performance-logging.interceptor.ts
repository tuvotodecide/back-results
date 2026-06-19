import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { LoggerService } from '../services/logger.service';
import { ObservabilityRequest } from '../types/observability-request';

const SLOW_REQUEST_THRESHOLD_MS = 1000;

@Injectable()
export class PerformanceLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<ObservabilityRequest>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      tap({
        next: () => this.logSuccess(request, response),
      }),
    );
  }

  private logSuccess(request: ObservabilityRequest, response: Response) {
    const durationMs = this.getDurationMs(request);
    const payload = JSON.stringify({
      event: 'backend_request_completed',
      statusCode: response.statusCode,
      method: request.method,
      path: request.originalUrl || request.url,
      durationMs,
      requestId: request.requestId || 'unknown',
    });

    if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
      this.logger.warn(payload, PerformanceLoggingInterceptor.name);
      return;
    }

    this.logger.log(payload, PerformanceLoggingInterceptor.name);
  }

  private getDurationMs(request: ObservabilityRequest): number {
    return typeof request.startedAt === 'number'
      ? Math.max(0, Date.now() - request.startedAt)
      : 0;
  }
}
