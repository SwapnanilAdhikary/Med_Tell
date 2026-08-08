# Pritha's task — Medical report upload & AI reading

Welcome! You own one complete feature, end to end:

> A patient photographs a lab report on their phone → our AI reads it → a doctor
> checks what the AI said.

This doc explains the feature, the one thing that's broken, and a step-by-step
plan. Anything unfamiliar is explained inline. Ask rather than guess — a wrong
guess in a medical app is worse than a question.

**Before you start:** get the app running with [SETUP.md](SETUP.md), log in as a
patient, and click around `/uploads`. Seeing it helps more than reading about it.

---

## 1. Words you'll see in this doc

| Word | What it means here |
|---|---|
| **Endpoint** | One URL the frontend can call, e.g. `POST /api/documents/analyze` |
| **Service** | A backend class holding the actual logic. Controllers just receive the request and hand off to a service |
| **Multer** | The library that receives uploaded files in a NestJS request |
| **MIME type** | A string naming a file's kind: `image/png`, `image/jpeg`, `application/pdf` |
| **base64** | A way of writing binary data as plain text, so we can put an image inside a JSON request to OpenAI. Makes the data ~33% bigger |
| **Vision model** | An AI model that accepts images, not just text. We use OpenAI's `gpt-4o-mini` |
| **Idempotent** | Doing it twice has the same effect as doing it once. Our code isn't, and should be |
| **DTO** | A small class describing an allowed request body, so bad input is rejected before it reaches your logic |
| **Spec file** | A test file, named `something.spec.ts`, living next to the code it tests |

---

## 2. The most important decision: we throw the image away

**We are not storing patient images. No S3, no cloud bucket, no file saved on the
server.**

The flow is: image arrives from the phone → AI reads it → we save **only what the
AI understood** → the image is gone.

Why: medical images are among the most sensitive data there is. If we never keep
them, we can never leak them. It also means no storage bill and no cleanup job.

### What this means for your code

Right now the code does the opposite — it saves every upload into
`apps/backend/uploads/` and keeps it forever. **Changing that is part of your
task.**

It also means upload and analysis must become **one single request**, not two.
Here's why that matters:

Today there are two endpoints:

```
1. POST /api/documents/upload        → saves the file, returns an id
2. POST /api/documents/:id/analyze   → reads that saved file, calls the AI
```

Step 2 can only work because step 1 left the file lying around. If we're not
keeping files, there's nothing for step 2 to read. So the two must merge:

```
POST /api/documents/analyze     ← one request does everything
  ↓ file arrives in the server's memory (never written to disk)
  ↓ converted to base64, sent to OpenAI vision
  ↓ we save the findings (text, summary, abnormal values) to MongoDB
  ↓ we create a task so a doctor reviews it
  ↓ the image data is dropped
```

Multer supports this directly: swap `diskStorage` for **`memoryStorage`** and the
file shows up as `file.buffer` in memory instead of as a path on disk. This is
better than "save it then delete it", because there's no leftover file if the
delete step ever fails.

### The trade-off you should know about

Because the image is gone, **the doctor can't look at the original report.** They
can only see the text the AI extracted.

That makes `aiFindings.text` — the raw text the AI read off the image — the *only
surviving record of what the document said*. So getting that field filled in
properly isn't a nice-to-have, it's the whole point. Keep that in mind through
Phase 1.

I raised this with Swapnanil and the call is: discard the image. That's settled —
build it that way. Just be aware of *why* the text field matters so much.

> **Not affected:** certificate PDFs that *we* generate stay saved on disk, because
> the patient has to download them. Only *uploaded* patient images are discarded.

---

## 3. What already works

Good news — the upload half is solid. I tested it with a real 42 KB lab-report
image and got back:

```
id=6a758dded793479fb5f1be79   mime=image/png   size=42219   status=pending
```

Working and verified:

- The file reaches the server, and a database record is created with the filename,
  MIME type and size
- `GET /api/documents` lists a patient's own reports
- **Access control is correct.** I tested this specifically: the owner gets the
  file (200), a *different* patient gets "not found" (404), a doctor gets it (200),
  and no login gets rejected (401). Patients cannot read each other's reports
- The frontend "View" button sends the login token properly

You'll be deleting some of this in Phase 3 (the file-serving part) — that's fine,
it's not wasted, it's how we learned the access rules are right.

---

## 4. What's broken: the AI reads nothing

This is your main problem to solve.

