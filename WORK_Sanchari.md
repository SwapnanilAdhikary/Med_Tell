# Sanchari's task — Bug fixes across the codebase

Welcome! You own a set of bug fixes that touch both the backend and frontend.
These are real bugs found in the code — not features, not security work. Just
things that are broken or will break under real use.

This doc explains each bug, where it lives, and how to fix it. Anything
unfamiliar is explained inline. Ask rather than guess — a wrong guess in a
medical app is worse than a question.

**Before you start:** get the app running with [SETUP.md](SETUP.md), log in as
a patient and a doctor, and click around. Seeing the bugs in action helps more
than reading about them.

---

## 1. Words you'll see in this doc

| Word | What it means here |
|---|---|
| **Race condition** | Two things happen at the same time and the code doesn't handle it — one overwrites the other |
| **TOCTOU** | "Time of check, time of use" — you check something exists, then someone else removes it before you use it |
| **CastError** | Mongoose throws this when you pass a string where it expects a MongoDB ObjectId (like `"abc"` instead of a 24-character hex string) |
| **Greedy regex** | A regular expression that grabs as much as it can, instead of as little as it needs |
| **ENOENT** | Unix error for "file not found" — the file you're trying to read doesn't exist on disk |
| **Spec file** | A test file, named `something.spec.ts`, living next to the code it tests |
| **DTO** | A small class describing allowed request body fields, so bad input is rejected early |

---

## 2. What's in this doc

Ten backend bugs and three frontend bugs. Each one is small and self-contained.
Do them in order — they're grouped by area so you're not jumping around the
codebase randomly.

**What's NOT here:** security fixes (Vapi webhook auth, `/uploads` unauthenticated,
doctor self-registration, rate limiting). Those are tracked separately in
[ARCHITECTURE.md](ARCHITECTURE.md) §12 and are someone else's work.

---

## 3. Backend bug fixes

---

### Bug B1 — `assign()` lets two doctors claim the same patient

**Where:** `apps/backend/src/modules/appointments/appointments.service.ts:157`

**What's wrong:**
`assign()` does `findByIdAndUpdate` to set `status: 'assigned'` and `doctor: doctorId`.
But it never checks what the current status is. If two doctors click "assign" at
the same time, both succeed. The second doctor silently overwrites the first.

**The fix:**
Add a status check before updating. Only assign if `status === 'requested'`.

```ts
async assign(doctorId: string | Types.ObjectId, appointmentId: string) {
  const appointment = await this.appointmentModel
    .findById(appointmentId)
    .exec();
  if (!appointment) throw new NotFoundException('Appointment not found');
  if (appointment.status !== 'requested') {
    throw new BadRequestException('This case has already been claimed');
  }

  appointment.doctor = doctorId;
  appointment.status = 'assigned';
  await appointment.save();
  // ... rest stays the same
}
```

**Why this matters:** In a real clinic, two doctors grabbing the same patient
means one patient gets two callbacks and the other doctor gets nothing.

---

### Bug B2 — Two concurrent messages create duplicate conversations

**Where:** `apps/backend/src/modules/conversations/schemas/conversation.schema.ts:8`

**What's wrong:**
The `patient` field has `index: true` but not `unique: true`. The `getOrCreate`
method does `findOne` then `create` — if two requests come in at the same time
for the same patient who has no conversation yet, both see "none exists" and both
create one. Now the patient has two conversations and their messages are split
across both.

**The fix:**
Add `unique: true` to the patient prop:

```ts
@Prop({ type: Types.ObjectId, ref: 'Patient', required: true, index: true, unique: true })
patient: Types.ObjectId;
```

Then handle the duplicate key error in `getOrCreate` (conversations.service.ts):

```ts
async getOrCreate(patientId: string, title?: string) {
  const existing = await this.conversationModel
    .findOne({ patient: patientId })
    .exec();
  if (existing) return existing;

  try {
    return await this.conversationModel.create({
      patient: patientId,
      title: title ?? 'MedAssist Assistant',
    });
  } catch (e: any) {
    // Duplicate key — another request created it first. Fetch it.
    if (e.code === 11000) {
      return this.conversationModel.findOne({ patient: patientId }).exec();
    }
    throw e;
  }
}
```

**Why this matters:** Split conversations mean the AI forgets half of what the
patient said. In a medical context, that's dangerous.

