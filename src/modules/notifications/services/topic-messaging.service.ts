import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationLog } from '../schemas/notification-log.schema';
import { Inject, Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { User } from '@/modules/users/schemas/user.schema';
import { UserNotification } from '../schemas/user-notification.schema';

@Injectable()
export class TopicMessagingService {
  constructor(
    @Inject('FIREBASE_ADMIN') private readonly fb: typeof admin,
    @InjectModel(NotificationLog.name) private logModel: Model<NotificationLog>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(UserNotification.name)
    private userNotifModel: Model<UserNotification>,
  ) {}

  private makeTopic(locationId: string) {
    const clean = String(locationId || '').replace(/[^A-Za-z0-9_-]/g, '');
    return `loc_${clean}`;
  }

  async announceCountToLocation(params: {
    locationId: string;
    locationName?: string;
    locationAddress?: string;
    tableId?: string;
    tableNumber?: number | string;
    tableCode?: string;
    title?: string;
    body?: string;
  }) {
    const topic = this.makeTopic(params.locationId);
    const data: Record<string, string> = {
      type: 'announce_count',
      locationId: params.locationId,
      locationName: params.locationName ?? '',
      locationAddress: params.locationAddress ?? '',
      screen: 'CountTableDetail',
      tableId: params.tableId ?? '',
      ...(params.tableCode ? { tableCode: String(params.tableCode) } : {}),
      ...(params.tableNumber != null
        ? { tableNumber: String(params.tableNumber) }
        : {}),
    };
    const message: admin.messaging.Message = {
      topic,
      notification: {
        title: params.title ?? 'Inicio de conteo',
        body:
          params.body ??
          `Se anunció conteo en ${params.locationName ?? 'el recinto'}`,
      },
      data,
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    };

    try {
      const res = await this.fb.messaging().send(message);

      await this.logModel.create({
        type: 'announce_count',
        topic,
        locationId: params.locationId,
        tableId: params.tableId,
        title: message.notification?.title,
        body: message.notification?.body,
        data,
        status: 'SENT',
        messageId: res,
      });

      const locObjId = new Types.ObjectId(params.locationId);
      const users = await this.userModel
        .find({ votingLocationId: locObjId }, { _id: 1, dni: 1 })
        .lean();

      if (users.length) {
        const batch = users.map((u) => ({
          userId: u._id as any,
          dni: u.dni,
          topic,
          locationId: params.locationId,
          tableId: params.tableId,
          title: message.notification?.title,
          body: message.notification?.body,
          data: message.data,
          status: 'NEW',
        }));
        await this.userNotifModel.insertMany(batch, { ordered: false });
      }

      return res;
    } catch (e: any) {
      await this.logModel.create({
        type: 'announce_count',
        topic,
        locationId: params.locationId,
        tableId: params.tableId,
        title: message.notification?.title,
        body: message.notification?.body,
        data,
        status: 'FAILED',
        error: e?.message || String(e),
      });
      throw e;
    }
  }
}
