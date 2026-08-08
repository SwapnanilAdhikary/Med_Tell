import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';
import { Message, AttachmentRef } from './schemas/message.schema';
import { idFilter } from '../../common/mongoose.util';

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
    if (!conversation) {
      conversation = await this.conversationModel.create({
        patient: patientId,
      });
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
        content: m.content,
      }));
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