---

### Bug B3 — Malformed `:id` causes a 500 error instead of 404

**Where:** `apps/backend/src/main.ts` (app-wide, no filter exists)

**What's wrong:**
When someone hits `GET /api/verification/abc`, Mongoose tries to cast `"abc"` to
an ObjectId, fails, and throws a `CastError`. NestJS turns that into a 500
Internal Server Error. The user sees a generic error instead of "not found". In
dev mode, the stack trace can leak.

**The fix:**
Add a global exception filter in `main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { MongooseError } from 'mongoose';
import { AppModule } from './app.module';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    // Mongoose CastError (bad ObjectId) → 404
    if (exception instanceof Error && exception.name === 'CastError') {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: 404,
        message: 'Resource not found',
      });
      return;
    }

    // Everything else → 500
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Internal server error',
    });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

**Why this matters:** Users should see "not found", not "something broke". And
stack traces shouldn't leak in production.

---

### Bug B4 — `extractJson` grabs too much when the AI output has extra braces

**Where:** `apps/backend/src/modules/ai/ai.service.ts:362`

**What's wrong:**
The regex `/\{[\s\S]*\}/` is greedy. If the AI says:

```
Here are the findings: {"a": 1} and also {"b": 2}
```

It grabs from the first `{` all the way to the last `}`, producing invalid
JSON: `{"a": 1} and also {"b": 2}`. This silently breaks `summarizeCall`,
`draftCertificate`, and `analyzeDocument` when the model adds explanatory text
around its JSON.

**The fix:**
Use a non-greedy match, or better — find the first `{` and match to the
corresponding `}` by counting nesting depth:

```ts
private extractJson(text: string): string {
  // Try to find a complete JSON object by counting braces
  const start = text.indexOf('{');
  if (start === -1) return '{}';

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  // Fallback: try the whole text
  return text.slice(start);
}
```

**Why this matters:** If the AI wraps its JSON in markdown fences or adds a
sentence before/after, the parse fails silently and the tool returns garbage.

---

### Bug B5 — `toDataUrl` blocks the event loop with `readFileSync`

**Where:** `apps/backend/src/modules/ai/ai.service.ts:367`

**What's wrong:**
`fs.readFileSync(path)` is used inside an async method. For a 10 MB medical
image, this freezes the entire Node.js process until the file is read. Under
concurrent requests, this kills throughput. Also, if the file is missing (already
garbage-collected), it throws an unhandled error.

**The fix:**
Make it async and add error handling:

```ts
private async toDataUrl(path: string): Promise<string> {
  const mime = path.endsWith('.png')
    ? 'image/png'
    : path.endsWith('.jpg') || path.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'image/jpeg';
  try {
    const buffer = await fs.promises.readFile(path);
    const base64 = buffer.toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch {
    throw new Error(`Failed to read image at ${path}`);
  }
}
```

**Important:** This changes the return type to `Promise<string>`, so every
caller of `toDataUrl` needs `await`. Search for `toDataUrl` in the file and
update them.

**Why this matters:** Blocking the event loop means one upload slows down every
other request. And a missing file should be a clear error, not a crash.

---

### Bug B6 — Certificate PDF text disappears off the bottom of the page

**Where:** `apps/backend/src/modules/certificates/certificates.service.ts:290`

**What's wrong:**
The `drawWrappedText` method keeps decrementing `cy` (the y position) as it wraps
lines. If the certificate body is long enough, `cy` goes below 0 and pdf-lib
silently ignores the draw call — the text just vanishes.

**The fix:**
Add a bottom boundary check. If we're about to draw below the margin, stop:

```ts
private drawWrappedText(
  page: import('pdf-lib').PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font: import('pdf-lib').PDFFont,
) {
  const bottomMargin = 50; // don't draw below this y
  const words = text.split(/\s+/);
  let line = '';
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, 11) > maxWidth) {
      if (cy < bottomMargin) break; // stop drawing, text won't fit
      page.drawText(line, {
        x,
        y: cy,
        size: 11,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      line = word;
      cy -= lineHeight;
    } else {
      line = test;
    }
  }
  if (line && cy >= bottomMargin) {
    page.drawText(line, {
      x,
      y: cy,
      size: 11,
      font,
      color: rgb(0.15, 0.15, 0.15),
    });
  }
}
```

**Why this matters:** A certificate with a long body silently drops the last
few lines. The doctor and patient see an incomplete document.

---

### Bug B7 — Downloading a certificate crashes if the PDF file was deleted

**Where:** `apps/backend/src/modules/certificates/certificates.controller.ts:43`

**What's wrong:**
`createReadStream(filePath)` throws `ENOENT` if the PDF was deleted from disk
(e.g., after a server restart or disk cleanup). There's no try-catch, so the
user gets a raw 500 error.

**The fix:**
Wrap the file read in a try-catch:

```ts
@Get(':id/pdf')
@Roles('patient', 'doctor')
async pdf(
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
): Promise<StreamableFile> {
  const filePath = await this.certificatesService.pdfPath(
    id,
    user.role === 'patient' ? user.patientId! : undefined,
  );
  try {
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/pdf',
      disposition: `inline; filename="certificate-${id}.pdf"`,
    });
  } catch {
    throw new NotFoundException('Certificate PDF not found on disk');
  }
}
```

**Why this matters:** If a patient tries to download a certificate and the file
is gone, they should see "not found", not a server error.

---

### Bug B8 — Same file-not-found crash for document uploads

**Where:** `apps/backend/src/modules/documents/documents.controller.ts:78`

**What's wrong:**
Same issue as B7. `createReadStream(doc.filePath)` throws `ENOENT` with no
error handling.

**The fix:**
Same pattern as B7:

```ts
@Get(':id/file')
@Roles('patient', 'doctor')
async file(
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
): Promise<StreamableFile> {
  const doc = await this.documentsService.findOwned(
    id,
    user.role === 'patient' ? user.patientId! : undefined,
  );
  try {
    return new StreamableFile(createReadStream(doc.filePath), {
      type: doc.mimeType ?? 'application/octet-stream',
      disposition: `inline; filename="${encodeURIComponent(doc.filename)}"`,
    });
  } catch {
    throw new NotFoundException('Document file not found on disk');
  }
}
```

---

## 4. Frontend bug fixes

---

### Bug F1 — Certificate loading failure shows "No certificates" instead of an error

**Where:** `apps/frontend/src/components/Certificates.tsx:28`

**What's wrong:**
The `load()` function has a `try/finally` but no `catch`. If `GET /api/certificates`
fails (e.g., server 500), the error is swallowed, `loading` becomes `false`, and
`items` stays empty. The user sees "No certificates yet" — which is wrong, there
might be certificates but the request failed.

**The fix:**
Add a `catch` block:

```tsx
const load = useCallback(async () => {
  try {
    setItems(await api<Certificate[]>('/api/certificates'))
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Failed to load certificates')
  } finally {
    setLoading(false)
  }
}, [])
```

**Why this matters:** Users should know when something went wrong, not silently
see an empty state.

---

### Bug F2 — Uploading a 50 MB file crashes the server

**Where:** `apps/frontend/src/components/Uploads.tsx:43`

**What's wrong:**
The upload box says "max 10MB" but there's no client-side check. A user can drop
a 50 MB file, it gets buffered in memory (multer `memoryStorage`), and the
server either runs out of memory or returns a cryptic error.

**The fix:**
Check file size before uploading:

```tsx
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

