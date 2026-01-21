import { Controller, Get, Param, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { User } from '@/modules/users/schemas/user.schema';
import { UserNotification } from '../schemas/user-notification.schema';

@ApiTags('User Notifications')
@Controller('api/v1/users/:dni/user-notifications')
export class UserNotificationsController {
  
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(UserNotification.name) private userNotifModel: Model<UserNotification>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Historial de notificaciones del usuario por DNI' })
  @ApiParam({ name: 'dni' })
  @ApiQuery({ name: 'status', required: false, enum: ['NEW', 'READ', 'HIDDEN'] })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async list(
    @Param('dni') dni: string,
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const user = await this.userModel.findOne({ dni }, { _id: 1 }).lean();
    if (!user) {
      return { data: [], total: 0, page: Number(page), limit: Number(limit), totalPages: 0 };
    }

    const filter: any = { userId: user._id };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      this.userNotifModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      this.userNotifModel.countDocuments(filter),
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
