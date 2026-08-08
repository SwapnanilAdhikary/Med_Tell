import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PatientDocument = HydratedDocument<Patient>;

export class FamilyMember {
  @Prop({ required: true })
  name: string;

  @Prop()
  relation: string;

  @Prop()
  age?: number;
}

export class HealthProfile {
  @Prop({ type: [String], default: [] })
  allergies: string[];

  @Prop({ type: [String], default: [] })
  conditions: string[];

  @Prop({ type: [String], default: [] })
  medications: string[];
}

@Schema({ timestamps: true })
export class Patient {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop()
  dateOfBirth?: Date;

  @Prop({ trim: true })
  gender?: string;

  @Prop({ trim: true })
  bloodGroup?: string;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ type: HealthProfile, default: () => ({}) })
  healthProfile: HealthProfile;

  @Prop({ type: [FamilyMember], default: [] })
  family: FamilyMember[];

  @Prop({ default: false })
  consentGranted: boolean;
}

export const PatientSchema = SchemaFactory.createForClass(Patient);
