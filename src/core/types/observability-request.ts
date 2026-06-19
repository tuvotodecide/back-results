import { Request } from 'express';

export type ObservabilityRequest = Request & {
  requestId?: string;
  startedAt?: number;
};
