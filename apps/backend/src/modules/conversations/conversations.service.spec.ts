import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConversationsService } from './conversations.service';
import { Conversation } from './schemas/conversation.schema';
import { Message } from './schemas/message.schema';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

function makeQueryChain(result: unknown) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  };
}

function makeFindOneChain(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('ConversationsService', () => {
  let service: ConversationsService;

  const conversationModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  };
  const messageModel = {
    find: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        {
          provide: getModelToken(Conversation.name),
          useValue: conversationModel,
        },
        { provide: getModelToken(Message.name), useValue: messageModel },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  describe('getOrCreate', () => {
    it('returns the existing conversation when present', async () => {
      const existing = { _id: 'conv-1', patient: 'patient-1' };
      conversationModel.findOne.mockReturnValue(makeFindOneChain(existing));

      const conversation = await service.getOrCreate('patient-1');

      expect(conversation).toBe(existing);
      expect(conversationModel.create).not.toHaveBeenCalled();
    });

    it('creates a conversation when none exists', async () => {
      conversationModel.findOne.mockReturnValue(makeFindOneChain(null));
      conversationModel.create.mockResolvedValue({
        _id: 'conv-1',
        patient: 'patient-1',
      });

      const conversation = await service.getOrCreate('patient-1');

      expect(conversationModel.create).toHaveBeenCalledWith({
        patient: 'patient-1',
      });
      expect(conversation._id).toBe('conv-1');
    });

    it('handles duplicate key race condition gracefully', async () => {
      const existing = { _id: 'conv-1', patient: 'pat-1' };
      conversationModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      conversationModel.create.mockRejectedValue({ code: 11000 }); // duplicate key
      conversationModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      conversationModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(existing) });

      const result = await service.getOrCreate('pat-1');
      expect(result).toBe(existing);
    });
  });

  describe('setLanguage', () => {
    it('updates the conversation language', async () => {
      const chain = {
        exec: jest.fn().mockResolvedValue({ _id: 'conv-1', language: 'hi' }),
      };
      conversationModel.findOneAndUpdate.mockReturnValue(chain);

      const conversation = await service.setLanguage('patient-1', 'hi');

      expect(conversationModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          patient: expect.objectContaining({ $in: expect.any(Array) }),
        }),
        { language: 'hi' },
        { new: true },
      );
      expect(conversation!.language).toBe('hi');
    });
  });

  describe('addMessage', () => {
    it('persists the message and bumps lastActivity', async () => {
      const message = {
        _id: 'msg-1',
        conversation: 'conv-1',
        role: 'user',
        content: 'hello',
      };
      messageModel.create.mockResolvedValue(message);
      const chain = { exec: jest.fn().mockResolvedValue({}) };
      conversationModel.findByIdAndUpdate.mockReturnValue(chain);

      const result = await service.addMessage('conv-1', 'user', 'hello');

      expect(messageModel.create).toHaveBeenCalledWith({
        conversation: 'conv-1',
        role: 'user',
        content: 'hello',
        attachments: [],
        metadata: undefined,
      });
      expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'conv-1',
        { lastActivity: expect.any(Date) },
      );
      expect(result._id).toBe('msg-1');
    });
  });

  describe('history', () => {
    it('returns user/assistant messages in chronological order', async () => {
      const raw = [
        { role: 'assistant', content: 'how can I help' },
        { role: 'system', content: 'meta' },
        { role: 'user', content: 'headache' },
      ];
      messageModel.find.mockReturnValue(makeQueryChain(raw));

      const history = await service.history('conv-1');

      expect(history).toEqual([
        { role: 'user', content: 'headache' },
        { role: 'assistant', content: 'how can I help' },
      ]);
    });
  });
});
