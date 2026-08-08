import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';

type ContentPart = { type: string; text?: string; image_url?: { url: string } };
type Message = { role: string; content?: string | ContentPart[] };

/** Captures what was sent, and replies with whatever findings the test wants. */
function mockVision(reply: string) {
  const sent: Message[][] = [];
  const create = jest.fn(async ({ messages }: { messages: Message[] }) => {
    sent.push([...messages]);
    return { choices: [{ message: { content: reply } }] };
  });
  return { create, sent };
}

const FINDINGS = JSON.stringify({
  docType: 'lab-report',
  text: 'Haemoglobin 9.1 g/dL',
  summary: 'Low haemoglobin.',
  abnormalFindings: ['Low haemoglobin (9.1 g/dL)'],
  recommendations: ['Consult a doctor.'],
  confidence: 0.95,
  disclaimer: 'AI generated.',
});

describe('AiService.analyzeDocument', () => {
  let service: AiService;

  async function build(reply: string) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: string) => d ?? '' },
        },
      ],
    }).compile();
    service = module.get(AiService);
    const openai = mockVision(reply);
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create: openai.create } },
    };
    return openai;
  }

  // Pins the Phase 1 fix: a bare image with no text part can make the model
  // refuse, and a refusal parses to {} with no error thrown.
  it('sends both a text part and the image', async () => {
    const openai = await build(FINDINGS);
    await service.analyzeDocument(Buffer.from('fake-png'), 'image/png');

    const user = openai.sent[0].find((m) => m.role === 'user');
    const parts = user?.content as ContentPart[];
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    expect(parts.some((p) => p.type === 'image_url')).toBe(true);
  });

  // Pins the Phase 3 fix: MIME comes from multer, not from a filename guess.
  it('labels the image with the real MIME type it was given', async () => {
    const openai = await build(FINDINGS);
    await service.analyzeDocument(Buffer.from('fake'), 'image/webp');

    const user = openai.sent[0].find((m) => m.role === 'user');
    const parts = user?.content as ContentPart[];
    const image = parts.find((p) => p.type === 'image_url');
    expect(image?.image_url?.url.startsWith('data:image/webp;base64,')).toBe(
      true,
    );
  });

  it('parses findings even when the model wraps them in json fences', async () => {
    await build('```json\n' + FINDINGS + '\n```');
    const out = await service.analyzeDocument(Buffer.from('x'), 'image/png');
    expect(out.confidence).toBe(0.95);
  });

  it('returns empty findings when the model refuses instead of answering', async () => {
    await build("I'm unable to assist with that.");
    const out = await service.analyzeDocument(Buffer.from('x'), 'image/png');
    // No JSON in the reply, so extractJson yields '{}' — this is exactly the
    // silent failure DocumentsService.analyzeUpload now catches.
    expect(out.text).toBeUndefined();
    expect(out.confidence).toBeUndefined();
  });

  it('throws instead of calling the model when the image data is empty', async () => {
    const openai = await build(FINDINGS);

    await expect(
      service.analyzeDocument(Buffer.alloc(0), 'image/png'),
    ).rejects.toThrow(BadRequestException);

    expect(openai.create).not.toHaveBeenCalled();
  });
});