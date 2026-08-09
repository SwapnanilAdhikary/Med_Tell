import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true })
export class Conversation {
  // ponytail: `unique` will fail to build on a non-empty collection that
  // already has duplicate `patient` docs - run a one-time dedup first.
  @Prop({
    type: Types.ObjectId,
    ref: 'Patient',
    required: true,
    index: true,
    unique: true,
  })
  patient!: Types.ObjectId;

  @Prop({ default: 'MedAssist Assistant' })
  title!: string;

  @Prop({ default: 'en' })
  language!: string;

  @Prop({ type: Date, default: Date.now, index: true })
  lastActivity!: Date;

  /**
   * A doctor has taken this thread over. While set, the AI must not answer -
   * an assistant talking over a live doctor is a safety and liability problem.
   * Undefined on every existing conversation, so the default path is unchanged.
   */
  @Prop({ type: Date })
  handoffAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Doctor' })
  handoffDoctor?: Types.ObjectId;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
