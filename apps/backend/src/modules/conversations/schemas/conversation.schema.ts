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
  patient: Types.ObjectId;

  @Prop({ default: 'MedAssist Assistant' })
  title: string;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ type: Date, default: Date.now, index: true })
  lastActivity: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
