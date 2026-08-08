import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export interface AttachmentRef {
  kind: 'medical-document' | 'file';
  id?: string;
  name: string;
  mimeType?: string;
  url?: string;
}

@Schema({ timestamps: true })
export class Message {
  @Prop({
    type: Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  })
  conversation: Types.ObjectId;

  @Prop({ type: String, enum: ['user', 'assistant', 'system'], required: true })
  role: 'user' | 'assistant' | 'system';

  @Prop({ default: '' })
  content: string;

  @Prop({ type: Object, default: [] })
  attachments: AttachmentRef[];

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
