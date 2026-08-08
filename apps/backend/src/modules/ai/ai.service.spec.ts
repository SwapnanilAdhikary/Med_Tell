import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';

type Message = { role: string; content?: string; tool_call_id?: string };

/**
 * Scripts the OpenAI client: the first response calls a tool, the second replies
 * in text. `sent` captures the message list of each request so we can assert
 * what the model was actually told about the tool's outcome.
 */
function mockOpenAI(toolName: string) {
  const sent: Message[][] = [];
  let round = 0;

  const create = jest.fn(async ({ messages }: { messages: Message[] }) => {
    sent.push([...messages]);
    round += 1;
    if (round === 1) {
      return {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: toolName,
                    arguments: JSON.stringify({ reason: 'chest pain' }),
                  },
                },
              ],
            },
          },
        ],
      };
    }
    return { choices: [{ message: { content: 'Done.', tool_calls: [] } }] };
  });

  return { create, sent };
}

function toolMessageOf(sent: Message[][]): Message | undefined {
  return sent.at(-1)?.find((m) => m.role === 'tool');
}

describe('AiService.runAgent', () => {
  let service: AiService;
  let openai: ReturnType<typeof mockOpenAI>;

  async function build(toolName = 'book_consultation') {
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
    openai = mockOpenAI(toolName);
    // Swap the real client for the scripted one.
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create: openai.create } },
    };
  }

  const context = { name: 'Priya Sharma', language: 'en' };

  it('runs the tool the model asked for, with its parsed arguments', async () => {
    await build();
    const execute = jest.fn().mockResolvedValue({ appointmentId: 'a1' });

    await service.runAgent(context, [], 'my chest hurts', execute);

    expect(execute).toHaveBeenCalledWith('book_consultation', {
      reason: 'chest pain',
    });
  });

  it("feeds the tool's real result back to the model", async () => {
    await build();
    const result = {
      appointmentId: 'a1',
      suggestedDoctor: { name: 'Rohan Mehta', specialty: 'Cardiology' },
    };

    const agent = await service.runAgent(
      context,
      [],
      'my chest hurts',
      jest.fn().mockResolvedValue(result),
    );

    // The model must see the matched doctor, not a canned {status:'ok'}.
    expect(JSON.parse(toolMessageOf(openai.sent)!.content!)).toEqual(result);
    expect(agent.actions[0].result).toEqual(result);
    expect(agent.reply).toBe('Done.');
  });

  it('reports a failed tool as an error instead of claiming success', async () => {
    await build();

    const agent = await service.runAgent(
      context,
      [],
      'my chest hurts',
      jest.fn().mockRejectedValue(new Error('doctor roster empty')),
    );

    expect(JSON.parse(toolMessageOf(openai.sent)!.content!)).toEqual({
      error: 'doctor roster empty',
    });
    expect(agent.actions[0].result).toEqual({ error: 'doctor roster empty' });
  });

  it('puts the patient name and language in the system prompt', async () => {
    await build();
    await service.runAgent(
      { name: 'Meera Das', language: 'bn', conditions: ['asthma'] },
      [],
      'hello',
      jest.fn().mockResolvedValue({}),
    );

    const system = openai.sent[0][0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('Meera Das');
    expect(system.content).toContain('asthma');
  });
});

describe('AiService.extractFieldReport', () => {
  let service: AiService;
  let create: jest.Mock;

  /** A single-shot client, unlike runAgent's round-counting script. */
  async function build(content: string) {
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
    create = jest
      .fn()
      .mockResolvedValue({ choices: [{ message: { content } }] });
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create } },
    };
  }

  const request = () =>
    (create.mock.calls as Array<[Record<string, unknown>]>)[0][0];
  const systemPrompt = () =>
    (request().messages as Array<{ content: string }>)[0].content;

  it('puts the worker, cadre and village in the system prompt', async () => {
    await build('{}');

    await service.extractFieldReport({
      rawText: 'fever three days',
      worker: { name: 'Anjali Roy', cadre: 'ASHA', village: 'Beldanga' },
    });

    expect(systemPrompt()).toContain('Anjali Roy');
    expect(systemPrompt()).toContain('ASHA');
    expect(systemPrompt()).toContain('Beldanga');
    expect(systemPrompt()).toContain('ANOTHER PERSON');
  });

  it('shows the model what the worker already typed', async () => {
    await build('{}');

    await service.extractFieldReport({
      rawText: 'fever',
      known: { name: 'Sita Devi', phone: '+919555512345' },
    });

    expect(systemPrompt()).toContain('Sita Devi');
    expect(systemPrompt()).toContain('+919555512345');
  });

  it('forbids downgrading the worker judgement and inventing vitals', async () => {
    await build('{}');
    await service.extractFieldReport({ rawText: 'fever' });
    expect(systemPrompt()).toContain('never downgrade');
    expect(systemPrompt()).toContain('NEVER invent a vital');
  });

  it('asks for a JSON object response', async () => {
    await build('{}');
    await service.extractFieldReport({ rawText: 'fever' });
    expect(request().response_format).toEqual({ type: 'json_object' });
    expect(systemPrompt()).toContain('JSON');
  });

  it('parses a well-formed reply', async () => {
    await build(
      JSON.stringify({
        subject: { name: 'Sita Devi', ageYears: 34 },
        symptoms: ['fever', 'cough'],
        urgency: 'urgent',
      }),
    );

    const result = await service.extractFieldReport({ rawText: 'fever' });

    expect(result.symptoms).toEqual(['fever', 'cough']);
    expect(result.urgency).toBe('urgent');
    expect(result.subject.name).toBe('Sita Devi');
    // Keys the model omitted still come back in their empty form.
    expect(result.vitals).toEqual({});
    expect(result.dangerSigns).toEqual([]);
  });

  it('returns the fallback for a prose reply instead of throwing', async () => {
    await build('I am sorry, I cannot help with that request.');

    const result = await service.extractFieldReport({ rawText: 'fever' });

    expect(result).toEqual({
      subject: {},
      symptoms: [],
      vitals: {},
      dangerSigns: [],
      redFlags: [],
    });
  });

  it('returns the fallback for truncated JSON instead of throwing', async () => {
    await build('{"symptoms": ["fever", "cou');

    const result = await service.extractFieldReport({ rawText: 'fever' });

    expect(result.symptoms).toEqual([]);
  });

  it('pulls JSON out of a fenced code block', async () => {
    await build('Here you go:\n```json\n{"symptoms":["fever"]}\n```');

    const result = await service.extractFieldReport({ rawText: 'fever' });

    expect(result.symptoms).toEqual(['fever']);
  });
});
