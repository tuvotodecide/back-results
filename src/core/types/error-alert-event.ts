export type ErrorAlertEvent = {
  timestamp: string;
  environment: string;
  statusCode: number;
  method: string;
  path: string;
  durationMs: number;
  requestId: string;
  errorName: string;
  errorMessage: string;
  stacktrace: string;
  requestBody: string;
};
