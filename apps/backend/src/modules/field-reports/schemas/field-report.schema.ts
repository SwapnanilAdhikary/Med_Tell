import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { GeoPoint } from '../../facilities/schemas/facility.schema';

/** Exactly the vocabulary CallsService already routes on, so the two agree. */
export type Urgency = 'routine' | 'semi-urgent' | 'urgent' | 'emergency';

export type LocationSource = 'gps' | 'assigned' | 'spoken';

export type FieldReportStatus =
  'extracting' | 'submitted' | 'routed' | 'failed';

export type FieldReportDocument = HydratedDocument<FieldReport>;

@Schema({ _id: false })
export class Vitals {
  @Prop() temperatureC?: number;
  @Prop() spo2?: number;
  @Prop() systolic?: number;
  @Prop() diastolic?: number;
  @Prop() pulse?: number;
  @Prop() respRate?: number;
  @Prop() weightKg?: number;
  @Prop() glucoseMgDl?: number;
}

@Schema({ _id: false })
export class Extraction {
  @Prop({ type: [String], default: [] })
  symptoms!: string[];

  @Prop({ type: Vitals, default: () => ({}) })
  vitals!: Vitals;

  @Prop({ trim: true }) duration?: string;
  @Prop({ trim: true }) trend?: string;

  @Prop({
    type: String,
    enum: ['routine', 'semi-urgent', 'urgent', 'emergency'],
  })
  urgency?: Urgency;

  @Prop({ trim: true }) suspectedCondition?: string;
  @Prop({ trim: true }) suggestedSpecialty?: string;
  @Prop() pregnancyStatus?: boolean;
  @Prop() pregnancyMonths?: number;
  @Prop() ageMonths?: number;
  @Prop({ trim: true }) gender?: string;

  @Prop({ type: [String], default: [] })
  dangerSigns!: string[];

  @Prop({ type: [String], default: [] })
  redFlags!: string[];

  @Prop({ trim: true }) summary?: string;
  @Prop() confidence?: number;
}

@Schema({ _id: false })
export class ReportLocation {
  @Prop({ type: GeoPoint, default: undefined })
  point?: GeoPoint;

  /**
   * The honesty field. Without it an assigned-area centroid is
   * indistinguishable from a real fix, and only the service writes it.
   */
  @Prop({
    type: String,
    enum: ['gps', 'assigned', 'spoken'],
    required: true,
  })
  source!: LocationSource;

  @Prop() accuracyM?: number;

  // Denormalised on purpose: a worker gets reassigned, but the report has to
  // keep where it actually happened.
  @Prop({ trim: true }) village?: string;
  @Prop({ trim: true }) block?: string;
  @Prop({ trim: true }) district?: string;
}

@Schema({ timestamps: true })
export class FieldReport {
  @Prop({
    type: Types.ObjectId,
    ref: 'HealthWorker',
    required: true,
    index: true,
  })
  worker!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Patient', required: true, index: true })
  patient!: Types.ObjectId;

  @Prop({ type: String, enum: ['voice', 'web'], required: true })
  channel!: 'voice' | 'web';

  @Prop({ default: 'en' })
  language!: string;

  @Prop()
  rawTranscript?: string;

  @Prop({ type: Extraction, default: () => ({}) })
  extraction!: Extraction;

  @Prop({ type: ReportLocation, required: true })
  location!: ReportLocation;

  @Prop({ type: Types.ObjectId, ref: 'Facility' })
  facility?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Appointment' })
  appointment?: Types.ObjectId;

  /** Denormalised so the worker's screens need no populate and no doctor route. */
  @Prop({ type: Object })
  matchedDoctor?: { name: string; specialty: string; title?: string };

  @Prop({ type: Object })
  consent?: { basis: 'explicit'; at: Date };

  @Prop({
    type: String,
    enum: ['extracting', 'submitted', 'routed', 'failed'],
    default: 'extracting',
    index: true,
  })
  status!: FieldReportStatus;

  /** Set when extraction failed; the raw notes still reached a doctor. */
  @Prop()
  aiError?: string;

  @Prop()
  routingError?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FieldReportSchema = SchemaFactory.createForClass(FieldReport);
