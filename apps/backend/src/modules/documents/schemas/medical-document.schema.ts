import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentStatus =
  'pending' | 'ai-reviewed' | 'awaiting-doctor' | 'approved' | 'rejected';

export type MedicalDocumentDocument = HydratedDocument<MedicalDocument>;

export interface AiFindings {
  docType: string;
  text: string;
  summary: string;
  abnormalFindings: string[];
  recommendations: string[];
  confidence: number;
  disclaimer: string;
  language: string;
}

@Schema({ timestamps: true })
export class MedicalDocument {
  @Prop({ type: Types.ObjectId, ref: 'Patient', required: true, index: true })
  patient: Types.ObjectId;

  @Prop({ required: true, trim: true })
  filename: string;

  @Prop({ trim: true })
  mimeType?: string;

  @Prop({ type: Number })
  size?: number;

  @Prop({ trim: true })
  docType?: string;

  @Prop({ required: true, trim: true })
  filePath: string;

  @Prop({
    type: String,
    enum: ['pending', 'ai-reviewed', 'awaiting-doctor', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  })
  status: DocumentStatus;

  @Prop({ type: Object })
  aiFindings?: AiFindings;

  @Prop({ type: Object })
  doctorReview?: {
    doctor?: Types.ObjectId;
    decision?: 'approved' | 'rejected';
    comment?: string;
    reviewedAt?: Date;
  };
}

export const MedicalDocumentSchema =
  SchemaFactory.createForClass(MedicalDocument);
