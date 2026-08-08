import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import OpenAI from 'openai';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface PatientContext {
  name: string;
  language: string;
  allergies?: string[];
  conditions?: string[];
  medications?: string[];
}

export interface AgentResult {
  reply: string;
  actions: ToolExecution[];
}

export interface FieldReportSubject {
  name?: string | null;
  phone?: string | null;
  ageYears?: number | null;
  ageMonths?: number | null;
  gender?: string | null;
  pregnant?: boolean | null;
  pregnancyMonths?: number | null;
}

export interface FieldReportExtraction {
  subject: FieldReportSubject;
  symptoms: string[];
  duration?: string | null;
  trend?: string | null;
  vitals: Record<string, number | null>;
  dangerSigns: string[];
  urgency?: string | null;
  redFlags: string[];
  suspectedCondition?: string | null;
  suggestedSpecialty?: string | null;
  summary?: string | null;
  reporterNotes?: string | null;
  confidence?: number | null;
}

export interface FieldReportInput {
  rawText: string;
  worker?: { name?: string; cadre?: string; village?: string };
  /** Typed form fields. The model fills blanks; it never overrides these. */
  known?: Record<string, unknown>;
}

const EMPTY_EXTRACTION: FieldReportExtraction = {
  subject: {},
  symptoms: [],
  vitals: {},
  dangerSigns: [],
  redFlags: [],
};

export interface ToolExecution {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

/**
 * Runs a tool for real and returns what actually happened, so the model can
 * tell the patient the truth (appointment id, matched doctor, or the failure).
 */
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly visionModel: string;

  constructor(config: ConfigService) {
    this.model = config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    this.visionModel = config.get<string>('OPENAI_VISION_MODEL', 'gpt-4o-mini');
    this.client = new OpenAI({
      apiKey: config.get<string>('OPENAI_API_KEY', '') || 'sk-placeholder',
    });
  }

