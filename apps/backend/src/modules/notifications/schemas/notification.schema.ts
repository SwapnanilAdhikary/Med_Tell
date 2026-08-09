import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<AppNotification>;

export type NotificationType =
  | 'appointment'
  | 'verification'
  | 'certificate'
  | 'document'
  | 'chat'
  | 'system';

@Schema({ timestamps: true })
export class AppNotification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: '' })
  body: string;

  @Prop({
    type: String,
    enum: [
      'appointment',
      'verification',
      'certificate',
      'document',
      'chat',
      'system',
    ],
    default: 'system',
  })
  type: NotificationType;

  @Prop({ type: Object })
  ref?: Record<string, unknown>;

  @Prop({ default: false })
  read: boolean;

  @Prop({ type: Date, index: true })
  readAt?: Date;
}

export const AppNotificationSchema =
  SchemaFactory.createForClass(AppNotification);
