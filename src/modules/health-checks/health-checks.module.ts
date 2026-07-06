import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MailModule } from '../mail/mail.module';
import { DailyHealthCronService } from './daily-health.cron.service';

@Module({
  imports: [MailModule, HttpModule],
  providers: [DailyHealthCronService],
})
export class HealthChecksModule {}