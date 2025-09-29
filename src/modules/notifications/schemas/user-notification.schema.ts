import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserNotificationDocument = UserNotification & Document;

@Schema({ timestamps: true, collection: 'user_notifications' })
export class UserNotification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  dni: string;

  @Prop({ required: true })
  topic: string; // ej. loc_<locationId>

  @Prop() locationId?: string;
  @Prop() tableId?: string;

  @Prop() title?: string;
  @Prop() body?: string;

  @Prop({ type: Object }) data?: Record<string, any>;

  // NEW (no leído) | READ (leído) | HIDDEN (oculto)
  @Prop({ required: true, enum: ['NEW', 'READ', 'HIDDEN'], default: 'NEW' })
  status: 'NEW' | 'READ' | 'HIDDEN';
}

export const UserNotificationSchema = SchemaFactory.createForClass(UserNotification);


UserNotificationSchema.index({ dni: 1, createdAt: -1 });
UserNotificationSchema.index({ userId: 1, createdAt: -1 });
UserNotificationSchema.index({ status: 1, createdAt: -1 });
