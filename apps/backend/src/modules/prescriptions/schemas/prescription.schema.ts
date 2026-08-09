import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PrescriptionStatus =
  | 'awaiting-doctor'
  | 'issued'
  | 'rejected';

export type FlagSeverity = 'block' | 'warn' | 'info';

export type FlagRole = 'prescriber' | 'safety' | 'formulary' | 'system';

export type TpgList = 'O' | 'A' | 'B' | 'prohibited' | 'unclassified';

export type PrescriptionDocument = HydratedDocument<Prescription>;

@Schema({ _id: false })
export class PrescriptionFlag {
  @Prop({
    type: String,
    enum: ['block', 'warn', 'info'],
    required: true,
  })
  severity!: FlagSeverity;

  @Prop({
    type: String,
    enum: ['prescriber', 'safety', 'formulary', 'system'],
    required: true,
  })
  role!: FlagRole;

  @Prop({ trim: true })
  message?: string;

  @Prop({ trim: true })
  itemName?: string;
}

@Schema({ _id: false })
export class PrescriptionItem {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  dose?: string;

  @Prop({ trim: true })
  frequency?: string;

  @Prop()
  durationDays?: number;

  @Prop({ trim: true })
  instructions?: string;

  @Prop({
    type: String,
    enum: ['O', 'A', 'B', 'prohibited', 'unclassified'],
  })
  tpgList?: TpgList;
}

@Schema({ timestamps: true })
export class Prescription {
  @Prop({ type: Types.ObjectId, ref: 'Patient', required: true, index: true })
  patient!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'FieldReport', index: true })
  fieldReport?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Doctor', index: true })
  doctor?: Types.ObjectId;

  /**
   * TPG's Schedule O/A/B rules depend on how the consult happened, so it is a
   * stored fact at draft time - never inferred later at signing.
   */
  @Prop({ default: 'teleconsult' })
  consultMode!: string;

  @Prop({ trim: true })
  prescriberRegNo?: string;

  /**
   * What the AI council proposed. Frozen at creation; `items` is what the
   * doctor actually signed. The pair is the audit trail and the labelled
   * training data.
   */
  @Prop({ type: [PrescriptionItem], default: [] })
  draftItems!: PrescriptionItem[];

  @Prop({ type: [PrescriptionItem] })
  items?: PrescriptionItem[];

  @Prop({ type: [PrescriptionFlag], default: [] })
  flags!: PrescriptionFlag[];

  @Prop({ type: [String], default: [] })
  failedRoles!: string[];

  @Prop({ type: Object })
  councilOutput?: Record<string, unknown>;

  @Prop({
    type: String,
    enum: ['awaiting-doctor', 'issued', 'rejected'],
    default: 'awaiting-doctor',
    index: true,
  })
  status!: PrescriptionStatus;

  @Prop({ trim: true })
  pdfPath?: string;

  @Prop({ trim: true })
  signedBy?: string;

  @Prop({ type: Date })
  issuedAt?: Date;

  @Prop({ trim: true })
  rejectReason?: string;

  // Deliberately NO TTL index anywhere: TPG requires retention of the
  // prescription record, so an auto-expiry would be a compliance bug.
}

export const PrescriptionSchema = SchemaFactory.createForClass(Prescription);
