import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationLogDocument = NotificationLog & Document;

@Schema({ timestamps: true, collection: 'notification_logs' })
export class NotificationLog {
  @Prop({ required: true, enum: ['announce_count', 'generic'] })
  type: 'announce_count' | 'generic';

  @Prop({ required: true })
  topic: string;

  @Prop() locationId?: string;
  @Prop() tableId?: string;

  @Prop() title?: string;
  @Prop() body?: string;

  @Prop({ type: Object }) data?: Record<string, any>;

  @Prop({
    required: true,
    enum: ['PENDING', 'SENDING', 'SENT', 'FAILED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED'],
  })
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | 'CANCELLED';

  @Prop() messageId?: string;
  @Prop() error?: string;
}

export const NotificationLogSchema =
  SchemaFactory.createForClass(NotificationLog);
NotificationLogSchema.index({ locationId: 1, createdAt: -1 });
NotificationLogSchema.index({ topic: 1, createdAt: -1 });
NotificationLogSchema.index({ topic: 1, createdAt: -1, _id: -1 });
