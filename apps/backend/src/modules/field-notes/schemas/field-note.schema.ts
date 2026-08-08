import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { GeoPoint } from '../../facilities/schemas/facility.schema';

export type FieldNoteDocument = HydratedDocument<FieldNote>;

/**
 * A worker's own scratchpad, pinned to a place. Deliberately NOT a clinical
 * record: no patient, no doctor, no routing. "Rekha's BP cuff is broken,
 * revisit Tuesday" needs somewhere to live that is not a medical report.
 */
@Schema({ timestamps: true })
export class FieldNote {
  @Prop({
    type: Types.ObjectId,
    ref: 'HealthWorker',
    required: true,
    index: true,
  })
  worker!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ default: '' })
  body!: string;

  @Prop({ type: GeoPoint, default: undefined })
  point?: GeoPoint;

  @Prop({ trim: true })
  village?: string;

  @Prop({ default: false })
  pinned!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FieldNoteSchema = SchemaFactory.createForClass(FieldNote);