const handleFiles = async (files: FileList | null) => {
  if (!files || files.length === 0) return
  setBusy(true)
  setError('')
  try {
    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) {
        setError(`${file.name} is too large (max 10 MB)`)
        return
      }
      const fd = new FormData()
      fd.append('file', file)
      const doc = await api<{ _id: string }>('/api/documents/upload', {
        method: 'POST',
        body: fd,
      })
      await api(`/api/documents/${doc._id}/analyze`, { method: 'POST', body: '{}' })
    }
    await load()
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Upload failed')
  } finally {
    setBusy(false)
  }
}
```

**Why this matters:** A 50 MB image in base64 is ~67 MB in the request body.
That's enough to stall the server for other users too.

---

### Bug F3 — Doctor badge polling fetches entire queues just to count them

**Where:** `apps/frontend/src/components/Layout.tsx:100`

**What's wrong:**
Every 20 seconds, the doctor sidebar badge loads the full `/api/appointments/queue`
and `/api/verification/queue` — complete with all `populate()` joins — just to
read `.length`. This sends a lot of unnecessary data over the wire and puts load
on the database.

**The fix:**
There's already a `/api/verification/summary` endpoint that returns counts. Use
that instead. For appointments, you can add a similar summary endpoint or just
use the queue endpoint but only read the length:

```tsx
useEffect(() => {
  if (!user) return
  const load = async () => {
    try {
      if (user.role === 'doctor') {
        const [summary, q] = await Promise.all([
          api<{ pending: number }>('/api/verification/summary'),
          api<unknown[]>('/api/appointments/queue'),
        ])
        setBadge({ '/doctor/callbacks': q.length, '/doctor/verify': summary.pending })
      }
    } catch {
      /* ignore */
    }
  }
  load()
  const t = setInterval(load, 20000)
  return () => clearInterval(t)
}, [user])
```

**Why this matters:** On a slow connection or with many patients, loading the
full queue every 20 seconds just for a count wastes bandwidth and makes the
sidebar feel sluggish.

---

## 5. Tests to write

Tests here never touch the database or the network. We replace those with fakes.
Copy the pattern from existing spec files like
[ai.service.spec.ts](apps/backend/src/modules/ai/ai.service.spec.ts).

---

### Test file 1 — `apps/backend/src/modules/appointments/appointments.service.spec.ts`

This file doesn't exist yet. Create it.

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { getModelToken } from '@nestjs/mongoose';
import { DoctorsService } from '../doctors/doctors.service';
import { PatientsService } from '../patients/patients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let appointmentModel: any;

  const mockAppointment = (overrides: Record<string, any> = {}) => ({
    _id: 'apt-1',
    patient: 'pat-1',
    doctor: null,
    status: 'requested',
    callBackJob: { preferredWindow: 'today' },
    save: jest.fn().mockResolvedValue(true),
    populate: jest.fn().mockReturnThis(),
    toObject: jest.fn().mockReturnThis(),
    ...overrides,
  });

  beforeEach(async () => {
    appointmentModel = {
      find: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockReturnThis(),
      findById: jest.fn().mockReturnThis(),
      findByIdAndUpdate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: getModelToken('Appointment'), useValue: appointmentModel },
        { provide: DoctorsService, useValue: { findById: jest.fn() } },
        { provide: PatientsService, useValue: { findById: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  describe('assign', () => {
    it('rejects if appointment is not in requested status', async () => {
      const apt = mockAppointment({ status: 'assigned' });
      appointmentModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(apt) });

      await expect(service.assign('doc-1', 'apt-1')).rejects.toThrow(BadRequestException);
    });

    it('assigns a doctor when status is requested', async () => {
      const apt = mockAppointment();
      appointmentModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(apt) });

      // Mock the follow-up calls
      const module = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          { provide: getModelToken('Appointment'), useValue: appointmentModel },
          { provide: DoctorsService, useValue: { findById: jest.fn().mockResolvedValue({ _id: 'doc-1', title: 'Dr.', firstName: 'Rohan', lastName: 'Mehta', specialty: 'Cardiology' }) } },
          { provide: PatientsService, useValue: { findById: jest.fn().mockResolvedValue({ _id: 'pat-1', user: 'user-1' }) } },
          { provide: NotificationsService, useValue: { create: jest.fn() } },
        ],
      }).compile();
      service = module.get<AppointmentsService>(AppointmentsService);

      const result = await service.assign('doc-1', 'apt-1');
      expect(apt.status).toBe('assigned');
      expect(apt.save).toHaveBeenCalled();
    });
  });
});
```

