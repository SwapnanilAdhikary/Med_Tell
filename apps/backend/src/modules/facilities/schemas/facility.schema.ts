import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FacilityType = 'PHC' | 'CHC' | 'sub-centre' | 'district-hospital';

export type FacilityDocument = HydratedDocument<Facility>;

@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point' })
  type!: 'Point';

  /** GeoJSON order: [lng, lat]. */
  @Prop({ type: [Number], required: true })
  coordinates!: number[];
}

@Schema({ timestamps: true })
export class Facility {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({
    type: String,
    enum: ['PHC', 'CHC', 'sub-centre', 'district-hospital'],
    required: true,
  })
  type!: FacilityType;

  @Prop({ trim: true })
  village?: string;

  @Prop({ trim: true })
  block?: string;

  @Prop({ trim: true })
  district?: string;

  @Prop({ trim: true })
  state?: string;

  @Prop({ type: GeoPoint, default: undefined })
  location?: GeoPoint;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ type: [String], default: [] })
  specialties!: string[];
}

export const FacilitySchema = SchemaFactory.createForClass(Facility);

/**
 * The first index in this repo, and a correctness requirement rather than an
 * optimisation: `$near` errors outright without it. `autoIndex` builds it
 * asynchronously, so a query in the first moments after a cold boot can still
 * fail - which is why FacilitiesService.findNearest catches and falls through.
 */
FacilitySchema.index({ location: '2dsphere' });
