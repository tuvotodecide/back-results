import { Module } from '@nestjs/common';
import { HistoryService } from './services/history.service';
import { HistoryController } from './controllers/history.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { History, HistorySchema } from './schemas/history.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: History.name, schema: HistorySchema },
    ]),
  ],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
