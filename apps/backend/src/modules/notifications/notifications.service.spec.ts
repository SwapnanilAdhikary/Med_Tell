import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotificationsService } from './notifications.service';
import { AppNotification } from './schemas/notification.schema';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

function makeQueryChain(result: unknown) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;

  const notificationModel = {
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getModelToken(AppNotification.name),
          useValue: notificationModel,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('create', () => {
    it('persists a notification with defaults', async () => {
      notificationModel.create.mockResolvedValue({ _id: 'n-1' });

      await service.create({ user: 'user-1', title: 'Appointment confirmed' });

      expect(notificationModel.create).toHaveBeenCalledWith({
        user: 'user-1',
        title: 'Appointment confirmed',
        body: '',
        type: 'system',
        ref: undefined,
      });
    });
  });

  describe('listForUser', () => {
    it('returns the most recent notifications for the user', async () => {
      const chain = makeQueryChain([{ _id: 'n-1', title: 'hi' }]);
      notificationModel.find.mockReturnValue(chain);

      const list = await service.listForUser('user-1');

      expect(notificationModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({ $in: expect.any(Array) }),
        }),
      );
      expect(list).toHaveLength(1);
    });
  });

  describe('unreadCount', () => {
    it('counts unread notifications only', async () => {
      notificationModel.countDocuments.mockResolvedValue(3);

      const count = await service.unreadCount('user-1');

      expect(notificationModel.countDocuments).toHaveBeenCalledWith({
        user: expect.objectContaining({ $in: expect.any(Array) }),
        read: false,
      });
      expect(count).toBe(3);
    });
  });

  describe('markRead', () => {
    it('marks a single notification read, scoped to the user', async () => {
      const chain = {
        exec: jest.fn().mockResolvedValue({ _id: 'n-1', read: true }),
      };
      notificationModel.findOneAndUpdate.mockReturnValue(chain);

      const result = await service.markRead('user-1', 'n-1');

      expect(notificationModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: 'n-1',
          user: expect.objectContaining({ $in: expect.any(Array) }),
        },
        { read: true, readAt: expect.any(Date) },
        { new: true },
      );
      expect(result!.read).toBe(true);
    });
  });

  describe('markAllRead', () => {
    it('bulk-updates unread notifications for the user', async () => {
      const chain = { exec: jest.fn().mockResolvedValue({ modifiedCount: 2 }) };
      notificationModel.updateMany.mockReturnValue(chain);

      const result = await service.markAllRead('user-1');

      expect(notificationModel.updateMany).toHaveBeenCalledWith(
        {
          user: expect.objectContaining({ $in: expect.any(Array) }),
          read: false,
        },
        { read: true, readAt: expect.any(Date) },
      );
      expect(result.modifiedCount).toBe(2);
    });
  });
});
