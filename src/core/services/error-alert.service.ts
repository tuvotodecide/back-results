import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '@/modules/mail/mail.service';
import { LoggerService } from './logger.service';
import { ErrorAlertEvent } from '../types/error-alert-event';

const ERROR_ALERT_MIN_STATUS = 500;
const ERROR_ALERT_COOLDOWN_SECONDS = 300;

@Injectable()
export class ErrorAlertService {
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly mailService: MailService,
  ) {}

  notifyCriticalError(event: ErrorAlertEvent): void {
    if (!this.shouldSend(event)) return;

    const signature = this.getSignature(event);
    const now = Date.now();
    const cooldownMs = this.getCooldownSeconds() * 1000;
    const lastSentAt = this.cooldowns.get(signature);

    if (lastSentAt && now - lastSentAt < cooldownMs) {
      this.logger.warn(
        JSON.stringify({
          event: 'backend_error_alert_suppressed',
          reason: 'cooldown',
          signature,
          requestId: event.requestId,
        }),
        ErrorAlertService.name,
      );
      return;
    }

    this.cooldowns.set(signature, now);
    void this.sendAlert(event).catch((error: unknown) => {
      this.logger.warn(
        JSON.stringify({
          event: 'backend_error_alert_failed',
          requestId: event.requestId,
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
        ErrorAlertService.name,
      );
    });
  }

  private shouldSend(event: ErrorAlertEvent): boolean {
    if (!this.config.get<string>('app.errorAlerts.to')) return false;
    if ([400, 401, 403, 404].includes(event.statusCode)) return false;
    return event.statusCode >= ERROR_ALERT_MIN_STATUS;
  }

  private async sendAlert(event: ErrorAlertEvent): Promise<void> {
    const to = this.config.get<string>('app.errorAlerts.to') ?? '';

    await this.mailService.sendEmail(
      to,
      `[${event.environment}] Backend critical error ${event.statusCode}`,
      'error-alert',
      event,
    );
  }

  private getCooldownSeconds(): number {
    return ERROR_ALERT_COOLDOWN_SECONDS;
  }

  private getSignature(event: ErrorAlertEvent): string {
    return [
      event.method,
      event.path,
      event.statusCode,
      event.errorName,
      event.errorMessage,
    ].join(':');
  }
}
