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

  @Prop({ type: Types.ObjectId, ref: 'HealthWorker', index: true })
  healthWorker?: Types.ObjectId;

  /**
   * Which flow owns this session. Set at creation and used to refuse a
   * cross-flow claim: without it a patient could POST a field call's id and
   * have an ASHA's transcript about a third party run through patient triage.
   */
  @Prop({ type: String, enum: ['patient', 'field'], default: 'patient' })
  kind!: 'patient' | 'field';

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
