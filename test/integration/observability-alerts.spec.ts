import {
  BadRequestException,
  Controller,
  Get,
  INestApplication,
  InternalServerErrorException,
  Post,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { NextFunction, Response } from 'express';
import request from 'supertest';

import { GlobalExceptionFilter } from '@/core/filters/global-exception.filter';
import { PerformanceLoggingInterceptor } from '@/core/interceptors/performance-logging.interceptor';
import { RequestIdMiddleware } from '@/core/middleware/request-id.middleware';
import { ErrorAlertService } from '@/core/services/error-alert.service';
import { LoggerService } from '@/core/services/logger.service';
import { ErrorAlertEvent } from '@/core/types/error-alert-event';
import { ObservabilityRequest } from '@/core/types/observability-request';
import { MailService } from '@/modules/mail/mail.service';

@Controller('observability-alerts')
class ObservabilityAlertsController {
  @Get('unexpected')
  unexpectedError() {
    throw new Error('Controlled observability failure');
  }

  @Post('unexpected')
  unexpectedPostError(@Body() _body: Record<string, unknown>) {
    throw new Error('Controlled observability failure');
  }

  @Get('internal')
  internalError() {
    throw new InternalServerErrorException('Controlled internal failure');
  }

  @Get('bad-request')
  badRequest() {
    throw new BadRequestException('Controlled bad request');
  }

  @Get('success')
  success() {
    return { ok: true };
  }
}

type LoggerMock = {
  log: jest.Mock;
  error: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  verbose: jest.Mock;
};

type TestApp = {
  app: INestApplication;
  moduleRef: TestingModule;
  logger: LoggerMock;
  mailService: { sendEmail: jest.Mock };
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

async function createTestApp(overrides: Record<string, unknown> = {}): Promise<TestApp> {
  const logger: LoggerMock = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
  const mailService = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };
  const configValues: Record<string, unknown> = {
    'app.nodeEnv': 'test',
    'app.errorAlerts.to': 'alerts@example.test',
    ...overrides,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [ObservabilityAlertsController],
    providers: [
      { provide: LoggerService, useValue: logger },
      { provide: MailService, useValue: mailService },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) => configValues[key]),
        },
      },
      ErrorAlertService,
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      { provide: APP_INTERCEPTOR, useClass: PerformanceLoggingInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use((req: ObservabilityRequest, res: Response, next: NextFunction) =>
    requestIdMiddleware.use(req, res, next),
  );
  await app.init();

  return { app, moduleRef, logger, mailService };
}

