import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './services/users.service';
import { UsersController } from './controllers/users.controller';
import { ElectoralTable, ElectoralTableSchema } from '../geographic/schemas/electoral-table.schema';
import { ElectoralLocation, ElectoralLocationSchema } from '../geographic/schemas/electoral-location.schema';
import { NotificationLog, NotificationLogSchema } from '../notifications/schemas/notification-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ElectoralTable.name, schema: ElectoralTableSchema },
      { name: ElectoralLocation.name, schema: ElectoralLocationSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
    ]),
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
