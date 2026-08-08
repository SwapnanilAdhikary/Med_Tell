import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AppNotification,
  NotificationType,
} from './schemas/notification.schema';
import { idFilter } from '../../common/mongoose.util';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(AppNotification.name)
    private readonly notificationModel: Model<AppNotification>,
  ) {}

  async create(input: {
    user: string | Types.ObjectId;
    title: string;
    body?: string;
    type?: NotificationType;
    ref?: Record<string, unknown>;
  }) {
    return this.notificationModel.create({
      user: input.user,
      title: input.title,
      body: input.body ?? '',
      type: input.type ?? 'system',
      ref: input.ref,
    });
  }

  async listForUser(userId: string | Types.ObjectId, limit = 50) {
    return this.notificationModel
      .find(idFilter('user', userId))
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async unreadCount(userId: string | Types.ObjectId): Promise<number> {
    return this.notificationModel.countDocuments({
      ...idFilter('user', userId),
      read: false,
    });
  }

  async markRead(userId: string | Types.ObjectId, id: string) {
    return this.notificationModel
      .findOneAndUpdate(
        { _id: id, ...idFilter('user', userId) },
        { read: true, readAt: new Date() },
        { new: true },
      )
      .exec();
  }

  async markAllRead(userId: string | Types.ObjectId) {
    return this.notificationModel
      .updateMany(
        { ...idFilter('user', userId), read: false },
        { read: true, readAt: new Date() },
      )
      .exec();
  }
}
