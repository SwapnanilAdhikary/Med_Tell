import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CertificateType =
  'sick-leave' | 'fitness' | 'medical' | 'insurance';

export type CertificateStatus =
  'draft' | 'awaiting-doctor' | 'issued' | 'rejected';

export type CertificateDocument = HydratedDocument<Certificate>;

@Schema({ timestamps: true })
export class Certificate {
  @Prop({ type: Types.ObjectId, ref: 'Patient', required: true, index: true })
  patient: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Doctor', index: true })
  doctor?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['sick-leave', 'fitness', 'medical', 'insurance'],
    required: true,
  })
  type: CertificateType;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ type: Object })
  draftContent?: Record<string, unknown>;

  @Prop()
  finalContent?: string;

  @Prop({
    type: String,
    enum: ['draft', 'awaiting-doctor', 'issued', 'rejected'],
    default: 'draft',
    index: true,
  })
  status: CertificateStatus;

  @Prop({ trim: true })
  pdfPath?: string;

  @Prop({ trim: true })
  signedBy?: string;

  @Prop({ type: Date })
  validFrom?: Date;

  @Prop({ type: Date })
  validTo?: Date;

  @Prop({ type: Date })
  issuedAt?: Date;

  @Prop({ trim: true })
  rejectReason?: string;
}

export const CertificateSchema = SchemaFactory.createForClass(Certificate);
