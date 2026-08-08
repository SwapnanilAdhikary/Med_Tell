import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DoctorDocument = HydratedDocument<Doctor>;

@Schema({ timestamps: true })
export class Doctor {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  title?: string;

  @Prop({ required: true, trim: true })
  specialty: string;

  @Prop({ trim: true })
  registrationNumber?: string;

  @Prop({ type: [String], default: [] })
  languages: string[];

  @Prop({ type: [Number], default: [] })
  availability: number[];

  /**
   * One-sided on purpose: no `doctors[]` array on Facility. findBestMatch
   * already loads the whole doctor doc, so proximity costs no extra query, and
   * there are no transactions anywhere in this repo to keep two lists in step.
   */
  @Prop({ type: Types.ObjectId, ref: 'Facility' })
  facility?: Types.ObjectId;

  @Prop({ default: true })
  verified: boolean;

  @Prop({ trim: true })
  bio?: string;
}

export const DoctorSchema = SchemaFactory.createForClass(Doctor);
