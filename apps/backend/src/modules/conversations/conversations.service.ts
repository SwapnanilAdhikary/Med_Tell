import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';
import { Message, AttachmentRef } from './schemas/message.schema';
import { idFilter } from '../../common/mongoose.util';

function doctorNameOf(metadata?: Record<string, unknown>): string | null {
  if (metadata?.author !== 'doctor') return null;
  const name = metadata.doctorName;
  return typeof name === 'string' && name ? name : null;
}

@Injectable()
export class ConversationsService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
  ) {}

  async getOrCreate(
    patientId: string | Types.ObjectId,
  ): Promise<ConversationDocument> {
    let conversation = await this.conversationModel
      .findOne(idFilter('patient', patientId))
      .exec();

    if (conversation) return conversation;

    try {
      conversation = await this.conversationModel.create({
        patient: patientId,
      });
    } catch (e: any) {
      // Another request created the conversation first.
      if (e.code === 11000) {
        conversation = await this.conversationModel
          .findOne(idFilter('patient', patientId))
          .exec();

        if (!conversation) {
          throw e;
        }

        return conversation;
      }

      throw e;
    }

    return conversation;
  }

  async setLanguage(patientId: string | Types.ObjectId, language: string) {
    return this.conversationModel
      .findOneAndUpdate(
        idFilter('patient', patientId),
        { language },
        { new: true },
      )
      .exec();
  }

  async addMessage(
    conversationId: string | Types.ObjectId,
    role: 'user' | 'assistant' | 'system',
    content: string,
    attachments: AttachmentRef[] = [],
    metadata?: Record<string, unknown>,
  ) {
    const message = await this.messageModel.create({
      conversation: conversationId,
      role,
      content,
      attachments,
      metadata,
    });
    await this.conversationModel
      .findByIdAndUpdate(conversationId, { lastActivity: new Date() })
      .exec();
    return message;
  }

  async history(
    conversationId: string | Types.ObjectId,
    limit = 30,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const messages = await this.messageModel
      .find(idFilter('conversation', conversationId))
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return messages
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        // A doctor's message is stored as `assistant` so it reaches the model as
        // prior context and renders in the existing UI. Without this prefix the
        // model cannot tell its own words from the doctor's - closed in content,
        // not in the role enum, which OpenAI has no 'doctor' value for.
        content: doctorNameOf(m.metadata)
          ? `[Dr. ${doctorNameOf(m.metadata)}]: ${m.content}`
          : m.content,
      }));
  }

  /** Set by a doctor taking over; cleared on release. */
  async setHandoff(
    patientId: string | Types.ObjectId,
    doctorId?: string | Types.ObjectId,
  ) {
    // getOrCreate first, then update by _id. An upsert on idFilter's `$in`
    // filter cannot derive `patient` from the query, so it silently inserted a
    // conversation belonging to nobody.
    const conversation = await this.getOrCreate(patientId);
    return this.conversationModel
      .findByIdAndUpdate(
        conversation._id,
        doctorId
          ? { handoffAt: new Date(), handoffDoctor: doctorId }
          : { $unset: { handoffAt: '', handoffDoctor: '' } },
        { new: true },
      )
      .exec();
  }

  async listMessages(conversationId: string | Types.ObjectId) {
    const messages = await this.messageModel
      .find(idFilter('conversation', conversationId))
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return messages;
  }

  async findById(id: string | Types.ObjectId) {
    const conversation = await this.conversationModel.findById(id).exec();
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}
