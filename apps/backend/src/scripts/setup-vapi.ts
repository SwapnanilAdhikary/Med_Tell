/**
 * Creates or updates the MedAssist AI voice-triage assistant on Vapi.
 *
 * Idempotent upsert: lists existing assistants, matches by name, and either
 * PATCHes the existing one or POSTs a new one. On success the assistant ID is
 * written back to the backend `.env` as VAPI_ASSISTANT_ID so the app can start
 * browser calls immediately.
 *
 * Run with: npm run vapi:setup --workspace @iem-hacks/backend
 *
 * Env used:
 *   VAPI_API_KEY        required - private API key from dashboard.vapi.ai
 *   VAPI_ASSISTANT_ID   optional - if set, that assistant is updated directly
 *   VAPI_WEB_SECRET     optional - webhook signing secret (phone calls)
 *   VAPI_WEBHOOK_URL    optional - public URL of /api/calls/vapi/webhook (phone calls)
 *                                  e.g. https://<your-tunnel>/api/calls/vapi/webhook
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_BASE = 'https://api.vapi.ai';
const ASSISTANT_NAME = 'MedAssist AI Triage Assistant';

interface VapiAssistant {
  id?: string;
  name?: string;
}

const SYSTEM_PROMPT = `You are MedAssist AI, a friendly medical triage assistant for an Indian healthcare platform. Speak in a warm, professional tone and keep responses short and spoken-friendly.

WHO YOU ARE SPEAKING TO - you already know this caller, so never ask for their name:
- Name: {{patientName}}
- Known allergies: {{knownAllergies}}
- Known conditions: {{knownConditions}}
- Current medications: {{medications}}

Greet {{patientName}} by name. Use their known conditions, allergies and medications to ask sharper follow-up questions, and never ask them to repeat information listed above.

LANGUAGE: The caller's selected language code is {{language}} (en = English, hi = Hindi, bn = Bengali). Always respond in that language. If the caller switches to another language, follow them.

Your job is to briefly triage the caller:
1. Ask what symptoms they are experiencing and for how long.
2. Ask how severe it is and whether it feels like an emergency.
3. Ask whether they need a medical certificate (sick leave, fitness, insurance) while you have them.
4. If the caller reports a life-threatening emergency (e.g. severe chest pain, trouble breathing, heavy bleeding, unconsciousness), tell them to call 112 (or 108 for an ambulance) or go to the nearest hospital immediately.
5. Otherwise, reassure them and tell them their case is being sent to the most suitable doctor, who will call them back. Name the kind of specialist you think fits (for example "a cardiologist" for chest pain) so it is captured in the call notes.

Before ending, read back a one-line recap: the main symptom, how urgent it seems, and the specialty you are routing them to.

Never diagnose or prescribe medicines. Do not ask for payment or for personal details beyond what is needed for triage.`;

function buildAssistantPayload() {
  const webhookUrl = process.env.VAPI_WEBHOOK_URL ?? '';
  const webSecret = process.env.VAPI_WEB_SECRET ?? '';

  const server =
    webhookUrl || webSecret
      ? {
          url: webhookUrl || undefined,
          secret: webSecret || undefined,
        }
      : undefined;

  // Model/voice credentials come from the Vapi org (Bearer key / dashboard),
  // not nested on the assistant model. Use endCallPhrases (array), not a boolean flag.
  return {
    name: ASSISTANT_NAME,
    // Overridden per-call by GET /api/calls/session with the patient's name.
    firstMessage:
      'Hello {{patientName}}, this is MedAssist. What symptoms are you experiencing today?',
    model: {
      provider: 'openai',
      model: 'gpt-4.1',
      temperature: 0.4,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }],
    },
    voice: {
      provider: 'vapi',
      voiceId: 'Elliot',
      version: 2,
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-3',
      language: 'multi',
    },
    silenceTimeoutSeconds: 30,
    endCallPhrases: ['goodbye', 'have a nice day', 'take care'],
    server,
  };
}

async function api(
  method: 'GET' | 'POST' | 'PATCH',
  token: string,
  assistantId: string | undefined,
  body?: unknown,
): Promise<unknown> {
  const url = assistantId
    ? `${API_BASE}/assistant/${assistantId}`
    : `${API_BASE}/assistant`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Vapi API ${method} ${url} failed (${response.status}): ${detail}`,
    );
  }

  return response.json();
}

function upsertEnvAssistantId(assistantId: string) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.warn(
      `[setup-vapi] No .env found at ${envPath}; not writing VAPI_ASSISTANT_ID`,
    );
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const line = `VAPI_ASSISTANT_ID=${assistantId}`;
  const updated = content.includes('VAPI_ASSISTANT_ID=')
    ? content.replace(/^VAPI_ASSISTANT_ID=.*$/m, line)
    : `${content.replace(/\n?$/, '\n')}${line}\n`;

  fs.writeFileSync(envPath, updated);
  console.log(
    `[setup-vapi] Wrote VAPI_ASSISTANT_ID=${assistantId} to ${envPath}`,
  );
}

async function run() {
  const apiKey = process.env.VAPI_API_KEY ?? '';
  if (!apiKey) {
    console.error(
      '[setup-vapi] VAPI_API_KEY is not set. Add it to apps/backend/.env first ' +
        '(get it from dashboard.vapi.ai > Accounts).',
    );
    process.exit(1);
  }

  const pinnedId = process.env.VAPI_ASSISTANT_ID ?? '';
  const assistants = (await api('GET', apiKey, undefined)) as VapiAssistant[];

  const existing = pinnedId
    ? assistants.find((a) => a.id === pinnedId)
    : assistants.find((a) => a.name === ASSISTANT_NAME);

  const payload = buildAssistantPayload();

  if (existing?.id) {
    const updated = (await api(
      'PATCH',
      apiKey,
      existing.id,
      payload,
    )) as VapiAssistant;
    console.log(
      `[setup-vapi] Updated existing assistant "${updated.name ?? ASSISTANT_NAME}" -> ${updated.id}`,
    );
    upsertEnvAssistantId(updated.id!);
  } else {
    const created = (await api(
      'POST',
      apiKey,
      undefined,
      payload,
    )) as VapiAssistant;
    console.log(
      `[setup-vapi] Created assistant "${created.name ?? ASSISTANT_NAME}" -> ${created.id}`,
    );
    upsertEnvAssistantId(created.id!);
  }

  console.log(
    '[setup-vapi] Done. Browser calls now work if VITE_VAPI_PUBLIC_KEY is set in apps/frontend/.env.',
  );
  if (!process.env.VAPI_WEBHOOK_URL) {
    console.log(
      '[setup-vapi] Note: for phone calls, set VAPI_WEBHOOK_URL to your public URL of /api/calls/vapi/webhook and run this again.',
    );
  }
}

run().catch((error) => {
  console.error(
    '[setup-vapi] Failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
