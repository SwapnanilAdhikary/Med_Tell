# The three features to focus on

**Thesis:** agentic health access for rural India, where smartphones are rare —
so a person must be able to **dial a normal phone number** and get triaged,
matched to a doctor, and told what to do, without an app, an account, or the
ability to read.

Everything below serves that. Pritha's document-analysis track
([WORK-PRITHA.md](WORK-PRITHA.md)) runs in parallel and is unaffected.
System map: [ARCHITECTURE.md](ARCHITECTURE.md).

> **This doc was rewritten.** The earlier version prioritised console features
> (prescription PDF downloads, doctor copilot) aimed at users who already have
> smartphones and accounts. Those are now the *later* tier — see §5.

---

## Why these three

Two facts, both verified in the code:

1. **An unregistered caller is silently discarded.** `CallsService.resolvePatient`
   does `findByPhone` → `null` → the call is logged and dropped. Our primary
   user — someone who has never touched a website — calls, talks, and nothing
   happens.
2. **The doctor match happens *after* hangup.** `processCompletedCall` runs on
   Vapi's `end-of-call-report`, so the agent cannot tell the caller which doctor
   will ring them. For a feature-phone user with no SMS and no app, **the spoken
   read-back is the only delivery channel there is.**

Fix those and the product exists for its target user. Don't, and it doesn't —
regardless of how good the prescription engine is.

**You do not need a phone number to build any of this.** The whole inbound path is
`POST /api/calls/vapi/webhook`; test it by POSTing payloads, the same way the
web-call pipeline was verified. A number is a demo-day concern (§4).

---

## F1. A phone call from a stranger becomes a patient

**The single most important change in the project.**

### What
An inbound call from an unknown number creates a patient from the caller ID, with
the name the agent collects during the conversation. A call from a *known* number
greets them by name and never asks again.

### Where
- `CallsService.resolvePatient` — currently returns `null` for unknown numbers
- `AuthService` has `register`, `login`, `findByPhone`, `patientIdForUser` — but
  **no phone-only create path.** You'll add one
- `User.passwordHash` is `@Prop({ required: true })`, so a phone-created account
  must supply something

### How
Add `AuthService.findOrCreatePatientByPhone(phone, name?)`:

- if a user exists for that phone → return their `patientId`
- else create `User { phone, role: 'patient', passwordHash: <random> }` +
  `Patient { name: name ?? 'Caller <last 4 digits>', language }`
- reuse the existing scrypt helper for the random hash — don't invent a second
  hashing path

Then `resolvePatient` calls it instead of giving up.

**Greeting a known caller by name** needs Vapi's `assistant-request` hook. On an
inbound call Vapi asks *our* server which assistant to use — we look up the caller
ID and return `variableValues` with their name, exactly like
`CallsService.getWebSession` already does for the browser. The type exists in the
SDK (`ServerMessageAssistantRequest`, `"assistant-request"`); **verify the exact
request/response shape against Vapi's docs before building.**

The phone assistant prompt then needs two branches: known caller → greet by name;
unknown → ask for a name once, and pass it to the create call.

### Known limitation to write down
A phone-created account has a random password and there is **no password-reset
flow**, so that user can't log into the web app. That's acceptable — they don't
have a smartphone. Leave a `// ponytail:` comment saying an OTP login is the
upgrade path.

### Done when
- POSTing a webhook payload with an unknown `phoneNumber` creates a patient,
  produces a triage summary, and matches a doctor
- A second call from the same number reuses the patient and greets by name
- No call is ever silently dropped — an unlinked call logs why

### Tests
`calls.service.spec.ts` (exists — extend it):
- unknown number → creates exactly one patient, and a **second** call creates none
- known number → reuses the existing patient
- name captured by the agent lands on the patient record
- `findOrCreatePatientByPhone` is never called for web calls (they arrive pre-linked)

---

## F2. The agent tells the caller the outcome, out loud, before hanging up