**Why these tests matter:** The assign race condition is the most dangerous
bug in the appointment flow. These tests pin the fix.

---

### Test file 2 — Add to `apps/backend/src/modules/ai/ai.service.spec.ts`

Add these test cases to the existing file:

```ts
describe('extractJson', () => {
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
```

**Why these tests matter:** The greedy regex bug is silent — it doesn't crash,
it just returns wrong data. These tests catch that.

---

### Test file 3 — `apps/backend/src/modules/conversations/conversations.service.spec.ts`

Add these test cases to the existing file:

```ts
describe('getOrCreate', () => {
  it('handles duplicate key race condition gracefully', async () => {
    const existing = { _id: 'conv-1', patient: 'pat-1' };
    conversationModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    conversationModel.create.mockRejectedValue({ code: 11000 }); // duplicate key
    conversationModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
    conversationModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(existing) });

    const result = await service.getOrCreate('pat-1');
    expect(result).toBe(existing);
  });
});
```

**Why this test matters:** Without the unique index fix, this race condition
can't even be tested. With the fix, this test proves the retry logic works.

---

### Frontend tests — not required for this task

Frontend tests are a separate effort. The three frontend fixes (F1, F2, F3)
are simple enough to verify by hand:

- **F1:** Kill the backend, open Certificates page, confirm you see an error
  message instead of "No certificates"