  private tools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'book_consultation',
          description:
            'Book an asynchronous consultation. The patient will be called back by a doctor at a preferred time window.',
          parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description: 'Short reason or symptoms summary',
              },
              preferredWindow: {
                type: 'string',
                description: 'e.g. tomorrow morning, today evening',
              },
              bestContactNumber: {
                type: 'string',
                description: 'Phone number for call-back',
              },
              specialty: {
                type: 'string',
                description: 'Suggested specialty if relevant',
              },
            },
            required: ['reason'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'request_certificate',
          description:
            'Request a medical certificate draft (sick leave, fitness, medical, insurance) that a doctor must verify before issuance.',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['sick-leave', 'fitness', 'medical', 'insurance'],
              },
              language: { type: 'string', enum: ['en', 'hi', 'bn'] },
              details: {
                type: 'object',
                description: 'Reason, number of days, dates, purpose',
              },
            },
            required: ['type'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'emergency',
          description:
            'Patient reports a potentially life-threatening emergency (chest pain, stroke signs, severe bleeding, unconsciousness, suicidal thoughts). Route to emergency help immediately.',
          parameters: {
            type: 'object',
            properties: {
              concern: { type: 'string' },
            },
            required: ['concern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'set_language',
          description: 'Switch conversation language.',
          parameters: {
            type: 'object',
            properties: {
              language: { type: 'string', enum: ['en', 'hi', 'bn'] },
            },
            required: ['language'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_my_records',
          description:
            "Look up this patient's own consultations, medical certificates and uploaded documents with their current status and assigned doctor. Use this before answering any question about what has already been booked, requested, issued or reviewed - never guess.",
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'find_doctor',
          description:
            'Look up verified doctors on the platform, optionally filtered by specialty. Use this when the patient asks who is available or which specialist fits their symptoms.',
          parameters: {
            type: 'object',
            properties: {
              specialty: {
                type: 'string',
                description: 'e.g. Cardiology, Pediatrics, General Medicine',
              },
            },
          },
        },
      },
    ];
  }

  buildSystemPrompt(context: PatientContext): string {
    return `You are MedAssist AI, a professional medical assistant helping patients and their families. You are warm, clear, and never alarming.

CONTEXT ABOUT PATIENT:
- Name: ${context.name}
- Preferred language: ${context.language}
- Known allergies: ${(context.allergies ?? []).join(', ') || 'none recorded'}
- Known conditions: ${(context.conditions ?? []).join(', ') || 'none recorded'}
- Current medications: ${(context.medications ?? []).join(', ') || 'none recorded'}

RULES:
1. Respond in the patient's preferred language. If language is 'hi', reply in Hindi; if 'bn', reply in Bengali; otherwise English. Use simple words and short sentences.
2. You are NOT a doctor and cannot diagnose. You give general health information and lifestyle recommendations only.
3. ALWAYS include a brief disclaimer when giving health advice: "This is general guidance, not a medical diagnosis."
4. If the patient describes an emergency (chest pain, difficulty breathing, stroke symptoms, severe bleeding, unconsciousness, suicidal thoughts) do NOT reassure and book appointments. Call the emergency tool IMMEDIATELY and tell them to call 112 (or 108 for an ambulance) right away.
5. Offer to book an asynchronous consultation when a patient describes symptoms, wants a checkup, or asks to see a doctor. Use the book_consultation tool. Always pass a \`specialty\` that fits the symptoms (e.g. Cardiology for chest pain, Pediatrics for a child) so the case reaches the right doctor.
6. Offer to create a medical certificate when asked (sick leave, fitness, insurance letter). Use request_certificate.
7. Recommend over-the-counter remedies, hydration, rest, and healthy habits where safe and general.
8. Be concise. Ask one question at a time if you need more details.
9. Use the emergency tool only for true emergencies, never for scheduling.
10. TOOL RESULTS ARE THE TRUTH. Every tool returns what actually happened. After book_consultation, if the result has a \`suggestedDoctor\`, name that doctor and their specialty to the patient ("You've been matched with Dr. X (Cardiology); they will confirm and call you back"). If a result contains an \`error\`, apologise and say the action did not go through - never claim success.
11. Never invent appointment details, doctor names, dates or statuses. Call get_my_records and answer from what it returns.`;
  }

  async runAgent(
    context: PatientContext,
    history: ChatTurn[],
    userText: string,
    execute: ToolExecutor,
  ): Promise<AgentResult> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: this.buildSystemPrompt(context) },
      ...history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: userText },
    ];

    const executed: ToolExecution[] = [];
    let reply = '';

    // 4 rounds so the model can read (get_my_records) before it acts.
    for (let round = 0; round < 4; round++) {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: this.tools(),
        tool_choice: 'auto',
        temperature: 0.4,
      });

      const choice = completion.choices[0];
      const message = choice.message;

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        reply = message.content ?? '';
        break;
      }

      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls:
          toolCalls as unknown as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam['tool_calls'],
      });

      for (const call of toolCalls) {
        if (!('function' in call)) continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        const name = call.function.name ?? 'unknown';

        let result: Record<string, unknown>;
        try {
          result = await execute(name, args);
        } catch (error) {
          this.logger.error(`Tool ${name} failed`, error as Error);
          result = {
            error: error instanceof Error ? error.message : String(error),
          };
        }

        executed.push({ name, args, result });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return { reply, actions: executed };
  }

  async analyzeDocument(
    imagePath: string,
    language = 'en',
  ): Promise<Record<string, unknown>> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.visionModel,
        messages: [
          {
            role: 'system',
            content: `You are a medical document analysis assistant. Read the uploaded medical document/image carefully (lab report, prescription, scan, or image of a medical record).

Respond ONLY with a strict JSON object in this shape:
{
  "docType": "prescription | lab-report | scan/image | other",
  "text": "raw text you can read",
  "summary": "plain-language summary in language code ${language}",
  "abnormalFindings": ["list of anything abnormal/unusual, empty if none"],
  "recommendations": ["suggestions for the patient in language ${language}"],
  "confidence": 0.0-1.0,
  "disclaimer": "This analysis was generated by AI and has NOT been verified by a doctor."
}
Be conservative. Never state a definitive diagnosis.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: this.toDataUrl(imagePath) },
              },
            ],
          },
        ],
        temperature: 0.2,
      });

      const text = completion.choices[0].message.content ?? '{}';
      return JSON.parse(this.extractJson(text));
    } catch (error) {
      this.logger.error('Vision analysis failed', error as Error);
      throw error;
    }
  }

  async summarizeCall(
    transcriptText: string,
    language = 'en',
  ): Promise<Record<string, unknown>> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `Summarize this medical call transcript into structured JSON:
{
  "summary": "2-3 sentence summary in language ${language}",
  "symptoms": ["..."],
  "urgency": "routine | semi-urgent | urgent | emergency",
  "recommendedAction": "book_consultation | self_care | emergency | certificate",
  "suggestedSpecialty": "the single medical specialty best suited to these symptoms, e.g. Cardiology, Pediatrics, Dermatology, General Medicine",
  "keyFacts": ["..."],
  "requestedCertificate": null | {"type": "sick-leave | fitness | medical | insurance", "reason": "..."}
}
Respond with JSON only.`,
        },
        { role: 'user', content: transcriptText.slice(0, 20000) },
      ],
      temperature: 0.2,
    });
    const text = completion.choices[0].message.content ?? '{}';
    return JSON.parse(this.extractJson(text));
  }

  async draftCertificate(
    type: string,
    language: string,
    details: Record<string, unknown>,
    patientName: string,
  ): Promise<Record<string, unknown>> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `Draft a professional medical certificate of type "${type}" for patient "${patientName}" in language ${language}. Details: ${JSON.stringify(details)}.
Respond with strict JSON: {"title": "...", "body": "full certificate text", "validFrom": "YYYY-MM-DD", "validTo": "YYYY-MM-DD", "notes": "..."}`,
        },
      ],
      temperature: 0.3,
    });
    const text = completion.choices[0].message.content ?? '{}';
    return JSON.parse(this.extractJson(text));
  }

  /**
   * A sibling to summarizeCall, not a parameterisation of it: that shape has
   * three consumers and pinning tests, and this one reports on someone else.
   */
  async extractFieldReport(
    input: FieldReportInput,
    language = 'en',
  ): Promise<FieldReportExtraction> {
    const worker = input.worker;
    const completion = await this.client.chat.completions.create({
      model: this.model,
      // json_object needs the word JSON in the prompt, which it has.
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are structuring a household health report filed by ${
            worker?.name ?? 'an ASHA/ANM health worker'
          }${worker?.cadre ? ` (${worker.cadre})` : ''}${
            worker?.village ? ` in the village of ${worker.village}` : ''
          }. The worker is reporting on ANOTHER PERSON, not themselves.

Already recorded by the worker (treat as fact, do not contradict):
${JSON.stringify(input.known ?? {})}

Return JSON with exactly this shape:
{
  "subject": {"name": null, "phone": null, "ageYears": null, "ageMonths": null, "gender": null, "pregnant": null, "pregnancyMonths": null},
  "symptoms": ["..."],
  "duration": null,
  "trend": "improving | stable | worsening",
  "vitals": {"temperatureC": null, "spo2": null, "systolic": null, "diastolic": null, "pulse": null, "respRate": null, "weightKg": null, "glucoseMgDl": null},
  "dangerSigns": ["..."],
  "urgency": "routine | semi-urgent | urgent | emergency",
  "redFlags": ["..."],
  "suspectedCondition": null,
  "suggestedSpecialty": "the single medical specialty best suited, e.g. Cardiology, Pediatrics, Obstetrics, General Medicine",
  "summary": "2-3 sentences in language ${language}",
  "reporterNotes": "anything the worker said that a doctor should read verbatim",
  "confidence": 0.0
}

Rules:
- NEVER invent a vital sign. Only record a number the worker actually measured or stated. null beats a guess.
- Phone numbers as digits only, no spaces or punctuation.
- You may ESCALATE the worker's own urgency judgement, never downgrade it. They are standing there and you are not.
- Do not diagnose and do not name any medicine.
Respond with JSON only.`,
        },
        { role: 'user', content: input.rawText.slice(0, 20000) },
      ],
      temperature: 0.2,
    });

    const text = completion.choices[0].message.content ?? '{}';
    return this.parseJson(text, EMPTY_EXTRACTION);
  }

  /**
   * Scoped to extractFieldReport: a worker standing in a village must not lose
   * a report because the model replied in prose.
   */
  private parseJson<T extends object>(text: string, fallback: T): T {
    try {
      return { ...fallback, ...(JSON.parse(this.extractJson(text)) as T) };
    } catch (error) {
      this.logger.warn(
        `Model returned unparseable JSON, using fallback: ${(error as Error).message}`,
      );
      return fallback;
    }
  }

  private extractJson(text: string): string {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : '{}';
  }

  private toDataUrl(path: string): string {
    const mime = path.endsWith('.png')
      ? 'image/png'
      : path.endsWith('.jpg') || path.endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/jpeg';
    const base64 = fs.readFileSync(path).toString('base64');
    return `data:${mime};base64,${base64}`;
  }
}
