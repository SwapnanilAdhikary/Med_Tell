import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CallSessionDocument = HydratedDocument<CallSession>;

export type CallStatus = 'started' | 'ended' | 'recorded' | 'failed';

@Schema({ timestamps: true })
export class CallSession {
  @Prop({ required: true, unique: true, index: true })
  vapiCallId: string;

  @Prop({ type: Types.ObjectId, ref: 'Patient', index: true })
  patient?: Types.ObjectId;

  @Prop({ trim: true })
  phoneNumber?: string;

  @Prop({ trim: true })
  assistantId?: string;

  @Prop({ trim: true })
  source?: 'phone' | 'web';

  @Prop({ type: Object })
  transcript?: unknown[];

  @Prop()
  transcriptText?: string;

  @Prop({ type: Object })
  summary?: Record<string, unknown>;

  @Prop({ type: Object })
  extractedData?: Record<string, unknown>;

  @Prop({
    type: String,
    enum: ['started', 'ended', 'recorded', 'failed'],
    default: 'started',
  })
  status: CallStatus;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  endedAt?: Date;
}

export const CallSessionSchema = SchemaFactory.createForClass(CallSession);
