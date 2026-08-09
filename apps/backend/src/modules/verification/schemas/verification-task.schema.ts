import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VerificationTaskType =
  'document' | 'certificate' | 'prescription' | 'call-note' | 'appointment';

export type VerificationDecision =
  'pending' | 'approved' | 'edited' | 'rejected';

export type VerificationTaskDocument = HydratedDocument<VerificationTask>;

@Schema({ timestamps: true })
export class VerificationTask {
  @Prop({
    type: String,
    enum: [
      'document',
      'certificate',
      'prescription',
      'call-note',
      'appointment',
    ],
    required: true,
  })
  taskType: VerificationTaskType;

  @Prop({ type: Types.ObjectId, required: true })
  refId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Patient', required: true })
  patient: Types.ObjectId;

  @Prop({ type: Object })
  aiOutput?: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'Doctor', index: true })
  doctor?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'edited', 'rejected'],
    default: 'pending',
    index: true,
  })
  status: VerificationDecision;

  @Prop({ trim: true })
  doctorComment?: string;

  @Prop({ type: Object })
  doctorEdit?: Record<string, unknown>;

  @Prop({ type: Date })
  reviewedAt?: Date;
}

export const VerificationTaskSchema =
  SchemaFactory.createForClass(VerificationTask);