I uploaded a clear blood-test image with obvious abnormal values (haemoglobin 9.1,
low; WBC 11800, high). The AI came back completely empty:

```json
{
  "docType": "other",
  "text": "",
  "summary": "No text available for analysis.",
  "abnormalFindings": [],
  "recommendations": [],
  "confidence": 0
}
```

Notice it didn't crash. It *politely returned nothing*, which is harder to spot
than an error.

### What I already ruled out

So you don't repeat this work:

- ✅ The file was really there — 42219 bytes, correct path
- ✅ The MIME type was `image/png`, so it took the image path, not the PDF path
- ✅ Our OpenAI key works fine — the chat assistant and call summaries both work
- ✅ The AI's reply was valid JSON, so our parsing code is fine

### What I did NOT figure out

**I ran out of time before proving why.** I don't know yet whether OpenAI is
actually receiving the image. Don't treat my guesses below as the answer — go
prove it in Phase 0 first.

### My best guess (unconfirmed)

Look at [ai.service.ts:291](apps/backend/src/modules/ai/ai.service.ts#L291). We
send the AI a message containing **only an image and no words**:

```ts
{
  role: 'user',
  content: [
    { type: 'image_url', image_url: { url: this.toDataUrl(imagePath) } },
  ],
}
```

The reply "No text available for analysis" sounds exactly like a model that thinks
it was handed nothing at all. Vision models normally expect a question *alongside*
the picture — something like *"Read this document."* My guess is that adding a text
part next to the image fixes it. Phase 0 tests that in five minutes.

Two backup theories if that's not it:

1. **The image data is labelled wrong.** `toDataUrl`
   ([ai.service.ts:367](apps/backend/src/modules/ai/ai.service.ts#L367)) decides
   the MIME type by looking at the *filename ending*, and falls back to
   `image/jpeg` for anything it doesn't recognise. Our test file ended in `.png`
   so this probably wasn't the cause here — but it *is* a genuine bug for real
   users, because iPhone photos end in `.heic` and would get mislabelled as JPEG.
   You'll fix that in Phase 3.
2. **The model is struggling with dense text.** Possible, but unlikely — that
   would give us *partial* text, not an empty string. Check this last.



   ---

### Phase 0 result (Pritha) — CANNOT REPRODUCE on current main

Two real uploads through `POST /documents/upload` + `POST /:id/analyze`:

| Test image | Result |
|---|---|
| 26 KB synthetic CBC | `confidence: 0.95`, full text, both abnormals found |
| 63 KB realistic consolidated medical record | `confidence: 0.90`, full text, real findings |

Both succeeded. The empty-findings bug did not occur.

**What the probe showed** (`scratch/probe.js` — no system prompt, image only):

| Sent | Simple CBC | Realistic record |
|---|---|---|
| bare image, no text part | works | **"I'm unable to assist with that."** |
| image + text part | works | works |

So a bare image *can* trigger a refusal — but only on a realistic
document with patient identifiers, and only when nothing else gives the
model context.

**Why production still works:** `analyzeDocument` sends a system prompt
("You are a medical document analysis assistant... respond ONLY with
strict JSON") *before* the image. That appears to supply enough context
on its own, so the missing text part in the user message doesn't bite.
The probe had no system prompt, which is why it refused.

**Failure chain if a refusal ever does happen:** model replies in prose,
not JSON → `extractJson` finds no braces → returns `'{}'` → every field
empty, `confidence: 0` → no exception thrown → the doc is still marked
`awaiting-doctor` and still queued for a doctor. This is exactly the
Phase 2 problem, and it is real regardless of whether the refusal is.

**Ruled out:**
- MIME labelling — multer preserves the extension, so `toDataUrl` labels correctly
- The 70-byte files in `uploads/` are seed placeholders (1×1 pixels). Don't test against them.

**Open question for @Swapnanil:** can you share the exact 42 KB image you
tested with? I can't make it fail. If the refusal is intermittent, adding
a text part alongside the image is still worth doing as cheap insurance —
which is what Phase 1 will do.

---

## 5. The plan

Six phases. Do them in order; each builds on the last. Commit after each one.

---

### Phase 0 — Find out why (start here, ~30 min)

Don't change any project code yet. Write a throwaway script that talks to OpenAI
directly, so you see the raw reply with nothing in the way.

Make a folder `apps/backend/scratch/` (it's gitignored — nothing here gets
committed) and create `probe.js`:

```js
// Run from apps/backend:  node scratch/probe.js /tmp/report.png
require('dotenv/config')
const fs = require('node:fs')
const OpenAI = require('openai')

const b64 = fs.readFileSync(process.argv[2]).toString('base64')
const url = `data:image/png;base64,${b64}`
console.log('data url starts:', url.slice(0, 40))
console.log('data url length:', url.length)

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

;(async () => {
  // Try it both ways: image alone, then image + a question.
  for (const withText of [false, true]) {
    const content = withText
      ? [
          { type: 'text', text: 'Read this medical document and list every value you can see.' },
          { type: 'image_url', image_url: { url } },
        ]
      : [{ type: 'image_url', image_url: { url } }]

    const res = await client.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content }],
      temperature: 0,
    })
    console.log(`\n=== text part included: ${withText} ===`)
    console.log(res.choices[0].message.content?.slice(0, 600))
  }
})()
```

You need a test image with real readable text. This recipe uses only tools already
on macOS, and I've verified it works:

```bash
cd /tmp
cat > report.txt <<'EOF'
        CITY DIAGNOSTIC CENTRE, KOLKATA
        COMPLETE BLOOD COUNT (CBC)
Patient : Priya Sharma        Age/Sex : 34 / F
TEST                RESULT      UNIT      REFERENCE
Haemoglobin          9.1  L     g/dL      12.0 - 15.0
WBC Count          11800  H     /uL       4000 - 11000
IMPRESSION: Microcytic hypochromic anaemia.
EOF
cupsfilter report.txt > report.pdf 2>/dev/null
sips -s format png report.pdf --out report.png
```

Whichever version prints the real blood values is your answer.

**When you find it, write the answer down in §4 of this file and push it.** Nobody
should have to rediscover this.

---

### Phase 1 — Make the AI actually read the image

Apply whatever Phase 0 revealed, inside `AiService.analyzeDocument`
([ai.service.ts:267](apps/backend/src/modules/ai/ai.service.ts#L267)).

⚠️ **Keep the shape of the result exactly as it is.** These eight field names are
read by three different screens already built by other people:

```ts
docType, text, summary, abnormalFindings, recommendations, confidence, disclaimer, language
```

They're defined as `AiFindings` in
[medical-document.schema.ts](apps/backend/src/modules/documents/schemas/medical-document.schema.ts).
Renaming or removing one silently breaks the doctor's review screen. If you truly
need a change here, raise it at standup first.

**Done when:** uploading the CBC image gives you `confidence` above 0, a non-empty
`text`, and `abnormalFindings` that mentions the low haemoglobin.

---

### Phase 2 — Stop pretending failure is success

Do this even if Phase 1 goes smoothly, because it protects us if the AI has a bad
day.

Right now, when the AI returns nothing, the code carries on as if all is well. I
confirmed in the database that the empty result still got marked
`awaiting-doctor` **and** still created a review task. So a doctor opens their
queue and finds a task with nothing in it, and the patient is never told anything
went wrong.

Three fixes in `DocumentsService`:

1. **Treat an empty reading as a failure.** If there's no `text` and `confidence`
   is 0, don't save findings and don't create a doctor task — return an error so
   the patient can retry. Right now `verificationService.create` runs
   unconditionally
2. **Make it idempotent.** Calling analyse twice currently creates **two** review
   tasks for the same report. Skip the work if findings already exist
3. **Use the status that already exists.** `'ai-reviewed'` is listed in the
   allowed statuses but is never set. Use it, so the states become
   `pending → ai-reviewed → awaiting-doctor → approved/rejected`. Then "the AI
   finished" and "a doctor needs to look" stop being the same thing

The frontend already has a place to show an error in `Uploads.tsx` — connect the
real message to it.

**Done when:** a failed reading leaves nothing in the doctor's queue, the patient
sees a clear "couldn't read that, please try again" message, and analysing twice
never creates two tasks.

---

### Phase 3 — Switch to never storing the image

This is the §2 decision, in code. Do it after Phase 1 works, so you're not
debugging two things at once.

1. **Merge the two endpoints into one.** Replace
   `POST /upload` + `POST /:id/analyze` with a single `POST /api/documents/analyze`
   that takes the file and does everything
2. **Use `memoryStorage`.** In
   [documents.module.ts](apps/backend/src/modules/documents/documents.module.ts),
   replace `diskStorage` with `memoryStorage()`. Then delete the `UPLOAD_DIR`
   constant and the folder-creation code
3. **Send the buffer, not a path.** `AiService.analyzeDocument` currently takes a
   file path and reads from disk. Add an overload (or change it — this method is
   yours) so it accepts the buffer and MIME type directly. Read the MIME from
   `file.mimetype`, which multer gives you, instead of guessing from the filename.
   That also fixes the `.heic` mislabelling
4. **Delete the file-serving route.** Remove `GET /:id/file` from the controller,
   drop `filePath` from the schema (it's `required: true` today, so that must
   change), and remove the "View" buttons from `Uploads.tsx` and
   `doctor/Records.tsx`
5. **Remove the static file server.** In
   [app.module.ts](apps/backend/src/app.module.ts), delete the
   `ServeStaticModule` block that publishes `/uploads` — it currently serves
   patient images to anyone who knows a URL, with no login at all. This kills
   security gap #8 in [ARCHITECTURE.md](ARCHITECTURE.md)
6. **Fix the seed script.** `seed.ts` writes placeholder image files so the old
   View button worked. Those aren't needed — remove the file writing and the
   `PLACEHOLDER_PNG` constant, and keep just the database records with findings

Also add a **file type filter**, which doesn't exist at all right now (I checked —
zero occurrences of `fileFilter`). Today *any* file type is accepted and only
fails later at the AI call. Accept `image/png`, `image/jpeg`, `image/webp`; reject
everything else with a clear 400 error. For `.heic` (iPhone photos), the honest
move is to reject it with "please upload a JPG or PNG" — converting HEIC needs a
heavy native library and isn't worth it for the demo.

One more thing: base64 makes data about a third bigger, and the whole image sits
in memory during the request. The limit is currently 10 MB, meaning ~13 MB per
request. Consider dropping it to 5 MB.

**Done when:** `apps/backend/uploads/` stays empty after an upload, `/uploads/…`
returns nothing, the doctor's queue still shows AI findings, and no screen has a
dead "View" button.

---

### Phase 4 — PDF reports (only if 0–3 are done)

Right now [documents.service.ts:50](apps/backend/src/modules/documents/documents.service.ts#L50)
detects PDFs and returns a fixed fake message: *"PDF documents require manual
review"* with `confidence: 0`. But the upload box advertises PDF as allowed, so
users hit a dead end.

`pdf-lib` is already installed but it can only *create* PDFs, not read them.
Options, easiest first:

1. **Be honest.** Accept the PDF, tell the user it goes straight to a doctor, and
   don't invent a findings object at all. Zero new dependencies
2. **Extract the text layer** with `pdfjs-dist` and `getTextContent()`. Pure
   JavaScript, no native build. Works for PDFs generated by a computer — which is
   most lab reports emailed to patients. Won't work on scanned PDFs, which are
   really just images in a wrapper
3. **Convert page 1 to an image** and reuse your vision code. Handles scans too,
   but needs a native `canvas` build

Option 2 is the sweet spot. **Ask before adding any native dependency** — it
changes the install for everyone on the team.

---

### Phase 5 — Show the report in the chat (optional, if time allows)

When a patient uploads through the chat screen, the report doesn't appear in the
conversation. The `attachments` field exists on messages and there's even an
`AttachmentRef` type ready in
[message.schema.ts](apps/backend/src/modules/conversations/schemas/message.schema.ts) —
but I checked all three places messages get created and every one passes an empty
array.

The fix is small, but it lives in `ChatService`, which is **not your file**.
Coordinate with Swapnanil before touching it.

---

## 6. Tests to write

Two new test files. Tests here never touch the database or the network — we
replace those with fakes, so tests run in about a second.

Copy the setup pattern from
[ai.service.spec.ts](apps/backend/src/modules/ai/ai.service.spec.ts) — it already
shows how to fake OpenAI:

```ts
// Replace the real OpenAI client with a fake one after the service is built
;(service as unknown as { client: unknown }).client = {
  chat: { completions: { create: fakeCreate } },
}
```

### File 1 — `apps/backend/src/modules/ai/analyze-document.spec.ts`

- sends **both a text part and the image** (this pins your Phase 1 fix so a future
  change can't silently undo it)
- labels a PNG as `image/png` and a JPEG as `image/jpeg`, taken from the real MIME
  type rather than the filename
- still parses the findings when the AI wraps its JSON in ```` ```json ```` fences
- throws a clear error if the image data is empty, instead of returning blank findings

### File 2 — `apps/backend/src/modules/documents/documents.service.spec.ts`

Fake these: the Mongoose model, `AiService`, `VerificationService`,
`PatientsService`, `NotificationsService`.

- an image goes to the vision model and its findings get saved
- a PDF does **not** call the vision model
- **empty findings ⇒ nothing saved and no doctor task created** (Phase 2)
- **analysing twice ⇒ still only one doctor task** (Phase 2)
- a patient asking for someone else's report gets `NotFoundException`; a doctor
  (no patient id passed) gets it
- approving a report notifies the owning patient with `type: 'document'`

### Write this one first

This single test *is* the bug. Write it, watch it fail, then fix the code until it
passes. That's the most reliable way to know you actually fixed something:

```ts
it('does not queue a report for a doctor when the AI read nothing', async () => {
  aiService.analyzeDocument.mockResolvedValue({
    text: '',
    confidence: 0,
    summary: 'No text available for analysis.',
  })

  await expect(service.analyze('doc-1', 'en')).rejects.toThrow()
  expect(verificationService.create).not.toHaveBeenCalled()
})
```

---

## 7. Which files are yours

**Yours — edit freely:**

| File | What it is |
|---|---|
| [apps/backend/src/modules/documents/](apps/backend/src/modules/documents/) | the whole module |
| `AiService.analyzeDocument`, `toDataUrl` | [ai.service.ts:267-375](apps/backend/src/modules/ai/ai.service.ts#L267) |
| [apps/frontend/src/components/Uploads.tsx](apps/frontend/src/components/Uploads.tsx) | the upload screen |
| the two new `.spec.ts` files above | |
| the `ServeStaticModule` block in `app.module.ts` | Phase 3 deletes it |
| the document section of `seed.ts` | Phase 3 simplifies it |

**Please don't edit — someone else is working in them right now:**

- `AiService.runAgent`, `tools()`, `buildSystemPrompt` — the chat assistant
- `ChatService.executeAction`
- `appointments/`, `calls/`, `doctors/`, `verification/`
- `ai.service.spec.ts` — make a **new** spec file instead

If you need something new from `AiService`, **add a new method** rather than
changing an existing one's inputs. Other code calls those.

---

## 8. Commands

```bash
docker compose up -d                              # start MongoDB
npm run seed --workspace @iem-hacks/backend        # demo data, safe to re-run
npm run dev                                        # backend :3000, frontend :5173
```

While working, in `apps/backend`:

```bash
npx jest documents          # just your tests
npx jest                    # all 58 — these must stay green
npx tsc --noEmit -p tsconfig.json   # type errors without building
```

Test it by hand (patient `+919876543210`, password `demo123`):

```bash
API=http://localhost:3000/api
PT=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"phone":"+919876543210","password":"demo123"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

# After Phase 3 this becomes a single call:
curl -s -X POST $API/documents/analyze -H "Authorization: Bearer $PT" \
  -F "file=@/tmp/report.png" | node -pe "
JSON.stringify(JSON.parse(require('fs').readFileSync(0)).aiFindings, null, 2)"
```

Then log in as a doctor (`+919800000001`, `demo123`) and open **Verify** to see
your findings in their review queue. That's the real proof it works.

---

## 9. Checklist

- [x] The reason the AI read nothing is written into §4 of this file
- [x] A real lab-report image produces a genuine summary, abnormal values, and
      `confidence` above 0
- [x] A failed reading saves nothing, queues nothing, and tells the patient
- [x] Analysing the same report twice never creates two doctor tasks
- [x] `apps/backend/uploads/` is empty after an upload, and `/uploads/…` serves nothing
- [x] No dead "View" buttons anywhere
- [x] Unsupported file types rejected at upload with a clear message
- [x] PDFs either work or say honestly they go to a doctor — no fake findings
- [x] Both new test files pass, all 58 existing tests still pass, `tsc` is clean

---

## 10. Two habits we follow

**Leave a note when you take a shortcut.** Say what the limit is and what would
replace it:

```ts
// ponytail: rejecting HEIC outright — converting needs a native dep.
// Revisit if iPhone uploads become common.
```

**Leave one test behind for anything non-trivial.** Not a full suite — just the
smallest test that fails if the logic breaks.

Stuck for more than ~30 minutes? Ask. That's faster than guessing, and in a
hackathon it's the whole game.
