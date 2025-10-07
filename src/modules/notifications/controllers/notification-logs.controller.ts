
import { Controller, Get, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationLog } from '../schemas/notification-log.schema';
import { ApiTags, ApiQuery, ApiOperation } from '@nestjs/swagger';

@ApiTags('Notification Logs')
@Controller('api/v1/notifications/logs')
export class NotificationLogsController {
  constructor(@InjectModel(NotificationLog.name) private logModel: Model<NotificationLog>) {}

  @Get()
  @ApiOperation({ summary: 'Historial de notificaciones' })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({ name: 'topic', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['announce_count', 'generic'] })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async list(
    @Query('locationId') locationId?: string,
    @Query('topic') topic?: string,
    @Query('type') type?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const filter: any = {};
    if (locationId) filter.locationId = locationId;
    if (topic) filter.topic = topic;
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      this.logModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      this.logModel.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    };
  }
}
