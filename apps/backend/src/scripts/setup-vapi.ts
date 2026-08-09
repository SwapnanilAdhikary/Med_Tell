/**
 * Creates or updates a MedAssist voice assistant on Vapi.
 *
 * Two profiles, one script:
 *   npm run vapi:setup      --workspace @iem-hacks/backend   # patient triage
 *   npm run vapi:setup:asha --workspace @iem-hacks/backend   # ASHA field reporting
 *
 * Idempotent upsert per profile: each pins its own env var, and the script
 * refuses to PATCH an assistant whose name does not match the profile - without
 * that guard an --asha run would find VAPI_ASSISTANT_ID and overwrite the
 * shared patient assistant.
 *
 * Flags:
 *   --upsert-only   never POST a new assistant; fail if none exists to patch
 *   --no-write-env  print IDs only; do not touch apps/backend/.env (use in CI)
 *
 * Env used:
 *   VAPI_API_KEY             required - private API key from dashboard.vapi.ai
 *   VAPI_ASSISTANT_ID        pinned by the patient profile
 *   VAPI_ASHA_ASSISTANT_ID   pinned by the asha profile
 *   VAPI_WEB_SECRET          optional - webhook signing secret (phone calls)
 *   VAPI_WEBHOOK_URL         optional - public URL of /api/calls/vapi/webhook
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_BASE = 'https://api.vapi.ai';

interface VapiAssistant {
  id?: string;
  name?: string;
}

interface Profile {
  key: string;
  name: string;
  envKey: string;
  firstMessage: string;
  prompt: string;
}

const ASHA_PROMPT = `You are MedAssist Field Assistant. You are speaking to a trained government health worker who is out on a household visit. Speak warmly, plainly and briefly, the way a colleague would on a phone call.

WHO YOU ARE SPEAKING TO - this is the REPORTER, never the patient:
- Worker: {{workerName}}, cadre {{cadre}}
- Assigned area: {{village}}
- Their linked doctor: {{linkedDoctor}}
- Their nearest facility: {{linkedFacility}}

They are telling you about SOMEBODY ELSE. Never ask the worker about their own symptoms, and never address the sick person directly - they are probably not on the line.

LANGUAGE: The worker's language code is {{language}} (en = English, hi = Hindi, bn = Bengali). Speak that language throughout. If they switch, follow them.

YOU DRIVE THE CALL. You ask every question; the worker only answers. Ask ONE question at a time and wait for the answer. Never stack two questions together. Never ask them what they would like to do next, and never wait for them to volunteer information - if something on the list below is still missing, ask for it.

STEP ZERO - always your first question. Ask what kind of report this is, offering the three choices by name:
- "general" - a routine household or check-up finding
- "domain specific" - it belongs to one programme area. If they say this, ask which one (maternal or pregnancy, child or newborn, TB or chest, fever or outbreak, nutrition, mental health, or something else) and say that area out loud so it is captured.
- "emergency" - someone needs help right now
Take their answer, say it back in three or four words, then continue. If it is an emergency, jump straight to the EMERGENCY rule below.

Then collect, in this order:
1. Who is this about - their name, and roughly how old.
2. If the person is a woman between about twelve and fifty, ask whether she is pregnant, and if so roughly how many months.
3. A phone number for the household, IF they have one. Ask once, read it back digit by digit, and get a yes. If they say there is no number or they do not know it, say "that is fine" and move on immediately. NEVER press, and never refuse to continue without it.
4. What is wrong - the symptoms, and how many days.
5. Whether it is getting better, staying the same, or getting worse.
6. VITALS. Ask for each one BY NAME, one question per vital, in this order, and wait for a reply each time:
   a. temperature
   b. blood pressure (take both numbers together, upper over lower - that counts as one question)
   c. pulse
   d. oxygen saturation, SpO2
   e. breathing rate
   f. weight
   g. blood sugar
   For every one of them: if they say they did not measure it, did not have the device, or do not know, say "fine" and go straight to the next vital. Record nothing for it. NEVER suggest a number, NEVER offer a normal value, NEVER guess on their behalf, and NEVER ask them to estimate. If they say up front that they measured nothing at all, skip the rest of this list and move on.
7. Any danger signs they can see.
8. Their own judgement of how urgent this is: routine, semi-urgent, urgent, or emergency. Their judgement stands.

EMERGENCY RULE - applies whether they said "emergency" at step zero or a danger sign comes out later (unconscious, convulsing, heavy bleeding, unable to breathe, a baby who will not feed at all): stop the interview immediately. Tell them to call 108 for an ambulance right now. Capture only the name and, if known, the phone number, and end the call. Do not ask for vitals and do not work through the remaining questions.

Before you hang up, read the whole case back in two or three sentences and ask them to confirm it. Tell them {{linkedDoctor}} will see it and that the matched doctor will appear on their screen.

If they are NOT reporting on a person - a reminder to themselves, a supply or stock problem, a note about equipment - just take it down as a note, confirm it back, and end the call. Do not invent a patient.

Never diagnose. Never name or suggest a medicine. Never give a dose. One case per call.`;

const PATIENT_PROMPT = `You are MedAssist AI, a friendly medical triage assistant for an Indian healthcare platform. Speak in a warm, professional tone and keep responses short and spoken-friendly.

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

const PROFILES: Record<'patient' | 'asha', Profile> = {
  patient: {
    key: 'patient',
    name: 'MedAssist AI Triage Assistant',
    envKey: 'VAPI_ASSISTANT_ID',
    // Overridden per call by GET /api/calls/session with the patient's name.
    firstMessage:
      'Hello {{patientName}}, this is MedAssist. What symptoms are you experiencing today?',
    prompt: PATIENT_PROMPT,
  },
  asha: {
    key: 'asha',
    name: 'MedAssist Field Report Assistant',
    envKey: 'VAPI_ASHA_ASSISTANT_ID',
    // Overridden per call by GET /api/calls/session/field with the worker's name.
    firstMessage:
      'Namaste {{workerName}}, MedAssist here. What kind of report is this - general, domain specific, or an emergency?',
    prompt: ASHA_PROMPT,
  },
};

function buildAssistantPayload(profile: Profile) {
  const webhookUrl = process.env.VAPI_WEBHOOK_URL ?? '';
  const webSecret = process.env.VAPI_WEB_SECRET ?? '';

  // Only send `server` when there is a URL. Vapi's PATCH is a top-level merge,
  // so posting `{ secret }` with no `url` would wipe a url already configured
  // in the dashboard.
  const server = webhookUrl
    ? { url: webhookUrl, secret: webSecret || undefined }
    : undefined;
  if (!webhookUrl && webSecret) {
    console.warn(
      '[setup-vapi] VAPI_WEB_SECRET is set but VAPI_WEBHOOK_URL is not; leaving the server config untouched.',
    );
  }

  // Model/voice credentials come from the Vapi org (Bearer key / dashboard),
  // not nested on the assistant model. Use endCallPhrases (array), not a boolean flag.
  return {
    name: profile.name,
    firstMessage: profile.firstMessage,
    // The assistant opens the call. Vapi's default already does this, but the
    // whole flow depends on it, so pin it rather than inherit it.
    firstMessageMode: 'assistant-speaks-first',
    model: {
      provider: 'openai',
      model: 'gpt-4.1',
      temperature: 0.4,
      messages: [{ role: 'system', content: profile.prompt }],
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
    : // Default page size is 100; past that our target silently misses the
      // name match and we would POST a duplicate.
      `${API_BASE}/assistant?limit=1000`;
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

function upsertEnvAssistantId(envKey: string, assistantId: string) {
  if (process.argv.includes('--no-write-env')) {
    console.log(`[setup-vapi] ${envKey}=${assistantId} (not written — --no-write-env)`);
    return;
  }
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.warn(
      `[setup-vapi] No .env found at ${envPath}; not writing ${envKey}`,
    );
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const line = `${envKey}=${assistantId}`;
  // Anchored per line so VAPI_ASSISTANT_ID is never matched by a lookup for
  // VAPI_ASHA_ASSISTANT_ID or the reverse.
  const existing = new RegExp(`^${envKey}=.*$`, 'm');
  const updated = existing.test(content)
    ? content.replace(existing, line)
    : `${content.replace(/\n?$/, '\n')}${line}\n`;

  fs.writeFileSync(envPath, updated);
  console.log(`[setup-vapi] Wrote ${envKey}=${assistantId} to ${envPath}`);
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

  const profile = process.argv.includes('--asha')
    ? PROFILES.asha
    : PROFILES.patient;
  const upsertOnly = process.argv.includes('--upsert-only');
  console.log(
    `[setup-vapi] Profile "${profile.key}" -> assistant "${profile.name}", pinned by ${profile.envKey}${upsertOnly ? ' (upsert-only)' : ''}`,
  );

  // Each profile reads its OWN env key. Reading VAPI_ASSISTANT_ID here for the
  // asha profile is what would silently overwrite the shared patient assistant.
  const pinnedId = process.env[profile.envKey] ?? '';
  const listed = await api('GET', apiKey, undefined);
  if (!Array.isArray(listed)) {
    // Abort rather than fall through to POST, which would create a duplicate.
    throw new Error(
      `Expected an array from GET /assistant, got ${typeof listed}. Aborting rather than risk a duplicate.`,
    );
  }
  const assistants = listed as VapiAssistant[];

  const pinned = pinnedId
    ? assistants.find((a) => a.id === pinnedId)
    : undefined;
  if (pinnedId && !pinned) {
    // Previously this fell through to POST and created a duplicate.
    console.warn(
      `[setup-vapi] ${profile.envKey}=${pinnedId} is not on this account; matching by name instead.`,
    );
  }
  const existing = pinned ?? assistants.find((a) => a.name === profile.name);

  if (existing && existing.name !== profile.name) {
    throw new Error(
      `${profile.envKey} points at "${existing.name}" (${existing.id}), not ` +
        `"${profile.name}". Refusing to overwrite a different assistant. ` +
        `Clear ${profile.envKey} to create a new one.`,
    );
  }

  const payload = buildAssistantPayload(profile);

  if (existing?.id) {
    const updated = (await api(
      'PATCH',
      apiKey,
      existing.id,
      payload,
    )) as VapiAssistant;
    console.log(
      `[setup-vapi] Updated existing assistant "${updated.name ?? profile.name}" -> ${updated.id}`,
    );
    upsertEnvAssistantId(profile.envKey, updated.id!);
  } else if (upsertOnly) {
    console.error(
      `[setup-vapi] No assistant found for "${profile.name}" and --upsert-only is set. ` +
        `Create one in the Vapi dashboard first, then set ${profile.envKey}=<id> and re-run.`,
    );
    process.exit(1);
  } else {
    const created = (await api(
      'POST',
      apiKey,
      undefined,
      payload,
    )) as VapiAssistant;
    console.log(
      `[setup-vapi] Created assistant "${created.name ?? profile.name}" -> ${created.id}`,
    );
    upsertEnvAssistantId(profile.envKey, created.id!);
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
