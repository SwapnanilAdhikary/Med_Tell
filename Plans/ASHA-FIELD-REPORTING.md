# ASHA/ANM field reporting → AI council prescription → phone delivery

## Context

MedAssist has exactly two personas: a patient who talks about themself, and a doctor who
verifies AI output. Every clinical write derives its subject from `user.patientId` — there
is **no concept of acting on behalf of someone else**.

That caps the product at "telemedicine app". The volume in Indian rural health runs through
~1M ASHA and ANM workers who visit households, take vitals, and are the only link between a
village and a doctor. One worker reports on dozens of people. Serving *them* is what turns
this into a data layer: structured clinical events at village scale, geo-tagged, with a
licensed doctor in the only path that can issue.

**The flow:** worker reports by voice or form → structured extraction + geo-tag → nearest
facility + best-matched doctor → for simple illness an AI council drafts a prescription the
doctor verifies and signs → delivered to the patient's phone. Complex cases escalate to
doctor↔patient chat or an in-person referral.

Where the repo already has a mechanism, we reuse it. Several fields that are declared and
dead today — `Appointment.type: 'in-person'`, `VerificationTask.doctorEdit`, status
`'edited'`, `Patient.consentGranted` — get their first real writer here.

---

## Decisions taken

| Decision | Choice |
|---|---|
| Villager identity | **Shadow user by phone** — `User{phone, random scrypt hash}` + `Patient`. Same helper F1 needs. |
| Geo source | Worker's **assigned village/block/district** (seeded) + **browser GPS** on web. Voice always falls back to assigned. |
| AI council | **Real 3-role panel.** Checkers emit *flags only*, never edit items. |
| Delivery | **Pluggable `OutboundService`**, `simulated` by default. |
| `FieldReport` | **Its own collection** — vitals + geo + reporter/subject don't fit `Appointment`. |
| `Prescription` | **Its own collection**, not a `Certificate` type (PR 7 argues it). |

### On SMS, since you asked for the fastest

Real +91 A2P SMS is **blocked at carrier level** without TRAI DLT registration (entity +
header + content template). Weeks. The documented carve-out is OTP traffic only.

- **`whatsapp` (Twilio Sandbox) is the fast path** — recipient sends `join <code>` once,
  then a 24h window allows free-form text. No template approval, no number provisioning.
  Caveats: join expires after 3 days, 1 msg / 3 s, and `MediaUrl` must be publicly
  fetchable — so we send **text by default**, PDF only when `PUBLIC_BASE_URL` is set.
- **`voice` (Vapi outbound)** is DLT-free, works on a feature phone, and fits a patient who
  may not read. Needs a provisioned `VAPI_PHONE_NUMBER_ID` (~$2/mo).
- **`sms` (Twilio)** ships but is documented as non-functional for +91 until DLT lands.

---

## PR map

```
PR 0  pdf + seed hygiene ──────────────────────────────┐
PR 1  health_worker role + shadow patients ──┬─────┐   │
PR 2  role-aware frontend shell ─────────────┘     │   │
PR 3  facilities + geo matching ───────────────────┤   │
                                                   ▼   │
PR 4  field reports: schema, extraction, capture ──┬───┤
                                                   │   │
PR 5  worker screens (frontend) ◄──────────────────┤   │
PR 6  voice capture for workers ◄──────────────────┘   │
                                                       ▼
PR 7  prescription + AI council ───────────────────────┐
PR 8  doctor verify · edit · sign ◄────────────────────┘
      ├── PR 9   outbound delivery
      └── PR 10  escalation (chat handoff + referral)
```

| PR | Scope | Depends | Demoable at merge |
|---|---|---|---|
| 0 | PDF + seed hygiene | — | Nothing new (fixes a live crash) |
| 1 | `health_worker` role, shadow patients | — | **Ships F1** — unknown callers stop being dropped |
| 2 | Role-aware frontend shell | — | **Ships gap #9** — admin redirect loop fixed |
| 3 | Facilities + geo-aware matching | — | Proximity changes which doctor is matched |
| 4 | Field reports (backend) | 1, 3 | `POST /api/field-reports` works via curl |
| 5 | Worker screens | 2, 4 | **Full web capture, end to end** |
| 6 | Voice capture | 4 | A worker can phone in a report |
| 7 | Prescription + AI council | 0, 4 | Council draft visible in the DB |
| 8 | Doctor verify · edit · sign | 7 | **Signed PDF prescription, end to end** |
| 9 | Outbound delivery | 8 | Real WhatsApp message lands |
| 10 | Escalation | 8 | Doctor↔patient chat, in-person referral |

PRs 0–3 are independent of each other and can run in parallel. 5 and 6 are independent of
each other. 9 and 10 are independent of each other.

**Acceptance bar for every PR: all 58 existing tests pass unchanged.** If one needs
editing, a shared path was touched and the design is wrong.

---

# PR 0 — PDF and seed hygiene

Small, pure prep. No feature. Merge first so it's bisectable.

### Why now: this is a live crash, not prep

`StandardFonts.Helvetica` is WinAnsi-encoded. `page.drawText('प्रिया शर्मा')` **throws**
`WinAnsi cannot encode` — it does not degrade. So today, a patient with a Devanagari name
makes `buildPdf` reject → `issue()` reject → `applyDecision` throw → the certificate task
stays `pending` and the doctor gets a 500. Reachable from seeded-adjacent data. It's
ARCHITECTURE gap #4, and PR 7 would inherit it.

### Changes

**New `apps/backend/src/common/pdf.util.ts`:**
- `winAnsiSafe(s: string): string` — ~8 lines, strips/transliterates every codepoint > 0xFF.
- `drawWrappedText(...)` — a **pure relocation** from `certificates.service.ts:283-319`. It
  already takes `page` and `font` as arguments and touches no class state.

> **Leave `certificates.service.ts` untouched.** Its private copy keeps working, and another
> dev may be in that file. PR 7 uses the shared util; adopting it in certificates is a
> separate optional commit.

**`.gitignore`** — has `apps/backend/certificates/` but **not** `apps/backend/prescriptions/`.
Add it now, before the first signed PDF commits PHI.

**`scripts/seed.ts`:**
- `registrationNumber` on every doctor (`'WBMC-2019-0001'` etc.). PR 8 guards on it and the
  demo bricks without it. **Fix the seed, do not soften the guard** — the guard is the legal point.
