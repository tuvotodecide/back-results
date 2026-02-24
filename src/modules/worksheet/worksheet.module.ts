import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Worksheet, WorksheetSchema } from './schemas/worksheet.schema';
import { WorksheetController } from './controllers/worksheet.controller';
import { WorksheetService } from './services/worksheet.service';
import { UsersModule } from '../users/users.module';
import { GeographicModule } from '../geographic/geographic.module';
import { ElectionsModule } from '../elections/elections.module';
import { ZkAuthModule } from '../zk-auth/zk-auth.module';
import {
  NotificationLog,
  NotificationLogSchema,
} from '../notifications/schemas/notification-log.schema';
import { TableCodeValidationModule } from '../table-code-validation/table-code-validation.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Worksheet.name, schema: WorksheetSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
    ]),
    UsersModule,
    GeographicModule,
    ElectionsModule,
    ZkAuthModule,
    TableCodeValidationModule,
  ],
  controllers: [WorksheetController],
  providers: [WorksheetService],
  exports: [WorksheetService],
})
export class WorksheetModule {}