- **F2:** Try uploading a file larger than 10 MB, confirm you see a size error
- **F3:** Open doctor sidebar, confirm badges still update (check network tab —
  should hit `/api/verification/summary` instead of the full queue)

---

## 6. Files you own

**Yours — edit freely:**

| File | What it is |
|---|---|
| `apps/backend/src/modules/appointments/appointments.service.ts` | Bug B1 |
| `apps/backend/src/modules/conversations/schemas/conversation.schema.ts` | Bug B2 |
| `apps/backend/src/modules/conversations/conversations.service.ts` | Bug B2 retry logic |
| `apps/backend/src/main.ts` | Bug B3 |
| `apps/backend/src/modules/ai/ai.service.ts` | Bugs B4, B5 |
| `apps/backend/src/modules/certificates/certificates.service.ts` | Bug B6 |
| `apps/backend/src/modules/certificates/certificates.controller.ts` | Bug B7 |
| `apps/backend/src/modules/documents/documents.controller.ts` | Bug B8 |
| `apps/frontend/src/components/Certificates.tsx` | Bug F1 |
| `apps/frontend/src/components/Uploads.tsx` | Bug F2 |
| `apps/frontend/src/components/Layout.tsx` | Bug F3 |
| `apps/backend/src/modules/appointments/appointments.service.spec.ts` | New test file |
| Additions to `apps/backend/src/modules/ai/ai.service.spec.ts` | Extra tests |
| Additions to `apps/backend/src/modules/conversations/conversations.service.spec.ts` | Extra tests |

**Please don't edit — someone else is working in them:**

- `apps/backend/src/modules/chat/` — the chat agent
- `apps/backend/src/modules/calls/` — voice call pipeline
- `apps/backend/src/modules/documents/documents.service.ts` — Pritha's domain
- `apps/backend/src/modules/ai/ai.service.spec.ts` — make additions in a clearly
  separate `describe` block, don't modify existing tests

---

## 7. Commands

```bash
docker compose up -d                              # start MongoDB
npm run seed --workspace @iem-hacks/backend        # demo data, safe to re-run
npm run dev                                        # backend :3000, frontend :5173
```

While working, in `apps/backend`:

```bash
npx jest appointments          # just your new tests
npx jest ai                    # your additions to ai tests
npx jest conversations         # your additions to conversation tests
npx jest                       # all tests — these must stay green
npx tsc --noEmit -p tsconfig.json   # type errors without building
```

---

## 8. Checklist

- [ ] `assign()` rejects when status is not `requested`
- [ ] `Conversation.patient` has `unique: true`
- [ ] `getOrCreate` handles duplicate key error gracefully
- [ ] Malformed `:id` returns 404, not 500
- [ ] `extractJson` doesn't grab multiple JSON objects
- [ ] `toDataUrl` is async and handles missing files
- [ ] Certificate PDF text stops at bottom margin, doesn't disappear
- [ ] Certificate PDF download returns 404 when file is missing
- [ ] Document file download returns 404 when file is missing
- [ ] Certificates page shows error message on load failure
- [ ] Upload rejects files over 10 MB before sending to server
- [ ] Doctor badge polling uses summary endpoint where possible
- [ ] All new tests pass, all existing tests still pass
- [ ] `tsc` is clean (no type errors)

---

## 9. Two habits we follow

**Leave a note when you take a shortcut.** Say what the limit is and what would
replace it:

```ts
// ponytail: stopped at y=50 margin — full pagination needs pdf-lib page breaking
```

**Leave one test behind for anything non-trivial.** Not a full suite — just the
smallest test that fails if the logic breaks.

Stuck for more than ~30 minutes? Ask. That's faster than guessing, and in a
hackathon it's the whole game.