### What
Mid-call, once symptoms are known, the agent books the consultation, learns the
matched doctor, and **speaks it**: *"You've been matched with Dr. Rohan Mehta,
a cardiologist. He'll call you back on this number today. Until then, rest and
drink water."*

For a caller with no app and no SMS, this is the entire delivery mechanism.

### Where
- `AiService.tools()` and `ChatService.executeAction(patientId, name, args)` —
  **already exist and already return the matched doctor.** `book_consultation`
  returns `{ appointmentId, status, suggestedDoctor: { name, title, specialty } }`
- `processCompletedCall` stays, but demoted: it becomes the *record* of the call,
  not the mechanism that acts

### How
Give the phone assistant **the same tools the chat agent has**, served over the
Vapi server-tool webhook:

```
caller speaks → Vapi model decides to call book_consultation
   → POST /api/calls/vapi/webhook  { type: 'tool-calls', ... }
   → verify VAPI_WEB_SECRET  (see below — mandatory)
   → resolve patient from the call's phone number
   → ChatService.executeAction(patientId, name, args)   ← reuse as-is
   → return the result to Vapi
   → agent speaks the doctor's name
```

`executeAction` already takes `patientId` as its first argument, so it's reusable
without refactoring. Expose it (or a thin wrapper) and don't duplicate the switch.

**One agent brain, two channels.** Same tools for chat and phone means the phone
path inherits everything already built and tested.

### Security — not optional in this feature
`VAPI_WEB_SECRET` is currently sent *to* Vapi by `setup-vapi.ts` and **never
verified by the backend** — confirmed, it appears nowhere else in `src/`. The
webhook is unauthenticated and already creates appointments. Once it can *take
actions*, that's a hole you cannot ship.

Verify the secret on every webhook request and reject mismatches with 401. This is
part of F2, not a follow-up.

### Done when
- A simulated inbound conversation produces a booked appointment **during** the
  call, and the tool result contains the doctor's name
- The agent's closing line names the real matched doctor and the callback window
- The same flow works in Hindi and Bengali
- A webhook request with a wrong or missing secret is rejected

### Tests
- the tool webhook dispatches to `executeAction` and returns its real result
- a bad secret → 401, and **no** appointment is created
- an unknown tool name → a well-formed error the agent can speak, not a 500

---

## F3. Consent recorded on every consultation

### What
Every consultation records how consent was obtained, through which channel, and
when.

### Why
The Telemedicine Practice Guidelines: when the **patient** initiates, consent is
**implied**. When a health worker or another practitioner initiates, **explicit
consent is required and must be recorded in patient records.** Records — including
consent — must be retained **≥3 years**.

Since we descoped the health-worker flow, our calls are patient-initiated, so
consent is implied. **Don't oversell this as a consent gate** — it's a
record-keeping and audit feature. Said accurately it's still a strong beat,
because it shows we read the regulation.

### Where
- `Patient.consentGranted` exists in the schema and is **written by nothing** —
  verified, the only other mention in `src/` is a comment
- `Appointment.type` is hardcoded `'call-back'` in `book()`; `video` /`in-person`
  are declared and dead

### How
Record on the appointment, not just the patient — consent is per-consultation:

- `consentBasis: 'implied' | 'explicit'`
- `consentChannel: 'phone' | 'web'`
- `consentAt: Date`
- and stop hardcoding the mode: `mode: 'voice' | 'text'` reflecting the actual
  channel

Set `Patient.consentGranted` on first consult so the dead field starts living.

The mode matters beyond audit: if the prescription engine ever lands (§5), what a
doctor may legally prescribe depends on it.

### Done when
- Every appointment carries basis, channel, timestamp and real mode
- A phone consult records `phone` / `voice`; a chat consult records `web` / `text`
- Visible on the doctor's screen, so it's demonstrable

### Tests
- `book()` writes all four fields
- a phone-sourced booking records `phone`, a chat-sourced one records `web`
- first consult flips `Patient.consentGranted`

