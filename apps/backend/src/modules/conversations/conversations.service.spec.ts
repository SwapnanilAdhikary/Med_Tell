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

    it('prefixes a doctor-authored message so the model knows who spoke', async () => {
      // The role stays 'assistant' - OpenAI has no 'doctor' role, and history()
      // filters to user/assistant, so a new role would be silently dropped.
      messageModel.find.mockReturnValue(
        makeQueryChain([
          {
            role: 'assistant',
            content: 'Stop the ibuprofen and come in tomorrow.',
            metadata: { author: 'doctor', doctorName: 'Kavita Ghosh' },
          },
        ]),
      );

      expect(await service.history('conv-1')).toEqual([
        {
          role: 'assistant',
          content:
            '[Dr. Kavita Ghosh]: Stop the ibuprofen and come in tomorrow.',
        },
      ]);
    });

    it('leaves an ordinary assistant message untouched', async () => {
      messageModel.find.mockReturnValue(
        makeQueryChain([
          { role: 'assistant', content: 'plain', metadata: { actions: [] } },
        ]),
      );

      expect(await service.history('conv-1')).toEqual([
        { role: 'assistant', content: 'plain' },
      ]);
    });
  });

  describe('setHandoff', () => {
    function existing() {
      conversationModel.findOne.mockReturnValue(
        makeFindOneChain({ _id: 'conv-1' }),
      );
      conversationModel.findByIdAndUpdate.mockReturnValue(
        makeFindOneChain({ _id: 'conv-1' }),
      );
    }

    it('stamps the doctor and the time when taking over', async () => {
      existing();

      await service.setHandoff('patient-1', 'doctor-1');

      const [id, update] = conversationModel.findByIdAndUpdate.mock.calls[0];
      expect(id).toBe('conv-1');
      expect(update.handoffDoctor).toBe('doctor-1');
      expect(update.handoffAt).toBeInstanceOf(Date);
    });

    it('unsets both fields on release, so handoffAt is falsy again', async () => {
      existing();

      await service.setHandoff('patient-1');

      expect(conversationModel.findByIdAndUpdate.mock.calls[0][1]).toEqual({
        $unset: { handoffAt: '', handoffDoctor: '' },
      });
    });

    it('creates the conversation rather than upserting on an $in filter', async () => {
      // An upsert keyed on idFilter's `$in` cannot derive `patient`, and wrote a
      // conversation belonging to nobody.
      conversationModel.findOne.mockReturnValue(makeFindOneChain(null));
      conversationModel.create.mockResolvedValue({ _id: 'conv-new' });
      conversationModel.findByIdAndUpdate.mockReturnValue(
        makeFindOneChain({ _id: 'conv-new' }),
      );

      await service.setHandoff('patient-1', 'doctor-1');

      expect(conversationModel.create).toHaveBeenCalledWith({
        patient: 'patient-1',
      });
      expect(conversationModel.findByIdAndUpdate.mock.calls[0][0]).toBe(
        'conv-new',
      );
    });
  });
});
