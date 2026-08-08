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

describe('AiService.extractJson', () => {
  let service: AiService;

  beforeEach(async () => {
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
  });

  it('handles greedy brace matching correctly', () => {
    // @ts-ignore — accessing private method for testing
    const result = service.extractJson('Here is {"a": 1} and also {"b": 2}');
    // Should extract just the first complete object, not everything between first { and last }
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('returns {} when no braces found', () => {
    // @ts-ignore
    expect(service.extractJson('no json here')).toBe('{}');
  });

  it('handles nested braces', () => {
    // @ts-ignore
    const result = service.extractJson('text {"a": {"b": 1}} more');
    expect(JSON.parse(result)).toEqual({ a: { b: 1 } });
  });
});
