import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type Cadre = 'ASHA' | 'ANM';

export type HealthWorkerDocument = HydratedDocument<HealthWorker>;

/**
 * An ASHA or ANM worker: the person who visits households and reports on
 * *other* people. Their assigned area is the geo fallback when a field report
 * has no GPS fix, so it is stored flat and on the worker, not derived.
 */
@Schema({ timestamps: true })
export class HealthWorker {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, enum: ['ASHA', 'ANM'], required: true })
  cadre!: Cadre;

  @Prop({ trim: true })
  workerCode?: string;

  @Prop({ trim: true })
  village?: string;

  @Prop({ trim: true })
  block?: string;

  @Prop({ trim: true })
  district?: string;

  @Prop({ trim: true })
  state?: string;

  /**
   * GeoJSON order: [lng, lat]. Centroid of the assigned area, not a live fix.
   * `default: undefined` on purpose - Mongoose would otherwise store `[]`, and
   * an empty array is truthy, so an absent centroid would read as a real one.
   */
  @Prop({ type: [Number], default: undefined })
  coordinates?: number[];

  @Prop({ type: [String], default: [] })
  languages!: string[];

  @Prop({ type: Types.ObjectId, ref: 'Facility' })
  assignedFacility?: Types.ObjectId;

  @Prop({ default: true })
  active!: boolean;
}

export const HealthWorkerSchema = SchemaFactory.createForClass(HealthWorker);
