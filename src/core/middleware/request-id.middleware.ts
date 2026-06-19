import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { ObservabilityRequest } from '../types/observability-request';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: ObservabilityRequest, res: Response, next: NextFunction) {
    const headerRequestId = req.header('x-request-id')?.trim();
    const requestId = headerRequestId || randomUUID();

    req.requestId = requestId;
    req.startedAt = Date.now();
    res.setHeader('x-request-id', requestId);

    next();
  }
}
