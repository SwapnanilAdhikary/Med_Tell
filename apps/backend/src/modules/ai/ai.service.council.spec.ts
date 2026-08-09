import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import type { PrescriptionCouncilInput } from './ai.service';

type Message = { role: string; content?: string };

/**
 * A council-scoped client, unlike ai.service.spec.ts's round-counting script:
 * `create` dispatches on the system message to return each role's canned reply.
 * `sent` captures every request so we can assert the checkers saw the draft.
 */
function mockCouncil(replies: {
  prescriber: string;
  safety: string;
  formulary: string;
}) {
  const sent: Message[][] = [];
  const create = jest.fn(
    async (req: { messages: Message[] } & Record<string, unknown>) => {
      sent.push([...req.messages]);
      const system = req.messages[0].content ?? '';
      let content: string;
      if (system.startsWith('You are the prescribing physician')) {
        content = replies.prescriber;
      } else if (system.startsWith('You are the safety pharmacist')) {
        content = replies.safety;
      } else {
        content = replies.formulary;
      }
      return { choices: [{ message: { content } }] };
    },
  );
  return { create, sent };
}

const baseInput = (): PrescriptionCouncilInput => ({
  patient: {
    name: 'Sita Devi',
    language: 'bn',
    ageYears: 34,
    gender: 'female',
    allergies: [],
    conditions: [],
    medications: [],
  },
  consultMode: 'teleconsult',
  symptoms: ['fever', 'loose motions'],
});

function happyReplies() {
  return {
    prescriber: JSON.stringify({
      items: [
        {
          name: 'Paracetamol',
          dose: '500 mg',
          frequency: '1 tab 3x daily',
          durationDays: 5,
          instructions: 'after food',
        },
      ],
      advice: 'Drink ORS and rest.',
      followUp: 'Re-contact if fever persists beyond 3 days.',
      summary: 'Simple gastroenteritis.',
    }),
    safety: JSON.stringify({
      flags: [{ severity: 'info', itemName: null, message: 'No safety issues.' }],
    }),
    formulary: JSON.stringify({
      classifications: [
        { name: 'Paracetamol', tpgList: 'A' },
      ],
    }),
  };
}

describe('AiService.draftPrescriptionCouncil', () => {
  let service: AiService;
  let openai: ReturnType<typeof mockCouncil>;

  async function build(replies = happyReplies()) {
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
    openai = mockCouncil(replies);
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create: openai.create } },
    };
  }

  const call = (systemPrefix: string) =>
    openai.sent.find((c) => (c[0].content ?? '').startsWith(systemPrefix));

  const request = (systemPrefix: string) =>
    (openai.create.mock.calls as Array<[Record<string, unknown>]>).find(
      ([req]) =>
        ((req.messages as Message[])[0].content ?? '').startsWith(systemPrefix),
    )![0];

  const userContent = (systemPrefix: string) =>
    JSON.parse(call(systemPrefix)![1].content!) as Record<string, unknown>;

  it('asks each role for a JSON object response', async () => {
    await build();
    await service.draftPrescriptionCouncil(baseInput());

    expect(openai.sent).toHaveLength(3);
    for (const prefix of [
      'You are the prescribing physician',
      'You are the safety pharmacist',
      'You are the formulary pharmacist',
    ]) {
      expect(request(prefix).response_format).toEqual({ type: 'json_object' });
    }
  });

  it('runs two waves: the checkers see the prescriber’s draft', async () => {
    await build();
    await service.draftPrescriptionCouncil(baseInput());

    const safetyDraft = userContent('You are the safety pharmacist');
    const formularyDraft = userContent('You are the formulary pharmacist');
    expect((safetyDraft.draft as Array<{ name: string }>)[0].name).toBe(
      'Paracetamol',
    );
    expect((formularyDraft.draft as Array<{ name: string }>)[0].name).toBe(
      'Paracetamol',
    );
  });

  it('returns the merged items with the formulary verdict stamped', async () => {
    await build();
    const result = await service.draftPrescriptionCouncil(baseInput());

    expect(result.items[0]).toMatchObject({
      name: 'Paracetamol',
      tpgList: 'A',
      durationDays: 5,
    });
    expect(result.advice).toBe('Drink ORS and rest.');
    expect(result.failedRoles).toEqual([]);
  });

  it('passes a safety block flag through verbatim and leaves items unchanged', async () => {
    await build({
      ...happyReplies(),
      safety: JSON.stringify({
        flags: [
          {
            severity: 'block',
            itemName: 'Paracetamol',
            message: 'Patient reports a severe NSAID allergy',
          },
        ],
      }),
    });

    const result = await service.draftPrescriptionCouncil(baseInput());

    expect(result.flags).toContainEqual({
      severity: 'block',
      role: 'safety',
      itemName: 'Paracetamol',
      message: 'Patient reports a severe NSAID allergy',
    });
    // A flag never edits an item.
    expect(result.items[0].name).toBe('Paracetamol');
    expect(result.items[0].dose).toBe('500 mg');
  });

  it('degrades when the formulary rejects: items stay, failedRoles + system block flag', async () => {
    await build({
      ...happyReplies(),
      formulary: 'I am sorry, I cannot do that.',
    });

    const result = await service.draftPrescriptionCouncil(baseInput());

    expect(result.items[0].name).toBe('Paracetamol');
    expect(result.failedRoles).toEqual(['formulary']);
    expect(result.flags).toContainEqual(
      expect.objectContaining({ severity: 'block', role: 'system' }),
    );
  });

  it('degrades when a checker returns malformed JSON instead of throwing', async () => {
    await build({
      ...happyReplies(),
      safety: '{"flags": ["trunca',
    });

    const result = await service.draftPrescriptionCouncil(baseInput());

    expect(result.items[0].name).toBe('Paracetamol');
    expect(result.failedRoles).toContain('safety');
    expect(result.flags).toContainEqual(
      expect.objectContaining({ severity: 'block', role: 'system' }),
    );
  });

  it('is fatal when the prescriber rejects - there is no draft to review', async () => {
    await build({ ...happyReplies(), prescriber: 'I cannot draft that.' });

    await expect(
      service.draftPrescriptionCouncil(baseInput()),
    ).rejects.toThrow(/invalid JSON/);
  });

  it('blocks a deny-listed drug even when the formulary says List O', async () => {
    await build({
      prescriber: JSON.stringify({
        items: [
          { name: 'Alprazolam', dose: '0.25 mg', frequency: '1 tab at bedtime' },
        ],
      }),
      safety: JSON.stringify({ flags: [] }),
      formulary: JSON.stringify({
        classifications: [{ name: 'Alprazolam', tpgList: 'O' }],
      }),
    });

    const result = await service.draftPrescriptionCouncil(baseInput());

    // The formulary's verdict is respected for the list label...
    expect(result.items[0].tpgList).toBe('O');
    // ...but the hardcoded layer overrides it with a block flag.
    expect(result.flags).toContainEqual(
      expect.objectContaining({
        severity: 'block',
        role: 'system',
        itemName: 'Alprazolam',
      }),
    );
  });
});
