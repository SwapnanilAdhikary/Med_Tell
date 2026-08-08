import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AppointmentStatus =
  'requested' | 'assigned' | 'completed' | 'cancelled';

export type AppointmentType = 'call-back' | 'video' | 'in-person';

export type AppointmentDocument = HydratedDocument<Appointment>;

@Schema({ timestamps: true })
export class Appointment {
  @Prop({ type: Types.ObjectId, ref: 'Patient', required: true, index: true })
  patient!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Doctor', index: true })
  doctor?: Types.ObjectId;

  /** Best specialty match from AI triage. The doctor still claims from the queue. */
  @Prop({ type: Types.ObjectId, ref: 'Doctor', index: true })
  suggestedDoctor?: Types.ObjectId;

  @Prop({ trim: true })
  suggestedSpecialty?: string;

  // Enum added with the first non-default writer: without it a typo saved silently.
  @Prop({
    type: String,
    enum: ['call-back', 'video', 'in-person'],
    default: 'call-back',
  })
  type!: AppointmentType;

  @Prop({ type: Date, index: true })
  slotStart?: Date;

  @Prop({ type: Date })
  slotEnd?: Date;

  @Prop({
    type: String,
    enum: ['requested', 'assigned', 'completed', 'cancelled'],
    default: 'requested',
    index: true,
  })
  status!: AppointmentStatus;

  @Prop({ trim: true })
  reason?: string;

  @Prop({ type: Object })
  aiNotes?: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'CallSession' })
  callSession?: Types.ObjectId;

  @Prop({ type: Object })
  callBackJob?: {
    preferredWindow?: string;
    bestContactNumber?: string;
    completedAt?: Date;
    consultNotes?: string;
  };

  // Written by `timestamps: true`; declared (not @Prop) so lean() results type.
  createdAt?: Date;
  updatedAt?: Date;
}

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);
