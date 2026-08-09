import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  /**
   * Whether the worker was reporting a health concern about another person, or
   * just leaving themselves a memo. Coerced after parsing - never trusted raw.
   */
  kind: 'report' | 'note';
  noteTitle?: string | null;
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

/**
 * The hardcoded layer the model cannot undermine. Checked in TypeScript after
 * the council returns: a match gets a block flag regardless of what the
 * formulary checker said. The model's tpgList is decoration on top of this.
 */
export const PROHIBITED_STEMS = [
  'alprazolam',
  'diazepam',
  'lorazepam',
  'clonazepam',
  'nitrazepam',
  'zolpidem',
  'tramadol',
  'codeine',
  'morphine',
  'fentanyl',
  'pethidine',
  'oxycodone',
  'hydrocodone',
  'methylphenidate',
  'buprenorphine',
];

export interface CouncilPatient {
  name: string;
  language?: string;
  ageYears?: number | null;
  ageMonths?: number | null;
  gender?: string | null;
  pregnant?: boolean | null;
  pregnancyMonths?: number | null;
  allergies: string[];
  conditions: string[];
  medications: string[];
}

export interface PrescriptionCouncilInput {
  patient: CouncilPatient;
  consultMode: string;
  symptoms?: string[];
  vitals?: object;
  suspectedCondition?: string | null;
  duration?: string | null;
  urgency?: string | null;
  sourceSummary?: string | null;
}

export interface CouncilItem {
  name: string;
  dose?: string | null;
  frequency?: string | null;
  durationDays?: number | null;
  instructions?: string | null;
  tpgList?: 'O' | 'A' | 'B' | 'prohibited' | 'unclassified';
}

export interface CouncilFlag {
  severity: 'block' | 'warn' | 'info';
  role: 'prescriber' | 'safety' | 'formulary' | 'system';
  message: string;
  itemName?: string;
}

export interface PrescriptionCouncilResult {
  items: CouncilItem[];
  flags: CouncilFlag[];
  failedRoles: string[];
  advice?: string | null;
  followUp?: string | null;
  summary?: string | null;
}