describe('Backend error observability and email alerts', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await testApp?.app.close();
    await testApp?.moduleRef.close();
  });

  it('logs unexpected errors, returns a safe response and sends a non-blocking 5xx email alert', async () => {
    testApp = await createTestApp();

    const response = await request(testApp.app.getHttpServer())
      .get('/observability-alerts/unexpected')
      .set('x-request-id', 'req-unexpected-alert')
      .expect(500);
    await flushPromises();

    expect(response.headers['x-request-id']).toBe('req-unexpected-alert');
    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 500,
        path: '/observability-alerts/unexpected',
        method: 'GET',
        requestId: 'req-unexpected-alert',
        message: 'Internal server error',
      }),
    );
    expect(response.body.stacktrace).toBeUndefined();
    expect(response.body.stack).toBeUndefined();

    const [logPayload, stacktrace] = testApp.logger.error.mock.calls[0];
    const parsedLog = JSON.parse(String(logPayload));
    expect(parsedLog).toEqual(
      expect.objectContaining({
        event: 'backend_request_failed',
        environment: 'test',
        statusCode: 500,
        method: 'GET',
        path: '/observability-alerts/unexpected',
        requestId: 'req-unexpected-alert',
        errorName: 'Error',
        errorMessage: 'Controlled observability failure',
      }),
    );
    expect(parsedLog.durationMs).toEqual(expect.any(Number));
    expect(String(stacktrace)).toContain('Controlled observability failure');

    expect(testApp.mailService.sendEmail).toHaveBeenCalledTimes(1);
    const [, subject, template, emailData, options] = testApp.mailService.sendEmail.mock.calls[0];
    expect(subject).toBe('[test] Backend critical error 500');
    expect(template).toBe('error-alert');
    expect(options).toBeUndefined();
    expect(emailData satisfies ErrorAlertEvent).toEqual(
      expect.objectContaining({
        environment: 'test',
        requestId: 'req-unexpected-alert',
        method: 'GET',
        path: '/observability-alerts/unexpected',
        statusCode: 500,
        errorName: 'Error',
        errorMessage: 'Controlled observability failure',
      }),
    );
    expect(emailData.durationMs).toEqual(expect.any(Number));
    expect(emailData.stacktrace).toContain('Controlled observability failure');
    expect(emailData.requestBody).toBe('undefined');
  });

  it('sends email alerts for InternalServerErrorException', async () => {
    testApp = await createTestApp();

    const response = await request(testApp.app.getHttpServer())
      .get('/observability-alerts/internal')
      .expect(500);
    await flushPromises();

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 500,
        message: 'Controlled internal failure',
        requestId: expect.any(String),
      }),
    );
    expect(response.body.stack).toBeUndefined();
    expect(testApp.mailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not send email alerts for BadRequestException', async () => {
    testApp = await createTestApp();

    const response = await request(testApp.app.getHttpServer())
      .get('/observability-alerts/bad-request')
      .expect(400);
    await flushPromises();

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'Controlled bad request',
        requestId: expect.any(String),
      }),
    );
    expect(response.body.stack).toBeUndefined();
    expect(testApp.mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('does not send email alerts when ERROR_ALERT_EMAIL_TO is empty', async () => {
    testApp = await createTestApp({ 'app.errorAlerts.to': '' });

    await request(testApp.app.getHttpServer())
      .get('/observability-alerts/internal')
      .expect(500);
    await flushPromises();

    expect(testApp.mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('includes requestBody in email alerts and redacts obvious sensitive keys', async () => {
    testApp = await createTestApp();

    await request(testApp.app.getHttpServer())
      .post('/observability-alerts/unexpected')
      .send({
        username: 'alice',
        password: 'plain-password',
        nested: {
          token: 'secret-token',
          keep: 'visible',
        },
        accessToken: 'access-token-value',
        apiKey: 'api-key-value',
      })
      .expect(500);
    await flushPromises();

    expect(testApp.mailService.sendEmail).toHaveBeenCalledTimes(1);
    const [, , , emailData] = testApp.mailService.sendEmail.mock.calls[0];

    expect(emailData.requestBody).toContain('"username": "alice"');
    expect(emailData.requestBody).toContain('"keep": "visible"');
    expect(emailData.requestBody).toContain('"password": "[REDACTED]"');
    expect(emailData.requestBody).toContain('"token": "[REDACTED]"');
    expect(emailData.requestBody).toContain('"accessToken": "[REDACTED]"');
    expect(emailData.requestBody).toContain('"apiKey": "[REDACTED]"');
    expect(emailData.requestBody).not.toContain('plain-password');
    expect(emailData.requestBody).not.toContain('secret-token');
    expect(emailData.requestBody).not.toContain('access-token-value');
    expect(emailData.requestBody).not.toContain('api-key-value');
  });

  it('suppresses repeated email alerts during cooldown', async () => {
    testApp = await createTestApp();

    await request(testApp.app.getHttpServer())
      .get('/observability-alerts/internal')
      .expect(500);
    await request(testApp.app.getHttpServer())
      .get('/observability-alerts/internal')
      .expect(500);
    await flushPromises();

    expect(testApp.mailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(testApp.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('backend_error_alert_suppressed'),
      ErrorAlertService.name,
    );
  });

  it('logs successful requests with performance metrics and requestId', async () => {
    testApp = await createTestApp();

    const response = await request(testApp.app.getHttpServer())
      .get('/observability-alerts/success')
      .set('x-request-id', 'req-success-observability')
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(response.headers['x-request-id']).toBe('req-success-observability');
    expect(testApp.logger.error).not.toHaveBeenCalled();
    expect(testApp.mailService.sendEmail).not.toHaveBeenCalled();

    const [logPayload] = testApp.logger.log.mock.calls[0];
    const parsedLog = JSON.parse(String(logPayload));
    expect(parsedLog).toEqual(
      expect.objectContaining({
        event: 'backend_request_completed',
        statusCode: 200,
        method: 'GET',
        path: '/observability-alerts/success',
        requestId: 'req-success-observability',
      }),
    );
    expect(parsedLog.durationMs).toEqual(expect.any(Number));
  });
});