---

## 4. Demo-day checklist — not features, don't build these first

- [ ] **Deploy the backend publicly** (Railway / Render / Fly). Needed for both
      the inbound webhook and server tools. ngrok is the fallback — rehearse it.
- [ ] **Provision one Vapi number.** Not free: **$10 trial credit**, no free tier;
      ~$2/mo rental, ~$0.13–0.31/min all-in. A demo costs cents. **Take a US
      number** — non-US provisioning is widely reported as slow and pricier, and a
      real Indian +91 number needs KYC (and DLT registration for SMS) that won't
      land in a weekend. **Check your remaining credit — testing already spent
      some.**
- [ ] **"SMS that would be sent" panel** on screen, clearly labelled as simulated.
      No provider, no DLT. The spoken read-back is the real channel anyway, and
      for a caller who may not read, it's the *better* UX — say that out loud.
- [ ] Rehearse. Research is blunt that teams who stop coding early to rehearse
      beat teams with better code.

---

## 5. Later — the console tier

Real features, correctly ranked *below* the thesis. Full reasoning is in this
file's git history.

- **E-prescription + drug-list rules engine** (List O / A / B / Schedule X,
  mode-dependent). Still the strongest compliance story, and it reuses the
  certificates pipeline. Depends on F3's mode field. Just don't pretend a PDF
  download serves a feature phone — its real delivery would be spoken read-back or
  the pharmacy.
- **Doctor voice agent.** The Vapi web SDK supports client-side tools
  (`ClientMessageToolCalls` + `send()`), so the browser can execute with the
  doctor's own JWT and no tunnel. Rule: **voice for navigation and dictation, tap
  to commit** — never let a misheard dosage be the final action.
- **AI-drafted, doctor-edited notes.** `VerificationTask.doctorEdit` and status
  `'edited'` exist and are unused; the doctor can currently only approve or reject.
  Logging the AI-draft-vs-doctor-final diff is both the safety mechanism and the
  audit trail. Also replaces the `window.prompt()` in `CallBacks.tsx`.
- **Doctor's notes back into the AI's memory.** `complete()` stores `consultNotes`
  but never appends them to the patient's conversation, so the agent only sees them
  if it happens to call `get_my_records`. ~10 lines mirroring
  `CallsService.recordCallInConversation`. Cheap, and it closes the loop properly.
- **`assign()` race** — no status guard, two doctors can claim the same case.
  One-line fix, zero demo value, do it last.

---

## Sources

Regulatory: [Lexology — TPG 2020](https://www.lexology.com/library/detail.aspx?g=a1d76ffa-1853-4c7a-84e8-f8ef37d44525) ·
[PMC — telemedicine guidelines in India](https://pmc.ncbi.nlm.nih.gov/articles/PMC9111269/) ·
[NMC official FAQs (PDF)](https://www.nmc.org.in/MCIRest/open/getDocument?path=%2FDocuments%2FPublic%2FPortal%2FLatestNews%2FFinal_FAQ-TELEMEDICINE++6-4-2020..pdf) ·
[Legal Service India](https://www.legalserviceindia.com/legal/article-3450-the-telemedicine-practice-guidelines-2020.html)

Vapi cost: [Layer3Labs pricing breakdown](https://www.layer3labs.io/guides/vapi-pricing) ·
[CloudTalk — Vapi plans 2026](https://www.cloudtalk.io/blog/vapi-ai-pricing/)

Judging: [Devpost — judging criteria](https://info.devpost.com/blog/understanding-hackathon-submission-and-judging-criteria) ·
[HackerEarth — 2026](https://www.hackerearth.com/blog/hackathon-ideas)

> ⚠️ Drug-list specifics in §5 come from secondary legal analyses — the official
> MoHFW PDF wouldn't extract. Verify List A/B contents against the NMC FAQs before
> claiming compliance on stage. The architecture holds either way.
