import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserRole = 'patient' | 'doctor' | 'health_worker' | 'admin';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, trim: true })
  phone!: string;

  @Prop({ trim: true, lowercase: true, sparse: true })
  email?: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({
    type: String,
    enum: ['patient', 'doctor', 'health_worker', 'admin'],
    default: 'patient',
  })
  role!: UserRole;

  @Prop()
  name?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