const EMPTY_EXTRACTION: FieldReportExtraction = {
  // A worker who called the field line was almost certainly calling about a
  // person, so an unreadable reply must not demote their visit to a memo.
  kind: 'report',
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
  private readonly transcribeModel: string;

  constructor(config: ConfigService) {
    this.model = config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    this.visionModel = config.get<string>('OPENAI_VISION_MODEL', 'gpt-4o-mini');
    this.transcribeModel = config.get<string>(
      'OPENAI_TRANSCRIBE_MODEL',
      'whisper-1',
    );
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
    image: Buffer,
    mimeType: string,
    language = 'en',
  ): Promise<Record<string, unknown>> {
    if (!image?.length) {
      throw new BadRequestException(
        'The uploaded image was empty. Please try uploading it again.',
      );
    }
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
                type: 'text',
                text: 'Read this medical document and extract every value you can see. Respond with the JSON object described above.',
              },
              {
                type: 'image_url',
                image_url: { url: this.toDataUrl(image, mimeType) },
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

  /**
   * Reads a computer-generated PDF's text layer and analyses that text.
   * Scanned PDFs have no text layer — those return empty findings, which
   * DocumentsService turns into a "we couldn't read that" error.
   */
  async analyzePdf(
    pdf: Buffer,
    language = 'en',
  ): Promise<Record<string, unknown>> {
    const text = await this.extractPdfText(pdf);
    if (!text.trim()) return {};

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are a medical document analysis assistant. The text below was extracted from a medical PDF (lab report, prescription, or discharge summary).

Respond ONLY with a strict JSON object in this shape:
{
  "docType": "prescription | lab-report | scan/image | other",
  "text": "the raw text of the document",
  "summary": "plain-language summary in language code ${language}",
  "abnormalFindings": ["list of anything abnormal/unusual, empty if none"],
  "recommendations": ["suggestions for the patient in language ${language}"],
  "confidence": 0.0-1.0,
  "disclaimer": "This analysis was generated by AI and has NOT been verified by a doctor."
}
Be conservative. Never state a definitive diagnosis.`,
        },
        { role: 'user', content: text.slice(0, 20000) },
      ],
      temperature: 0.2,
    });

    const reply = completion.choices[0].message.content ?? '{}';
    return JSON.parse(this.extractJson(reply));
  }

  private async extractPdfText(pdf: Buffer): Promise<string> {
    // ponytail: text layer only — a scanned PDF is an image in a wrapper and
    // yields nothing. Rendering page 1 to an image needs a native canvas build.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(pdf),
      // no script execution from an untrusted PDF
      useSystemFonts: false,
    }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      );
    }

    await doc.cleanup();
    return pages.join('\n');
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
   * A real three-role panel. Two waves, not three in parallel: the checkers
   * must see the draft, so they can only run after the prescriber has produced
   * it. `Promise.allSettled`, not `Promise.all` - one failing checker must not
   * discard the other's result, so a checker outage degrades (a block flag +
   * a failedRoles entry) while a prescriber outage is fatal (no draft at all).
   */
  async draftPrescriptionCouncil(
    input: PrescriptionCouncilInput,
  ): Promise<PrescriptionCouncilResult> {
    const draft = await this.prescribe(input);

    const settled = await Promise.allSettled([
      this.reviewSafety(input, draft),
      this.reviewFormulary(input, draft),
    ]);
    const safety = settled[0] as PromiseSettledResult<CouncilFlag[]>;
    const formulary = settled[1] as PromiseSettledResult<
      Array<{ name: string; tpgList: string }>
    >;

    const flags: CouncilFlag[] = [];
    const failedRoles: string[] = [];
    const classifications: Array<{ name: string; tpgList?: string }> = [];

    if (safety.status === 'fulfilled') {
      flags.push(...safety.value);
    } else {
      failedRoles.push('safety');
      flags.push({
        severity: 'block',
        role: 'system',
        message: `Safety review failed: ${(safety.reason as Error).message}`,
      });
    }

    if (formulary.status === 'fulfilled') {
      classifications.push(...formulary.value);
    } else {
      failedRoles.push('formulary');
      flags.push({
        severity: 'block',
        role: 'system',
        message: `Formulary review failed: ${(formulary.reason as Error).message}`,
      });
    }

    // The merge does exactly three things: concat flags, stamp tpgList per item
    // (a missing verdict stays unclassified - never drop the item), and never
    // touch the items themselves. No disagreement can be silently dropped.
    const items = draft.items.map((item) => ({
      ...item,
      tpgList: this.verdictFor(item.name, classifications),
    }));
    flags.push(...this.denyListFlags(items));

    return {
      items,
      flags,
      failedRoles,
      advice: draft.advice ?? null,
      followUp: draft.followUp ?? null,
      summary: draft.summary ?? null,
    };
  }

  /** Wave 1. Prescriber failure is fatal: there is no draft to review. */
  private async prescribe(
    input: PrescriptionCouncilInput,
  ): Promise<{ items: CouncilItem[]; advice?: string; followUp?: string; summary?: string }> {
    const patient = input.patient;
    const parsed = await this.councilJson(
      `You are the prescribing physician on a three-member AI council drafting a prescription for a patient assessed by an ASHA/ANM health worker. You produce the draft; a safety pharmacist and a formulary pharmacist then review it. This is a ${input.consultMode} consult - there was no in-person examination.

PATIENT:
${JSON.stringify({
  name: patient.name,
  language: patient.language ?? 'en',
  ageYears: patient.ageYears,
  ageMonths: patient.ageMonths,
  gender: patient.gender,
  pregnant: patient.pregnant,
  pregnancyMonths: patient.pregnancyMonths,
  allergies: patient.allergies,
  conditions: patient.conditions,
  medications: patient.medications,
})}

CLINICAL PICTURE:
${JSON.stringify({
  symptoms: input.symptoms ?? [],
  vitals: input.vitals ?? {},
  suspectedCondition: input.suspectedCondition ?? null,
  duration: input.duration ?? null,
  urgency: input.urgency ?? null,
  sourceSummary: input.sourceSummary ?? null,
})}

RULES:
- International non-proprietary (INN) generic names only.
- No controlled substances, no injectables.
- At most 5 items.
- For a first remote consult, durationDays must be 5 or fewer.
- Always include supportive care (ORS, fluids, rest) when appropriate.
- If the case is beyond safe remote management, return "items": [].
Respond with JSON only:
{"items": [{"name": "INN generic", "dose": "500 mg", "frequency": "1 tab 3x daily", "durationDays": 5, "instructions": "after food"}], "advice": "care advice for the patient", "followUp": "when and how to re-contact", "summary": "one-line clinical rationale"}`,
      {
        symptoms: input.symptoms ?? [],
        vitals: input.vitals ?? {},
        suspectedCondition: input.suspectedCondition ?? null,
        duration: input.duration ?? null,
        urgency: input.urgency ?? null,
        sourceSummary: input.sourceSummary ?? null,
      },
      0.2,
    );

    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items: CouncilItem[] = rawItems
      .filter(
        (i): i is Record<string, unknown> =>
          !!i && typeof i === 'object' && typeof (i as { name?: unknown }).name === 'string',
      )
      .map((i) => ({
        name: i.name as string,
        dose: typeof i.dose === 'string' ? i.dose : null,
        frequency: typeof i.frequency === 'string' ? i.frequency : null,
        durationDays: typeof i.durationDays === 'number' ? i.durationDays : null,
        instructions: typeof i.instructions === 'string' ? i.instructions : null,
      }));

    return {
      items,
      advice: typeof parsed.advice === 'string' ? parsed.advice : undefined,
      followUp: typeof parsed.followUp === 'string' ? parsed.followUp : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    };
  }

  /** Wave 2, role 1. Emits flags only - never edits an item. */
  private async reviewSafety(
    input: PrescriptionCouncilInput,
    draft: { items: CouncilItem[] },
  ): Promise<CouncilFlag[]> {
    const patient = input.patient;
    const parsed = await this.councilJson(
      `You are the safety pharmacist on a three-member AI council. Review the prescribing physician's draft for safety. You emit FLAGS ONLY - you never edit, add, remove or reorder any item.

PATIENT:
${JSON.stringify({
  ageYears: patient.ageYears,
  ageMonths: patient.ageMonths,
  gender: patient.gender,
  pregnant: patient.pregnant,
  pregnancyMonths: patient.pregnancyMonths,
  allergies: patient.allergies,
  conditions: patient.conditions,
  medications: patient.medications,
})}

CHECKS:
1. Allergy cross-reaction at CLASS level (penicillin -> amoxicillin, sulfa -> cotrimoxazole, the whole NSAID class, ...).
2. Interactions with the patient's current medications AND within the draft itself.
3. Age appropriateness (aspirin under 16 - Reye's, tetracyclines under 8, fluoroquinolones in children).
4. Pregnancy - an UNRECORDED pregnancy status in a woman 12-50 is itself a warn flag.
Respond with JSON only:
{"flags": [{"severity": "block | warn | info", "itemName": "the drug name if the flag concerns one item, else null", "message": "specific, actionable text"}]}`,
      { draft: draft.items, consultMode: input.consultMode },
      0.1,
    );

    const rawFlags = Array.isArray(parsed.flags) ? parsed.flags : [];
    return rawFlags
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({
        severity: this.flagSeverity(f.severity),
        role: 'safety' as const,
        message: typeof f.message === 'string' ? f.message : 'Safety flag',
        itemName: typeof f.itemName === 'string' ? f.itemName : undefined,
      }));
  }

  /** Wave 2, role 2. Classifies each drug for the recorded consult mode. */
  private async reviewFormulary(
    input: PrescriptionCouncilInput,
    draft: { items: CouncilItem[] },
  ): Promise<Array<{ name: string; tpgList: string }>> {
    const parsed = await this.councilJson(
      `You are the formulary pharmacist on a three-member AI council. Classify each drug in the prescribing physician's draft under the national Schedule O/A/B list for the recorded consult mode (${input.consultMode}). You emit classifications ONLY - you never edit an item.
If you are not certain how a drug is classified, output "unclassified". Do not guess a list.
Respond with JSON only:
{"classifications": [{"name": "drug name", "tpgList": "O | A | B | prohibited | unclassified"}]}`,
      { draft: draft.items, consultMode: input.consultMode },
      0.1,
    );

    const raw = Array.isArray(parsed.classifications) ? parsed.classifications : [];
    return raw
      .filter(
        (c): c is Record<string, unknown> =>
          !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string',
      )
      .map((c) => ({
        name: c.name as string,
        tpgList:
          typeof c.tpgList === 'string' &&
          ['O', 'A', 'B', 'prohibited', 'unclassified'].includes(c.tpgList)
            ? c.tpgList
            : 'unclassified',
      }));
  }

  /**
   * TypeScript, after the council. A prohibited stem gets a block flag no
   * matter what the formulary checker said - this is the layer we demo, test
   * and defend; the model's tpgList is decoration on top of it.
   */
  private denyListFlags(items: CouncilItem[]): CouncilFlag[] {
    const flags: CouncilFlag[] = [];
    for (const item of items) {
      const stem = item.name.toLowerCase().replace(/[^a-z]/g, '');
      if (PROHIBITED_STEMS.some((p) => stem === p || stem.startsWith(p))) {
        flags.push({
          severity: 'block',
          role: 'system',
          message: `${item.name} is on the prohibited list and can never be prescribed, whatever the formulary classified it as.`,
          itemName: item.name,
        });
      }
    }
    return flags;
  }

  private verdictFor(
    name: string,
    classifications: Array<{ name: string; tpgList?: string }>,
  ): CouncilItem['tpgList'] {
    const wanted = name.toLowerCase().replace(/[^a-z]/g, '');
    const hit = classifications.find(
      (c) => c.name.toLowerCase().replace(/[^a-z]/g, '') === wanted,
    );
    return hit?.tpgList as CouncilItem['tpgList'];
  }

  private flagSeverity(v: unknown): 'block' | 'warn' | 'info' {
    return v === 'block' || v === 'warn' || v === 'info' ? v : 'warn';
  }

  /**
   * A single guarded JSON round for the council. Throws on unparseable output:
   * the prescriber call propagates (fatal); the checker calls ride on
   * Promise.allSettled, so a bad minute degrades instead of killing the draft.
   */
  private async councilJson(
    system: string,
    user: unknown,
    temperature: number,
  ): Promise<Record<string, unknown>> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(user) },
        ],
        temperature,
      });
      const text = completion.choices[0].message.content ?? '';
      // Deliberately stricter than extractJson: that helper maps missing JSON to
      // '{}', which would silently mask a role's prose refusal. Here a refusal
      // must register as a failure so it degrades (or kills) the council.
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error('no JSON object in reply');
      }
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('council reply was not an object');
      }
      return parsed;
    } catch (error) {
      throw new Error(
        `Council role returned invalid JSON: ${(error as Error).message}`,
      );
    }
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
  "kind": "report | note",
  "noteTitle": null,
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
- "kind" is "report" when the worker described a health concern about a SPECIFIC OTHER PERSON. It is "note" only when the recording is a memo to themselves - a reminder, a supply or stock problem, broken equipment, a scheduling thought - with no sick person in it. When in doubt, choose "report".
- "noteTitle" is a short title of at most eight words, and only when kind is "note".
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
    return this.coerceKind(this.parseJson(text, EMPTY_EXTRACTION));
  }

  /**
   * The classification is a safety decision, so it is never trusted as parsed:
   * `{...fallback, ...parsed}` lets a literal `"kind": null` overwrite the
   * default, and a clinical emergency must reach a doctor whatever the model
   * decided to call it.
   */
  private coerceKind(e: FieldReportExtraction): FieldReportExtraction {
    const urgent = e.urgency === 'urgent' || e.urgency === 'emergency';
    const kind =
      e.kind === 'note' && !urgent && (e.dangerSigns ?? []).length === 0
        ? 'note'
        : 'report';
    if (kind === 'report' && e.kind === 'note') {
      this.logger.warn(
        'Overriding a "note" classification: danger signs or urgency present.',
      );
    }
    return { ...e, kind };
  }

  /**
   * Speech to text for a worker's voice note. The transcript goes back to the
   * browser for the worker to read and correct before anything is filed - a
   * misheard vital must never reach a doctor unchallenged.
   */
  async transcribeAudio(filePath: string, language?: string): Promise<string> {
    const result = await this.client.audio.transcriptions.create({
      model: this.transcribeModel,
      file: fs.createReadStream(filePath),
      // Whisper guesses badly on short Indic clips; naming the language helps.
      ...(language ? { language } : {}),
    });
    return result.text ?? '';
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

  //private toDataUrl(path: string): string {
  // const mime = path.endsWith('.png')
  //  ? 'image/png'
  //  : path.endsWith('.jpg') || path.endsWith('.jpeg')
  //  ? 'image/jpeg'
  // : 'image/jpeg';
  // const base64 = fs.readFileSync(path).toString('base64');
  //   return `data:${mime};base64,${base64}`;
  //}

  private toDataUrl(image: Buffer, mimeType: string): string {
    // MIME comes from multer's file.mimetype, not a filename guess — that's
    // what fixes .heic photos being mislabelled as JPEG.
    return `data:${mimeType};base64,${image.toString('base64')}`;
  }
}
