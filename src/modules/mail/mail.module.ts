import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationSchema,
} from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import { RoledUser, RoledUserSchema } from '@/modules/auth/schemas/roledUser.schema';
import {
  InstitutionalEmailOutbox,
  InstitutionalEmailOutboxSchema,
} from './schemas/institutional-email-outbox.schema';
import { InstitutionalEmailOutboxService } from './institutional-email-outbox.service';
import { MailService } from './mail.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstitutionalEmailOutbox.name, schema: InstitutionalEmailOutboxSchema },
      { name: InstitutionalAdminApplication.name, schema: InstitutionalAdminApplicationSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
    ]),
  ],
  providers: [MailService, InstitutionalEmailOutboxService],
  exports: [MailService, InstitutionalEmailOutboxService],
})
export class MailModule {}
