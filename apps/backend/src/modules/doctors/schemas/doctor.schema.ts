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

  @Prop({ default: true })
  verified: boolean;

  @Prop({ trim: true })
  bio?: string;
}

export const DoctorSchema = SchemaFactory.createForClass(Doctor);
