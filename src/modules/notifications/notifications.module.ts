import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TopicMessagingService } from './services/topic-messaging.service';
import { AnnouncementsController } from './controllers/announcements.controller';
import { NotificationLogsController } from './controllers/notification-logs.controller';
import {
  NotificationLog,
  NotificationLogSchema,
} from './schemas/notification-log.schema';
import { User, UserSchema } from '@/modules/users/schemas/user.schema';
import {
  UserNotification,
  UserNotificationSchema,
} from './schemas/user-notification.schema';
import { UserNotificationsController } from './controllers/user-notifications.controller';

import { GeographicModule } from '@/modules/geographic/geographic.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NotificationLog.name, schema: NotificationLogSchema },
      { name: User.name, schema: UserSchema },
      { name: UserNotification.name, schema: UserNotificationSchema },
    ]),
    GeographicModule,
  ],
  controllers: [
    AnnouncementsController,
    NotificationLogsController,
    UserNotificationsController,
  ],
  providers: [TopicMessagingService],
  exports: [TopicMessagingService],
})
export class NotificationsModule {}