- `languages` on every doctor — currently unseeded, which makes `findBestMatch`'s language
  tie-break **completely inert today**. Use the values already in
  [doctors.service.spec.ts:10-14](../apps/backend/src/modules/doctors/doctors.service.spec.ts#L10).
  This unblocks an existing feature for free.
- A self-heal `updateOne`, mirroring the existing `verified` one at L327-331 — the `findOne`
  guard means a re-run won't otherwise backfill an existing DB.

### Tests
`common/pdf.util.spec.ts` — `winAnsiSafe('प्रिया शर्मा')` has no codepoint > 0xFF; ASCII is untouched.

### Done when
Seeded doctors carry a reg number and languages; a Devanagari string survives `winAnsiSafe`.

---

# PR 1 — The `health_worker` role + shadow patients

Backend only. **Independently ships FEATURES.md F1.**

### Role plumbing — six additive edits

| File | Change |
|---|---|
| [user.schema.ts:4,21](../apps/backend/src/modules/auth/schemas/user.schema.ts) | `'health_worker'` in **both** the union and the Mongoose enum |
| [auth.controller.ts:21](../apps/backend/src/modules/auth/auth.controller.ts#L21) | `@IsIn([...,'health_worker'])` + a nested `RegisterWorkerDto` |
| [auth.service.ts:47,81](../apps/backend/src/modules/auth/auth.service.ts#L47) | Third branch in `register()`; `buildSession()` emits a `workerId` claim |
| [jwt-auth.guard.ts:11,35](../apps/backend/src/common/guards/jwt-auth.guard.ts#L11) | `AuthUser.workerId?` **and read it off the payload** |

New `modules/health-workers/` — `HealthWorker` schema (`user` ref required+unique, `name`,
`cadre: 'ASHA'|'ANM'`, `workerCode?`, flat `village/block/district/state`,
`coordinates?: [lng,lat]`, `languages[]`, `assignedFacility?`, `active`) and a three-method
service copying `DoctorsService`: `findByUser` (via `idFilter`), `findById`, `create`.

`RolesGuard` and `roles.decorator.ts` need **zero** changes — `roles.includes(...)` is
already open to any string.

> **Two traps.** (1) Widening only the service-side union does nothing —
> `ValidationPipe({whitelist:true})` makes the `@IsIn` at `auth.controller.ts:21` the real
> gate. (2) Sign `workerId` but forget to read it in the guard and every field report gets
> written under `worker: undefined`. Services must throw `ForbiddenException` on a missing
> worker id rather than trusting `user.workerId!`.

> `HealthWorkersModule` must **not** import `AuthModule`, or you need `forwardRef`. Keep
> `HealthWorkersService` dependent on nothing but its own model.

### `AuthService.findOrCreatePatientByPhone(phone, profile?)` → `{patientId, userId, created}`

- **Existing patient user** → `patientsService.getOrCreateByUser` (**not** `patientIdForUser`
  — a User can exist without a Patient after a half-failed register). Backfill the name only
  when it's still the `Caller ####` placeholder; never overwrite a real one.
- **Existing user of another role** → `ConflictException`. This does not regress F1:
  [calls.service.ts:322](../apps/backend/src/modules/calls/calls.service.ts#L322)
  already rejects non-patients, so only the `!user` branch changes. `resolvePatient` catches
  it and logs why — satisfying F1's "no call is ever silently dropped".
- **New** → create with `await this.hashPassword(crypto.randomBytes(24).toString('hex'))`.

> **Do not store a cheap sentinel hash like `'x:'`.** `verifyPassword` uses
> `crypto.timingSafeEqual`, which **throws `RangeError` on a length mismatch** — a malformed
> stored hash turns `POST /auth/login` into a 500 instead of a 401. Use the real
> `hashPassword`, and add a one-line length guard to `verifyPassword` while you're in there.

Catch `err.code === 11000` and re-read by phone — a resent Vapi webhook will race.

`// ponytail: random password, no reset flow — this account can never log into the web app.
OTP login is the upgrade path.`

> **Do not refactor `register()` to call this helper.** Opposite contracts: `register` must
> *reject* a known phone with 409; this must *reuse* it.

### Also wire F1 while you're here
`CallsService.resolvePatient` calls the new helper instead of returning `null` for an unknown
number. That's the whole of F1's backend.

### Tests — `auth.service.spec.ts` (extend; add `HealthWorkersService` to providers)
Unknown phone creates exactly one patient and a **second call creates none** · two shadow
users get **different** hashes · a User with no Patient still resolves · name omitted →
`Caller 3210` · placeholder name is backfilled, a real name is not · a doctor's phone →
`ConflictException` · `register({role:'health_worker'})` calls `healthWorkersService.create`
and **not** `getOrCreateByUser` · `buildSession` for a worker sets `workerId` and leaves
`patientId`/`doctorId` undefined · existing patient and doctor sessions still pass.

### Done when
A seeded worker can log in and get a `workerId` claim; POSTing a webhook payload from an
unknown number creates exactly one patient and a second call from it creates none.

---

# PR 2 — Role-aware frontend shell

Frontend only. **Independently ships ARCHITECTURE gap #9.**

`PatientRoutes` sends non-patients to `/doctor`; `DoctorRoutes` sends non-doctors to `/chat`
([App.tsx:24-34](../apps/frontend/src/App.tsx#L24)). An `admin` bounces
forever, and a third role walks into the same trap. This must land before anyone can log in
as a worker.

**New `apps/frontend/src/roles.ts`** — one shared data module (not an import from `App.tsx`,
which imports `Layout` and would cycle):

```ts
export const HOME = { patient: '/chat', doctor: '/doctor',
                      health_worker: '/field', admin: '/doctor' }
export const homeFor = (role?: string) => HOME[role ?? ''] ?? '/login'
export const ROLE_LABEL = { ..., health_worker: 'ASHA / ANM worker' }
export const SUBTITLE   = { ..., health_worker: 'Field reporting' }
```

One `RequireRole roles={[...]}` component replaces both.

> **Invariant, worth a comment in `roles.ts`:** `HOME[role]` must resolve to a route whose
> group accepts `role`. `admin → /doctor` works only because that group is
> `['doctor','admin']`. Break this and the loop returns. Safety net: if
> `homeFor(user.role) === location.pathname`, render an `.empty-state` "No workspace for
> this account" instead of navigating — three lines that turn a browser hang into a message.

**`Layout.tsx` ends up shorter.** Delete the `count` field from nav items — the render at
L153 already reads a badge map — which collapses the whole `navItems` ternary (L123-136) into
a `NAV` record keyed by role. `home` / `SUBTITLE` / `ROLE_LABEL` become lookups. Keep the
icon components in `Layout.tsx` and `NAV` local to it; `roles.ts` stays a pure data module.

Also: `Login.tsx:20`'s doctor/patient ternary → `homeFor`. `types.ts:5` role union +
`workerId?`. `Landing.tsx` gets a third CTA.

> **No third button on the Login role switcher.** Workers are provisioned and seeded, not
> self-registered — which keeps `auth.controller.ts`'s `@IsIn` and `auth.tsx`'s `register`
> signature out of this PR entirely.

> `L162` prints `user.role` raw and would render the literal `health_worker`.

### Tests
None — the frontend has no test runner. Verify manually: log in as each seeded role, confirm
no redirect loop, and confirm the patient and doctor navs are unchanged.

### Done when
An `admin` account lands on `/doctor` instead of looping, and patient/doctor navigation is
byte-identical.

---

# PR 3 — Facilities + geo-aware doctor matching

Backend only. Independent of PRs 1–2.

New `modules/facilities/`. `Facility` — `name`, `type: 'PHC'|'CHC'|'sub-centre'|'district-hospital'`,
address strings, `location?: GeoPoint`, `phone?`, `specialties[]`.

> **This repo has zero `schema.index()` calls today.**
> `FacilitySchema.index({ location: '2dsphere' })` is the first, and it's a *correctness*
> requirement — `$near` **errors** without it, it doesn't just run slowly. `autoIndex`
> defaults true and builds **asynchronously**, so a `$near` in the first moments after a cold
> boot fails with `unable to find index for $geoNear query`. `findNearest` **must** catch and
> fall through. This is the most likely production surprise in the feature.

**`Doctor.facility?`** — one field on Doctor, **no `doctors[]` array on Facility**.
`findBestMatch` already loads the whole doctor doc, so proximity costs zero extra queries;
two-sided lists drift and there are no transactions anywhere in this repo. The reverse query
is `doctorModel.find({ facility })`, one line.

### `FacilitiesService.findNearest(coordinates?, opts)`
1. `findOne({ location: { $near: { $geometry, $maxDistance: 25_000 } } })` — `$near` in
   `findOne`, not `$geoNear` in an aggregation, so we get a hydrated document. **Don't chain
   `.sort()`** — `$near` already orders by distance and a sort overrides it. Try/catch.
2. String fallback narrowing outward: `village` → `block` → `district`. **Plain equality, not
   `$regex`** — there's already a test in the repo named "does not blow up on punctuation or
   regex metacharacters". `// ponytail:` the exact-match ceiling; a normalised slug is the upgrade.
3. `null`. A facility-less report is a **degraded success**, not a failure.

**`isLngLat()` guard.** GeoJSON is `[lng, lat]`; `navigator.geolocation` gives
`{latitude, longitude}`. Defence in depth: the wire DTO takes named `{lat, lng}` — never a
bare tuple — the service is the only place that builds the array, and the range check catches
an out-of-range swap. The DTO naming is the real defence; the validator is the backstop.

### `findBestMatch` gains an optional **third positional param**
Not an options object — that would rewrite all 8 existing tests for nothing.

```ts
findBestMatch(specialty?, language?, opts?: { facility?: string | Types.ObjectId })
// inside score():  same facility → points += 15
```

15 is chosen deliberately: **above language (10), below the General-Medicine fallback (20)**.
At 30 a local paediatrician would win an adult cardiac case.

| Case | Scores | Winner |
|---|---|---|
| Local vs remote Cardiologist, `'Cardiology'` | 115 / 100 | local ✓ |
| Local GenMed vs remote Cardiologist, `'Cardiology'` | 35 / 100 | remote ✓ (specialty beats proximity) |
| Local Paediatrician vs remote GenMed, unknown specialty | 15 / 20 | GenMed ✓ (**this is why 30 is wrong**) |
| Local vs remote language-matched, same specialty | 115 / 110 | local ✓ |

> **Score, never filter.**
> [doctors.service.spec.ts:39](../apps/backend/src/modules/doctors/doctors.service.spec.ts#L39)
> asserts `find` is called with exactly `{verified:true}`, and pre-filtering by facility would
> also make a doctorless facility return `null` instead of falling back to the network.

### Seed
3 facilities, one district, three tiers, approximate Murshidabad WB coordinates in
**`[lng, lat]`** order (matching the existing Bengali/Hindi demo patients) — PHC Beldanga,
CHC Berhampore, Murshidabad District Hospital. Mark "approximate, demo only". Declare the
2dsphere index in the local seed schema and `await facilityModel.createIndexes()` after
connect, so the first `$near` is deterministic.

Doctor→facility: Ananya (GenMed) → PHC Beldanga, Rohan (Cardiology) → District Hospital,
Sneha (Pediatrics) → CHC Berhampore. Makes proximity demoable in two clicks: fever in
Beldanga → Ananya (35); chest pain → Rohan (100, remote). Plus a 4th doctor, **Obstetrics &
Gynaecology** — without her the pregnancy path in PR 4 silently degrades to General Medicine.

### Tests
`facilities.service.spec.ts` (new) — `[lng,lat]` order in the `$near` filter · default 25 km ·
no coords never issues a `$near` · village→block→district order · `$near` rejecting falls back
instead of propagating · `[200,10]` / `[10]` / `undefined` all treated as absent.

`doctors.service.spec.ts` (extend, 8 existing untouched) — local Paediatrician vs remote GenMed
on an unknown specialty → **GenMed** (pins 15-not-30) · `find` still called with exactly
`{verified:true}` when a facility is supplied · omitting the 3rd arg gives identical results.

### Done when
`findNearest` returns the right facility from coordinates and from a village name, and a cold
DB with no index falls back instead of throwing.

---

# PR 4 — Field reports: schema, extraction, capture, routing

Backend only. Depends on PRs 1 and 3. The core of the feature.

### `FieldReport` schema
`worker` + `patient` (the two-party structure *is* the feature), `channel: 'voice'|'web'`,
`language`, `rawTranscript`, `extraction {symptoms[], vitals{}, duration, trend, urgency,
suspectedCondition, suggestedSpecialty, pregnancyStatus, ageMonths, dangerSigns[]}`,
`location {point?, source: 'gps'|'assigned'|'spoken', village, block, district}`, `facility?`,
`appointment?`, `consent {basis:'explicit', at}`, `status: 'extracting'|'submitted'|'routed'|'failed'`.

Three choices worth defending:
- `urgency` uses **exactly** `CallsService.ROUTE_TO_DOCTOR`'s vocabulary
  ([calls.service.ts:53](../apps/backend/src/modules/calls/calls.service.ts#L53)),
  so the routing rule is shared rather than duplicated into something that drifts.
- `suggestedSpecialty` is separate from `suspectedCondition`. Without it every report lands on
  General Medicine, because `stem('pneumonia')` matches no specialty on the roster.
- `location.source` is the **honesty field**. Without it an assigned-area centroid is
  indistinguishable from a real GPS fix. All three values get a real writer.

`location.village/block/district` are **denormalised on purpose** — a worker gets reassigned;
the report must keep where it happened.

Dropped from the first sketch: `onset` (overlaps `duration`, and `rawTranscript` survives so
it can be re-extracted), `facilityDistanceM` (only `$geoNear` returns a distance and we chose
`$near`; compute client-side if the UI wants "3.4 km"), `consent.channel` (identical to
`report.channel`).

### Extraction — a **sibling** to `summarizeCall`, not a parameterisation

`summarizeCall`'s shape has three consumers and 13 pinning tests. New
`AiService.extractFieldReport(input, language)` returns `{subject{name,phone,age,gender,
pregnant,pregnancyMonths}, symptoms[], duration, trend, vitals{}, dangerSigns[], urgency,
redFlags[], suggestedSpecialty, summary, reporterNotes, confidence}`.

Prompt rules that carry weight: **never invent a vital**, `null` beats a guess, phone as
digits only, and *the worker's own urgency judgement may be escalated but never downgraded* —
they're standing there and the model isn't.

**Two JSON fixes, scoped to this new call only:**
1. `response_format: { type: 'json_object' }` — one line, no dependency, and all these prompts
   already contain the word "JSON" as the parameter requires.
2. A new private `parseJson<T>(text, fallback)` wrapping the existing `extractJson` in try/catch.

> Do **not** retrofit either onto `summarizeCall` / `draftCertificate` / `analyzeDocument`.
> `analyzeDocument` is Pritha's. Zod is out — not installed, and an optional peer of `openai@7.4.0`.
> `json_schema` + `strict` is out — `strict` forbids optional properties, so every
> `durationDays?`/`brand?` would become required-and-nullable.

**Persist before extracting.** Write the report at `status: 'extracting'` with the raw text,
then extract, then patch to `'submitted'`. If the LLM has a bad minute the report survives
with `aiError` set and shows in the doctor queue as "AI extraction failed — raw worker notes
only". A worker's report in a village with one bar of signal is never lost.

**Merge rule: typed form fields win.** `subject.phone`, `name`, `age` and every vitals key the
worker entered override the model; the model only fills blanks. The worker typed the phone.

### Web capture — a form, not a chat

A form makes name and **phone** literally required, and the shadow-user path can't proceed
without a phone — an agent has to nag for it and can silently give up. `runAgent` also returns
`reply: ''` if it's still calling tools on round 4, which is a terrible failure mode for
someone standing in a village. And `chat.controller.ts` is `@Roles('patient')` with
`user.patientId!` on every handler, so a worker chat means a parallel controller *and* a
parallel `executeAction` switch.

The one thing a chat is genuinely better at — free narrative — is recovered with a single
`<textarea>` that runs through the **same extractor as the voice transcript**. 90% of the
value, no new tools in `AiService.tools()`, no new case in `executeAction`.

```
POST /api/field-reports        @Roles('health_worker')
GET  /api/field-reports/mine   @Roles('health_worker')
GET  /api/field-reports/:id    @Roles('health_worker')   ownership-checked
```

DTOs in the `class-validator` style used here, with `@ValidateNested()` + `@Type()` on every
nested object — `ValidationPipe({whitelist:true})` **silently strips** nested bodies without
them. `GeoDto` takes named `{lat, lng, accuracyM?, source}`. Vitals get real ranges
(`temperatureC` 30–45, `spo2` 50–100) so a fat-fingered entry 400s instead of reaching a doctor.

### Routing — extend `book()`, do not fork it

A parallel method duplicates the create + both notifications (~50 lines) to change three
strings and one enum value, and every future brief change has to be made twice.

`BookAppointmentInput` gains `type?`, `facility?`, `vitals?: string[]`, and
`reportedBy?: {workerName, cadre, village?, facilityName?}`.

> `reportedBy` is a **value object, not a ref**. That is what keeps `AppointmentsModule` from
> importing `HealthWorkersModule`, so `FieldReports → Appointments` stays a one-way edge with
> no `forwardRef`.

Inside `book()`:
- `type: input.type ?? 'call-back'` — all four existing callers omit it, so behaviour is
  bit-identical. Also add the missing enum validator to `appointment.schema.ts:24`; today a
  typo saves silently.
- `findBestMatch(specialty, patient.language, { facility: input.facility })`
- Doctor brief: worker + village + facility lines added **around** the existing `Patient: X`
  line, which stays. `vitals` as `string[]` reuses the existing `bullet()` helper, so empty
  vitals disappear for free.
- Patient notification gets an `in-person` variant that says "visit", not "call you back".

`FieldReportsService.submit()` order: worker → shadow patient → location → facility →
**create the report** → `book()` in try/catch → patch to `routed` / `failed`. Report before
booking, so a routing failure leaves durable field data — the same instinct already in
`verification.service.ts`'s apply-before-mark ordering.

`type: 'in-person'` when a facility resolved **and** urgency is urgent/emergency — a
semi-urgent case is fine on a call-back; an emergency needs a body in a room. Specialty falls
back: `suggestedSpecialty` → `'Obstetrics'` if pregnant → `'Pediatrics'` if `ageMonths ≤ 60`
(`// ponytail:` a demo heuristic) → `undefined`, which lands on General Medicine via the
existing +20.

> **No `VerificationTask` here.** `taskType: 'appointment'` exists and is dead and it's
> tempting, but that queue is about *AI drafts* awaiting sign-off and a human's field
> observation isn't one. The doctor already gets a notification and a call-back-queue row.
> PR 7 adds a task type for the *council draft*, which genuinely is an AI draft.

### Tests
`field-reports.service.spec.ts` (new) — `{lat:23.93,lng:88.25}` → stored `[88.25, 23.93]`
(**the single most valuable assertion in the feature**) · voice report **ignores** body coords
so `source:'gps'` can never be a lie · extraction throwing leaves a saved report with `aiError`
and does not throw · typed phone beats the model's · a phone belonging to a doctor is **not**
attached · first report creates the patient, second reuses · `book()` throwing leaves
`status:'failed'` and returns normally · `type` is `'in-person'` only when facility + urgent ·
pregnancy → `'Obstetrics'`, `ageMonths: 8` → `'Pediatrics'`.

`appointments.service.spec.ts` (new — **no existing file, so zero regression risk**) —
`book()` with no `type` still writes `'call-back'` · the doctor brief is **byte-identical**
when `reportedBy` is absent (snapshot the string) · `facility` is forwarded as the 3rd arg to
`findBestMatch` · no doctor matched still creates the appointment and notifies the patient.

`ai.service.spec.ts` (extend) — village and known fields reach the system prompt ·
`response_format` requested · **prose reply returns the fallback instead of throwing**.

### Done when
`curl POST /api/field-reports` with a worker token creates a patient, a report and an
appointment, and the matched doctor's notification names the worker and the village.

---

# PR 5 — Worker screens

Frontend only. Depends on PRs 2 and 4. **Full web capture demoable at merge.**

All classes below already exist in `App.css`. `.status-timeline`, `.pill-primary` and `.mono`
are defined and currently unused by any component — free reuse.

**`apps/frontend/src/api/geo.ts`** (~35 lines) — wraps `getCurrentPosition` in a promise that
**never rejects**. `{enableHighAccuracy: true, timeout: 8000, maximumAge: 300_000}`, fired once
from a mount effect (the worker is standing in the village when they file), plus a Retry button.
Denied/unavailable/timeout all omit `geo` from the body; the server stamps the assigned area
with `source:'assigned'` and the UI shows a `pill pill-warning`. **Never blocks submission.**

> `navigator.geolocation` requires a secure context. `localhost` is fine; `http://192.168.x.x`
> — i.e. exactly how you'd demo on a phone — silently fails. It degrades to the assigned area
> rather than breaking, but note "https or localhost" in the README.

**`/field` NewReport** — geo strip, a voice button (hidden until PR 6), then the form: name +
phone (required), age/gender, pregnancy checkbox shown only for a woman 12–55, symptoms as
comma-separated input (mirroring `Profile.tsx`'s allergies idiom), duration, a collapsible
vitals `.grid.grid-4`, the narrative textarea, and 4 urgency chips. Success swaps the form for
an `.action-strip`: *"Report filed for Sita Devi. Matched with Dr. Rohan Mehta (Cardiology)."*
On error keep the form state — never clear on failure.

**`/field/reports` MyReports** — `.item-list`, 20s poll (house style, so the doctor's reply
arrives without a refresh), a `StatusPill` mirroring `Appointments.tsx:5-14`, and a **real
`catch`**. The existing screens' `load()` functions have none
([Appointments.tsx:59](../apps/frontend/src/components/Appointments.tsx#L59),
[Verification.tsx:35](../apps/frontend/src/components/doctor/Verification.tsx#L35)),
so a rejection sticks the spinner forever. Don't fix those here; just don't copy the wart.

**`/field/reports/:id` ReportDetail** — what you reported (vitals as `.stat` tiles), what the
doctor said (`.cert-preview` + flag pills), and an `.empty-state` "Waiting for the doctor"
until there's a reply.

Plus `/field/profile`, ~40 lines mirroring `Profile.tsx`.

### Tests
None — `apps/frontend/package.json` has no test runner, no jsdom, no testing-library. Adding
vitest + RTL to land three screens is a bigger diff than the feature.
`// ponytail: no component tests — upgrade path is vitest + @testing-library/react, starting
with NewReport's geo-denied path.`

### Done when
A worker logs in, files a report with GPS allowed and again with it denied, and both land with
the correct `location.source`.

---

# PR 6 — Voice capture for workers

Depends on PR 4. Independent of PR 5.

### A second Vapi assistant, via a `--asha` profile flag

The existing prompt is written entirely in second-person-patient voice ("you already know this
caller"). The worker prompt is the **opposite framing**, not a variation — merging them behind
a `{{mode}}` switch makes working patient triage hostage to worker-prompt regressions. And the
system prompt can't be a per-call override, because that would mean shipping the clinical
prompt from the browser where devtools can rewrite it.

A separate `setup-vapi-asha.ts` would duplicate `api()`, `upsertEnvAssistantId()` and `run()` —
~110 of 203 lines. So: a `PROFILES` record in
[setup-vapi.ts](../apps/backend/src/scripts/setup-vapi.ts) selected by
`process.argv.includes('--asha')`, with a separate name
(`'MedAssist Field Report Assistant'`) and pin (`VAPI_ASHA_ASSISTANT_ID`). Voice, transcriber,
timeouts and server config are shared. Add `"vapi:setup:asha"` to `package.json`.

> **The highest-risk line in the whole feature.** `run()` currently PATCHes whatever the pinned
> id resolves to. One `vapi:setup:asha` run with a stale `VAPI_ASSISTANT_ID` still in scope
> **silently overwrites the shared patient assistant for the entire team.** Abort if the pinned
> assistant's name ≠ the profile's name. Announce before running. Create the ASHA assistant once.

### The worker prompt
Collects, one question at a time: villager name + **phone** (read back digit by digit, get a
yes), age + pregnancy status for a woman 12–55, symptoms + duration + trend, vitals *actually
measured* (never estimate, never suggest a number, never fill in a normal value), danger signs,
and the worker's own urgency judgement. Emergency → stop the interview, say call 108, capture
name and phone only. Read back everything and confirm before hangup. Never diagnose, never name
a medicine, one case per call.

### No Vapi tools
They'd need a publicly reachable `server.url` (ngrok) for a flow that today needs **zero**
inbound infrastructure — browser → Vapi, then browser → `POST /api/calls/complete`. Instead the
agent reads back the worker's *linked* doctor and facility, passed in `variableValues`, which
it can state truthfully with no round trip. The actually-matched specialist lands on screen ~2s
later via the existing `onSummarized` callback.

`// ponytail: the agent reads back the worker's linked doctor, not the AI-matched specialist —
matching needs the transcript, which only exists after hang-up. Upgrade path: a
submit_field_report Vapi tool + a tool-calls branch in handleWebhook, once VAPI_WEBHOOK_URL is
a stable public URL.`

### Backend
`GET /api/calls/session/field` and `POST /api/calls/complete/field`, plus one `assistantId`
branch in `processCompletedCall` for phone-in workers (`assistantId` is already persisted by
both webhook branches, so no extra lookup).

> **`resolvePatient` is not touched.** The patient path carries zero regression risk.

> Key the field upsert on `{vapiCallId, healthWorker}`, not `{vapiCallId}` alone.
> `completeWebCall` has an existing ownership hole — any authenticated patient can claim any
> call id — and this must not widen it.

**`VapiWebhookGuard`** (~12 lines, checks `x-vapi-secret`, no-ops when the env var is empty so
the tunnel-free dev path keeps working). `VAPI_WEB_SECRET` is currently pushed to Vapi and
verified by **nothing** — and once this webhook can create Patients from arbitrary phone
numbers, it becomes a shadow-user injection endpoint. `setup-vapi.ts` already sends the header,
so enabling it is safe **provided** local `.env` matches what was pushed.

**`api/call.ts`** gets a third `opts` param (`sessionPath`/`completePath`/`extra`) rather than a
second 70-line function — the listener wiring, `posted` idempotence flag and transcript
accumulation are identical. Defaults preserve today's paths exactly. `CallModal` gets two
optional props (`title`, `subtitle`) defaulting to today's strings, so the patient screen stays
byte-identical.

**Failure path that matters:** if voice drops the phone number, `onSummarized` returns
`linked: false` and the UI offers "File it as a form" **pre-filled with whatever was extracted**.
Phone is the one field voice can lose and the one field the shadow-user path can't do without.

### Tests
`calls.service.spec.ts` (extend) — `getFieldWebSession` returns `VAPI_ASHA_ASSISTANT_ID` ·
`completeFieldWebCall` upserts with `healthWorker` and no `patient` and calls
`fieldReportsService.ingest`, never `book()` directly · a webhook with the ASHA assistant id
routes to `ingestFromCall` · **regression guard:** the existing "links the call to the caller
from the JWT" test also asserts `ingest` was **not** called. All 13 existing tests must pass
unchanged.

`vapi-webhook.guard.spec.ts` (new, ~30 lines, pure — no Nest module) — empty secret allows;
matching header allows; wrong or missing header denies.

### Done when
A worker calls in, the agent reads back the case, and a `FieldReport` lands with
`channel: 'voice'` and `location.source: 'assigned'`.

---

# PR 7 — Prescription + AI council

Backend only. Depends on PRs 0 and 4. Outbound is stubbed.

### `Prescription` is its own collection

Reusing `Certificate` is genuinely tempting — ~90% field overlap, and `applyDecision` already
routes `'certificate'`, so the doctor gate would need zero new wiring. Rejected for four
concrete breakages:

- `GET /certificates` (`@Roles('patient')`) and `/certificates/all` would start returning
  prescriptions into the patient's Certificates tab and the doctor's certificate list — a
  frontend regression with no frontend change.
- `certificates.service.ts:103` unconditionally does `finalContent = draftContent.body`.
  Branching there puts an `if` inside the exact method `applyDecision` calls under a pinning test.
- `items[]` must be first-class and queryable — that's the entire legal point of an e-prescription.
- The council's three role outputs + flags have no home in `Certificate`.

Reuse hard at the *service* level (mirror `request`/`issue`/`reject`/`pdfPath` structure
verbatim) and at the *verification* level (the existing gate, untouched). **No shared base
class** — copying the pdf-lib frame is cheaper than an inheritance hierarchy.

Key fields: `draftItems` (frozen — what the AI proposed) and `items` (what the doctor signed).
**That pair is the audit trail and the labelled training data**, queryable directly. No derived
diff object — a third stored copy can drift.

### `AiService.draftPrescriptionCouncil(input)` — two waves, not three in parallel

```
wave 1:  prescriber                                (produces the draft)
wave 2:  Promise.allSettled([safety, formulary])   (both SEE the draft)
```

The checkers must see the draft, so they can't be parallel with the prescriber. **`allSettled`,
not `all`** — `Promise.all` rejects on the first failure and discards the other role's result,
which directly violates "one role errors, two succeed". Prescriber failure is fatal (no draft →
throw, no Prescription created); checker failure is degraded (a `block` flag + a `failedRoles` entry).

### The merge rule is that there is no merge

Safety and formulary emit **flags only** and never touch `items`. So no disagreement *can* be
silently dropped — the mechanism makes it impossible rather than the prompt discouraging it. The
merge does exactly three things: concatenate flags, stamp `tpgList` per item from the formulary's
verdict (name mismatch → leave `unclassified` + an info flag, never drop the item), and push a
`{severity:'block', role:'system'}` flag for each failed role.

A `block` flag **does not auto-reject the draft**. The prescription is still created and queued;
PR 8's UI disables plain Approve and forces "Edit & approve". Silently refusing to draft is
itself a silent merge — the doctor must see what the AI wanted and why it was stopped.

### Prompts
- **Prescriber** (temp 0.2) — INN generics only, no controlled substances, no injectables, ≤5
  items, `durationDays ≤ 5` for a first remote consult, always include supportive care (ORS,
  fluids), return `items: []` if it's beyond safe remote management.
- **Safety** (temp 0.1) — four checks: allergy cross-reaction **at class level**
  (penicillin→amoxicillin, sulfa→cotrimoxazole, NSAID class); interactions with current meds
  *and within the draft*; age appropriateness (aspirin <16 for Reye's, tetracyclines <8,
  fluoroquinolones in children); pregnancy — where an *unrecorded* status in a woman 12–50 is
  itself a warn flag.
- **Formulary** (temp 0.1) — classify each drug O/A/B/prohibited/unclassified for the recorded
  `consultMode`. **"If you are not certain, output `unclassified`. Do not guess a list."**

### The layer the model can't undermine
A hardcoded `PROHIBITED_STEMS` array (alprazolam, diazepam, tramadol, codeine, morphine,
methylphenidate, …) checked in TypeScript **after** the council returns. Any match gets a
`block` flag **regardless of what the formulary checker said**. This is the layer you demo,
test and defend; the model's `tpgList` is decoration on top of it.

Same `json_object` + guarded-parse approach as PR 4.

### Legal framing — what's enforceable vs what must be verified

**In code:** `consultMode` stored at draft time (TPG makes what may be prescribed
mode-dependent, so it must be a stored fact at signing, never inferred later) ·
`prescriberRegNo` snapshotted so the record survives a later profile edit · the deterministic
deny-list · **no TTL index anywhere**, with a comment saying that absence is deliberate (TPG
requires retention) · `status` starts `awaiting-doctor` and `pdfPath`/`signedBy` are written
only inside `issue()`, which is reachable only from a `@Roles('doctor')` route — an
architectural claim you can point at, not a promise.

**Must be verified before asserting:** the actual contents of List O/A/B · whether a *first*
teleconsult may prescribe List A at all · **whether an ASHA-relayed consult counts as the
patient's caregiver or as health-worker-initiated** — different consent duties and different
prescribing latitude, and this is currently an assumption load-bearing for the whole feature ·
whether `signedBy` + a generated PDF satisfies TPG's signature requirement.

Never render "List A — compliant". Render *"Council classified as List A (unverified,
secondary source)"*. The defensible stage line: *"we record the facts the guidelines require
and put a licensed doctor in the only code path that can issue — we have not had a lawyer
certify the drug lists."*

> **`Doctor.verified` defaults true and anyone can self-register as a doctor** (gap #6). The
> reg-number guard is therefore cosmetic today. Say so rather than implying otherwise.

### Tests
`ai.service.council.spec.ts` (**a new file**, not an extension — `ai.service.spec.ts`'s
`mockOpenAI` is a round-counting script tailored to `runAgent`'s loop). Same client-swap idiom,
but `create` dispatches on the system message content.

The checkers' request messages **contain the prescriber's drug name** (makes "must see the
draft" testable) · formulary rejecting still returns items + `failedRoles: ['formulary']` + a
system block flag · prescriber rejecting is fatal · a safety `block` flag appears verbatim
**and `items` is unchanged** · malformed JSON doesn't throw · **`Alprazolam` gets blocked even
when formulary says List O**.

`prescriptions.service.spec.ts` (new) — `request()` freezes `draftItems` and creates a
`taskType: 'prescription'` task · `pdfPath()` with a wrong `patientId` → 404 not 403.

### Done when
A field report produces a council draft in the DB with flags from both checkers, and a
deny-listed drug is blocked regardless of the formulary's verdict.

---

# PR 8 — Doctor verify · edit · sign

Depends on PR 7. **Signed prescription end to end at merge.**

`VerificationTask.doctorEdit` and `status: 'edited'` are declared and written by nothing. This
is their first writer — and FEATURES.md §5 already wants exactly this mechanism to replace the
`window.prompt()` in `CallBacks.tsx`.

### New route, not a field on the existing DTO

`POST /api/verification/:id/approve-edited`.

> `ValidationPipe({whitelist:true})` **silently strips** unknown body keys. If the edit were an
> optional field on `DecisionBody`, a mis-shaped payload posted to `/approve` would vanish with
> no error and the doctor would believe they had edited. A separate route with a required
> validated body makes that impossible, and leaves the pinned `approve` test untouched.

`approveWithEdit` mirrors `approve` exactly — including setting `doctorEdit` **before**
`applyDecision`, and calling `applyDecision` **before** `status`. Then `applyDecision` needs
**one branch and no signature change**:

```ts
} else if (task.taskType === 'prescription') {
  await this.prescriptionsService.issue(task.refId, task.doctor!, task.doctorEdit);
}
```

Plain `approve()` reaches the same branch with `doctorEdit === undefined` and `issue()` falls
back to `draftItems`. **Both approval paths, one branch.**

Add the mirror branch to `reject`'s **inlined** switch too.

> **Do not unify `reject`'s switch with `applyDecision`.** `applyDecision`'s `else` notifies the
> patient and `reject`'s deliberately doesn't; merging them changes call-note behaviour.

> **`applyDecision`'s `else` is a catch-all.** Add the enum value but forget the `else if` and
> approving a prescription tells the patient *"a doctor reviewed your call"*, issues nothing,
> and marks the task approved — **silent and unrecoverable**, since the task can't be re-decided.
> Same for `reject`'s missing `else`: the prescription stays `awaiting-doctor` forever while the
> task says `rejected`. Branch + test in the same commit.

### `issue()` ordering
guard reg-number → `items = edit?.items ?? draftItems` → re-run the deny-list on the *final*
items (**warn only** — a licensed doctor is the authority; blocking their own edit is wrong) →
sign → `status: 'issued'` → save → notify → **`try { outbound } catch { log }`, strictly last
and never rethrowing**.

The reg-number guard throwing leaves the task `pending` **for free**, because `applyDecision`
runs before `status='approved'`. If delivery threw, `applyDecision` would fail and leave the
task pending while a signed prescription already exists.

### PDF
Reuse the certificate frame (same A4, same nested bordered rects, same header, same 8-char id)
so it reads as one product. Differences: an **Rx** mark, patient line with age/sex, a numbered
drug table, Advice and Follow-up blocks, and a signature block carrying `Reg. No.` and *"Issued
under a `${consultMode}` teleconsultation."*

**Always Latin-safe**, via PR 0's `winAnsiSafe`. Drug names are already Latin (INN generics);
render dose/frequency as structured tokens: `500 mg · 1 tab · 2× daily · 5 days · after food`.
The Hindi/Bengali version goes out as **text** in PR 9 — WhatsApp and Vapi handle Unicode
natively and neither touches pdf-lib. **The outbound design and the font problem solve each
other.** Footer: *"Instructions were also sent to the patient in Hindi by WhatsApp / voice call."*

Cost, stated plainly: no printed Hindi prescription to hand a pharmacist. `// ponytail:` it —
embedding Noto via fontkit wouldn't fix it either, since pdf-lib does no complex text shaping,
so conjuncts (क्ष) and reordered matras (कि) come out wrong.

### Frontend, **same commit**

> Adding `'prescription'`/`'field-report'` to the task type makes `TASK_LABEL[t.taskType]`
> `undefined` and the emoji ternary fall through to `'📞'` — the doctor sees an unlabelled phone
> card with no drug list. And `types.ts:107` is a literal union that will fail the build.
> Highest-impact break in the feature.

`Verification.tsx` — replace the nested emoji ternary with a `TASK_ICON` record, and add a
`resolveTask` branch rendering: subject + age + urgency pill (reuse `CallBacks.tsx:92-103`'s
exact expression), *"Reported by Anjali Roy (ASHA) · Baruipur"*, a geo chip (`GPS ±18 m` vs
`Assigned area (no GPS)`) beside a plain Google Maps `<a>` — **no map library** — vitals as a
`.grid.grid-4` of `.stat` tiles (`Overview.tsx:44-51`'s idiom), danger signs as `pill-danger`
chips, and the council draft in `.cert-preview` with flags mapped block/warn/info →
danger/warning/info. **Approve is disabled while any `block` flag stands**, with the reason
shown — three lines, and the only real safety property on the screen.

`aiOutput` carries the whole render model, denormalised at creation, so this needs **zero new
doctor endpoints and zero new populates**. `// ponytail: aiOutput is a snapshot — a later edit
won't show in the queue card. The live view is the worker's /field/reports/:id.`

> `applyDecision`'s `else` will now fire for field reports and tell the villager *"A doctor
> reviewed your call"*. Key title/body off `taskType`. Two lines, user-visible.

### Tests
`verification.service.spec.ts` (extend) — `approveWithEdit` persists `doctorEdit` and sets
`'edited'` · **applies before status** — `issue` rejecting leaves the task `pending` and `save`
uncalled · plain `approve` on a prescription calls `issue(refId, doctorId, undefined)` ·
`reject` calls `prescriptionsService.reject` (guards the inlined-switch trap).

> ⚠️ Add `{provide: PrescriptionsService, useValue: {...}}` to that spec's `providers` **in the
> same commit**, or the suite fails to compile the moment the constructor gains a param. And
> `forwardRef` on **both** sides of Verification ↔ Prescriptions, exactly like Certificates, or
> Nest won't boot.

`prescriptions.service.spec.ts` (extend) — no edit → `items === draftItems` · with an edit →
`items === edit.items` and **`draftItems` untouched** (the training pair) · missing
`registrationNumber` throws and saves nothing.

### Done when
A doctor edits a council draft, signs it, and a Latin-safe PDF exists with `draftItems ≠ items`.

---

# PR 9 — Outbound delivery

Depends on PR 8. Independent of PR 10.

`OutboundService.send(req, patientId?)` → an `OutboundMessage` row. Creates the row `queued`
**first** (a crash mid-send leaves evidence), then sets `sent`/`failed`. **Never throws.**
Unknown or unconfigured driver falls back to `simulated`.

Drivers are a plain `Record<DriverName, OutboundDriver>` built in the constructor from
`ConfigService` — no DI tokens, no factory. All use bare `fetch`; `setup-vapi.ts:95-121`
already models exactly that pattern, and `package.json` stays untouched.

**No `'delivered'` status** — we never receive a receipt, so calling it `sent` is honest.
`// ponytail: no delivery receipts — a StatusCallback webhook is the upgrade path.`

**No retry scheduler.** `POST /api/outbound/:id/retry` (`@Roles('doctor')`) re-runs the same
row. A *medical* message that silently retries at 3am is worse than one that visibly failed.

| Driver | Notes |
|---|---|
| `simulated` | **Default.** DB row + log. The whole flow demos with zero credentials — same philosophy as a blank `OPENAI_API_KEY` still booting. `GET /api/outbound` gives the doctor console the "SMS that would be sent" panel FEATURES.md §4 asks for, free. |
| `whatsapp` | Twilio sandbox. **Text only by default** — `MediaUrl` must be publicly fetchable, and serving `prescriptions/` via ServeStatic would recreate gap #8 (unauthenticated PHI at a guessable path). A capability URL (`shareToken` + an unguarded `/public/:token/pdf`, 7-day expiry) is opt-in behind `PUBLIC_BASE_URL`; on localhost it's unset, so **no new unauthenticated route exists at all**. |
| `sms` | Twilio. Ships, is selectable, and is **documented as failing for +91** until DLT. Useful for non-India numbers and for the compliance narrative. |
| `voice` | Vapi outbound. Needs `VAPI_PHONE_NUMBER_ID` (the repo has none); returns `{ok:false, error}` rather than throwing when unset. Reuses `VAPI_ASSISTANT_ID` with `assistantOverrides.firstMessage` — **no `setup-vapi.ts` change**. ⚠️ The triage prompt says *"never prescribe medicines"*, so it'll read the prescription then decline to discuss it. Arguably correct — it shouldn't negotiate dosages — but call it out. Verify endpoint/field names against Vapi's docs; their API moves. |

**Delivery failure does not un-issue a prescription.** `status: 'issued'` is saved before
outbound runs; `deliveredVia` is appended only on `sent`. Legally a prescription is issued when
a registered doctor signs it; whether the message landed is a logistics fact, and the schema
says so. A failed row stays visible in the doctor console.

### Tests
`outbound.service.spec.ts` (new) — the `queued` row is written **before** the driver is called
(assert call order) · `{ok:false}` → `failed` with the error recorded and **no throw** · a
driver that *throws* also resolves to `failed` · unknown driver falls back to `simulated` ·
retry increments `attempts` and creates **no second row**.

`whatsapp.driver.spec.ts` (new, mock global `fetch`) — form-encoded POST with
`To=whatsapp:+91…` and Basic auth · **omits `MediaUrl` when `PUBLIC_BASE_URL` is unset** ·
non-2xx → `{ok:false}` with no throw.

`prescriptions.service.spec.ts` (extend) — **the headline test:** the driver failing still
leaves `status: 'issued'` with `deliveredVia` empty · `issue()` doesn't throw when `send`
*rejects* · `deliveredVia` gets the driver name only on `sent`.

### Done when
With `OUTBOUND_DRIVER=whatsapp` and the sandbox joined, a signed prescription arrives on a real
phone — and with the driver unplugged, the prescription is still `issued`.

---

# PR 10 — Escalation

Depends on PR 8. Independent of PR 9.

### Doctor↔patient chat: `role:'assistant'` + `metadata.author`, **not** a `'doctor'` role

Adding `'doctor'` to the `Message.role` enum looks natural and is a trap.
`ConversationsService.history()` filters to user/assistant, so a doctor message would be
**silently dropped** — the AI blind to the doctor's own words, the exact opposite of the goal.
Fixing that cascades through `history()`'s filter and return type, `ChatTurn` in
`ai.service.ts:6`, and `runAgent`'s `history.map()` which passes the role **straight to
OpenAI**, which has no `doctor` role. Five files through the hottest path in the app.

Instead: `metadata: {author:'doctor', doctorId, doctorName}`. The doctor's message reaches the
model as prior assistant context (correct — it *is* something the system said to the patient),
renders in the existing chat UI with zero frontend changes, and `listMessages` already returns
full metadata for styling. The one gap — the model can't tell "I said this" from "the doctor
said this" — is closed in **content, not schema**: three lines in `history()` that prefix such
messages as `` `[Dr. ${name}]: ${content}` ``.

**The behaviour rule matters more than the storage.** Add `Conversation.handoffAt?` +
`handoffDoctor?`. When set, `ChatService.sendMessage` **must not run the agent** — store the
message, notify the doctor, return a fixed translated line. An AI answering over a live doctor
is a safety and liability problem. ~8 lines gated on a field that is `undefined` for every
existing conversation, so the default path stays bit-identical.

Routes: `POST /api/chat/doctor/:patientId/{message,handoff,release}`, all `@Roles('doctor')`,
reusing `ConversationsService.addMessage` unchanged.

**Trigger:** rejecting a prescription task with a comment should mark it rejected, notify the
patient, **and** open the handoff — which also fixes, for this type, the existing "rejecting a
non-document task notifies nobody" gap.

### In-person referral
An `Appointment { type: 'in-person', status: 'assigned', aiNotes: {referredFrom, facility,
facilityPhone, urgency, timeframe} }` — finally writing that dead enum value. The patient gets
an outbound message in their language (*"go to `<facility>`, phone `<number>`, within
`<timeframe>`; show this message when you arrive"*), and **the ASHA worker gets a notification
too** — they're the person who physically accompanies the patient. **No PDF**; a referral isn't
a signed prescription and a second PDF pipeline is unjustified.

### Tests
`conversations.service.spec.ts` (extend) — `history()` prefixes a doctor-authored message with
`[Dr. X]:` and still returns `role: 'assistant'`; the existing spec passes unchanged.

`chat.service.spec.ts` (new) — `handoffAt` set → `runAgent` is **not** called; `handoffAt`
undefined → the existing path is bit-identical.

### Done when
A doctor takes over a thread, the AI stops answering, and rejecting a prescription opens the
handoff and tells the patient.

---

## Verification (every PR)

```bash
docker compose up -d
npm run seed       --workspace @iem-hacks/backend
npm test           --workspace @iem-hacks/backend      # 58 existing must stay green
npx tsc --noEmit -p tsconfig.json                      # in apps/backend
npm run build      --workspace @iem-hacks/frontend
npm run dev
```

New specs follow the established idiom: plain-object model mocks via `getModelToken`,
collaborators stubbed by class token, a local helper wrapping the chain ending in `exec`,
`jest.clearAllMocks()` in `beforeEach`, no DB and no network.

**`test/app.e2e-spec.ts` is already broken** — it asserts `GET /` while `main.ts` sets the
`/api` prefix, and it's outside `npm test`'s `rootDir: src` glob so it never runs. Leave it;
say so in the first PR description rather than silently ignoring it.

**Manual end-to-end after PR 9:** log in as `+919700000001 / demo123` → `/field` → file a
report for a new phone with GPS allowed and again with it denied → confirm the patient was
created once → log in as the matched doctor → the field-report card shows worker, village, geo
chip and vitals → approve-with-edit a council prescription → confirm the PDF renders, the
`OutboundMessage` row is `sent`, and `draftItems ≠ items`.

---

## Coordination

- **FEATURES.md F3** plans `consentBasis`/`consentChannel`/`consentAt`/`mode` on `Appointment`.
  This feature writes overlapping consent data and — importantly — **changes F3's conclusion**:
  F3 argued consent is *implied* because the health-worker flow was descoped. **This un-descopes
  it.** A worker-initiated consult is exactly the case TPG 2020 says needs **explicit** consent
  recorded, which is what F3's currently-dead `consentBasis: 'explicit'` branch was built for.
  Whoever lands first defines the fields.
- **`Patient.consentGranted`** gets two would-be writers (PR 1 and F3).
- **Pritha's track** owns `analyzeDocument` — don't touch it, or `extractJson`.
- **The shared Vapi account** — announce before running `vapi:setup:asha` (PR 6).

## Out of scope

Real +91 SMS (DLT) · WhatsApp production templates · Vapi number provisioning · Vapi server
tools / `tool-calls` webhook handling (needs a stable public URL) · a worker-facing agent chat ·
printed Hindi/Bengali PDFs · delivery receipts, retry scheduling, rate limiting, a global
exception filter · frontend component tests (no test runner exists) · fixing
`test/app.e2e-spec.ts`, the `completeWebCall` ownership hole, or `Doctor.verified` defaulting
true — all pre-existing, all flagged, none in these diffs.
