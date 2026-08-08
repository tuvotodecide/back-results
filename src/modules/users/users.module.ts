import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './services/users.service';
import { UsersController } from './controllers/users.controller';
import { ElectoralTable, ElectoralTableSchema } from '../geographic/schemas/electoral-table.schema';
import { ElectoralLocation, ElectoralLocationSchema } from '../geographic/schemas/electoral-location.schema';
import { NotificationLog, NotificationLogSchema } from '../notifications/schemas/notification-log.schema';
import { UserNotification, UserNotificationSchema } from '../notifications/schemas/user-notification.schema';
import { ZkAuthModule } from '../zk-auth/zk-auth.module';
import { IncentiveCampaignsService } from './services/incentive-campaigns.service';
import { HistoryModule } from '../history/history.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ElectoralTable.name, schema: ElectoralTableSchema },
      { name: ElectoralLocation.name, schema: ElectoralLocationSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
      { name: UserNotification.name, schema: UserNotificationSchema },
    ]),
    ZkAuthModule,
    HistoryModule,
  ],
  providers: [UsersService, IncentiveCampaignsService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
