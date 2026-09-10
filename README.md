# AI Interview Prep Kit

**Live app:** https://web-one-puce-91.vercel.app

Turns a pasted job description + a company URL into a structured interview prep kit: a
company brief, a categorised question bank, flashcards, and a day-by-day study schedule â€”
generated through a sequence of retrieval and generation steps, not a single prompt.

## Tech stack

Matches the brief's preferred stack, no substitutions:

- **Frontend:** Next.js 14 (App Router) + Tailwind CSS
- **Backend:** Node.js + Express, TypeScript throughout
- **Database:** MongoDB (Mongoose)
- **Scraping:** `cheerio` for parsing + a custom link-ranking crawler (no headless browser â€”
  static HTML parsing is sufficient for company marketing/careers pages and keeps the batch
  command fast)
- **LLM:** Groq, free tier (see below)

Two structural choices worth flagging:

- **Frontend and backend are separate deployables** (`web/` is its own Next.js app; the
  repo root is the Express API). This wasn't strictly required by the brief, but it maps
  cleanly onto free-tier hosting: Vercel for Next.js, Render for the API â€” each optimized
  for what it's hosting rather than forcing one platform to do both.
- **Zod is used for two different jobs with one library:** validating incoming API
  requests, and validating the generated kit against the Appendix A structure. One
  dependency, one mental model, instead of a request-validation library plus a separate
  schema library.

## LLM provider and model

**Groq**, `llama-3.3-70b-versatile` for the reasoning-heavy steps (requirement extraction,
question generation, coverage-gap analysis). Chosen because Groq's free tier requires no
credit card and no per-token billing â€” it's rate-limited only (30 RPM, ~12k TPM for this
model), which the brief explicitly warns is the main way to lose points if handled naively.

That rate limit shaped a real design decision: `core/generation/groqClient.ts` runs every
LLM call in this process through **one shared, process-wide queue** â€” not per-request, not
per-pipeline-run. Groq's limits apply per organization account regardless of how many kits
are generating concurrently, so two kits "generating at once" still hit Groq one call at a
time. On top of that:

- **Proactive throttling** â€” every response's `x-ratelimit-remaining-*` headers are read
  and used to self-pace *before* hitting a wall, not just react after a 429.
- **Reactive backoff** â€” an actual 429 triggers exponential backoff + jitter, respecting
  the `retry-after` header, capped at a small number of retries.
- **Separately**, malformed/invalid JSON output gets one corrective re-prompt (the schema
  validation error is fed back to the model) before the caller is allowed to degrade that
  step gracefully rather than crash the whole kit.

## Setup

### Backend (repo root)

```bash
npm install
cp .env.example .env
# fill in GROQ_API_KEY, MONGODB_URI, SESSION_SECRET (see .env.example for how to generate each)
npm run dev          # starts the API on :4000
npm test             # runs the full unit test suite
npm run evaluate -- --input fixtures/sample-cases.json --output kits.json   # batch command
```

### Frontend (`web/`)

```bash
cd web
npm install
cp .env.local.example .env.local
# set NEXT_PUBLIC_API_URL to the backend URL (defaults to http://localhost:4000)
npm run dev           # starts the frontend on :3000
```

### Deployed

- **Backend â†’ Render.** `render.yaml` at the repo root defines the service (free plan,
  `npm install && npm run build` / `npm start`, health check at `/health`). Set
  `GROQ_API_KEY`, `MONGODB_URI`, `SESSION_SECRET`, and `FRONTEND_ORIGIN` (the deployed
  Vercel URL) as secrets in the Render dashboard â€” they're deliberately not synced from
  `render.yaml` since they're credentials.
- **Frontend â†’ Vercel.** Standard zero-config Next.js deploy from the `web/` directory. Set
  `NEXT_PUBLIC_API_URL` to the deployed Render URL in the Vercel project's environment
  variables.
- **Database â†’ MongoDB Atlas free tier.**

One cross-domain detail worth calling out because it's an easy trap: Vercel and Render are
different domains, so the session cookie needs `sameSite: "none"` + `secure: true` in
production (`server/middleware/auth.ts`) â€” `"lax"` works perfectly in local dev and
silently breaks auth the moment you deploy, since same-site cookies just don't get sent
cross-domain. Also: `server/app.ts` refuses to start in production if `FRONTEND_ORIGIN`
isn't set, rather than silently falling back to permissive CORS with credentials enabled.

## Architecture

```
web/ (Next.js)  ->  REST + SSE  ->  Express API  ->  core/pipeline/runPipeline()
                                         |                    |
                                    Mongo (Kit,          retrieval / generation /
                               GenerationRun, User)      scheduling / validation
```

The one thing everything else hangs off: **`core/pipeline/runPipeline()` is the single
orchestrator both the web API and the batch CLI (`npm run evaluate`) call.** Neither one
re-implements pipeline logic â€” the web route just adds persistence and SSE progress on top,
and the batch script just adds file I/O. This is a direct requirement (Section 9: "the same
code your application uses, not a parallel implementation"), and it also means a bug fixed
in one path is fixed in both.

```
src/
  core/
    pipeline/runPipeline.ts       - the orchestrator
    retrieval/crawlAndRank.ts     - company site crawler + link ranker
    generation/                   - LLM-calling steps + the Groq client
    scheduling/buildSchedule.ts   - deterministic day allocation
    builder/kitState.ts           - generated/edited/manual/locked state model
    validation/kitSchema.ts       - Appendix A schema + referential validation
  models/                         - Mongoose schemas
  server/                         - Express routes/controllers/services, SSRF-guarded fetch
  lib/security.ts                 - SSRF guard
scripts/evaluate.ts                - the batch entry point
web/                                - Next.js frontend
```

## Retrieval approach

No hardcoded path list for the hiring page â€” the brief is explicit that this is
insufficient, and it's right: one company URL tested during design returned a 404 at a
guessed path, while GitLab and PostHog publish detailed hiring info at unpredictable paths.
Instead, `crawlAndRank.ts` does:

1. **BFS crawl** from the homepage, same-origin only, depth-limited, respecting
   `robots.txt`, rate-limited with a politeness delay between requests.
2. **Stage 1 scoring** (cheap, pre-fetch): every discovered link is scored by URL path and
   anchor text against hiring/about keyword lists. This decides fetch *order* under a tight
   page-count budget â€” promising links get fetched first.
3. **Stage 2 scoring** (informed, post-fetch): after fetching a candidate page, it's
   re-scored using its actual content (keyword density for hiring/interview-process
   language). This catches pages an unhelpful URL would hide (e.g. a generic `/life` page
   that happens to be the hiring page) and demotes URL-based false positives.

Public interview-discussion search is wired as an injectable dependency
(`searchInterviewDiscussion` in `PipelineDependencies`) but not implemented against a real
search provider in this pass â€” see Known Limitations.

**Sources actually used per kit:** recorded in `source.pages_used` on the generated kit
itself (Appendix A), so every kit is self-documenting about what it was built from.

## Sequencing (Section 3)

The pipeline is a sequence of deliberate steps, not one prompt:

1. **Extract requirements** from the pasted JD (no retrieval needed â€” it's already text)
2. **Crawl the company site** (a homepage needs crawling before it's useful)
3. **Search for public interview discussion**
4. **Generate the company brief** from whatever was actually found â€” skips the LLM call
   entirely if nothing useful was found, rather than asking a model to summarize zero
   source material (which just produces confident-sounding fabrication)
5. **Generate questions, per category, per requirement subset** â€” technical and
   behavioural requirements get separate LLM calls with separate instructions, because "5+
   years of React" and "mentors junior engineers" genuinely need different question-writing
   guidance, not the same prompt with a category label swapped in
6. **Coverage-check loop** â€” deterministic gap-finding (`coverageCheck.ts`), then a
   targeted follow-up generation call for any uncovered must-have requirement, re-checked,
   up to a capped number of passes (default 3)
7. **Derive flashcards deterministically** from the final question set (see trade-off below)
8. **Build the schedule** â€” deterministic, no LLM
9. **Validate** against Appendix A before returning

Two steps are explicitly *not* LLM calls, per the brief's instruction that allocation and
gap-finding are the code's job: `coverageCheck.ts` and `buildSchedule.ts` are pure
functions with no network/LLM dependency, which also makes them the cheapest, most reliable
things in the system to unit test.

## Generated / edited / pinned state (the Builder)

Every question and flashcard carries metadata: `origin: "generated" | "edited" | "manual"`
and `locked: boolean`. `"edited"` and `"manual"` are always locked; `"generated"` (untouched
model output) is not.

Regenerating a category (`kitBuilderService.regenerateQuestionCategory`) splits the
category's current items into locked (kept as-is) and unlocked (eligible for replacement),
then asks the generation layer for fresh questions covering only the requirements *not*
already covered by locked items â€” avoiding duplicate coverage and never silently
overwriting something a human wrote or edited. The result is locked items unchanged, plus
fresh generated items filling the actual gap. This logic is unit-tested in isolation
(`core/builder/kitState.test.ts`) against a pure, synchronous version of the same split.

Reordering is plain array order (the index *is* the order â€” no separate `order` field to
keep in sync). Moving a question to a different category is treated as an edit (marks it
locked), since otherwise a later regeneration of either the source or destination category
could duplicate or silently drop it.

The metadata is stored inline on each item in MongoDB (outside the strict Appendix A
contract, which the brief explicitly allows: "you may extend it where that genuinely
helps"), and stripped via `kitSchema.ts`'s `toAppendixA()` before batch output â€” so the
grading harness only ever sees exactly the specified fields, regardless of what the app
extends internally.

## Schedule allocation

Pure arithmetic, no LLM (`scheduling/buildSchedule.ts`). Every question gets a weight:
must-have-linked questions outrank nice-to-have, and within that, higher difficulty
outranks lower. Questions are sorted by weight descending, then split into `days_available`
contiguous chunks â€” chunk 1 (highest weight) lands on day 1. This is deliberately simpler
than a per-day time-budget optimizer: the tool is a triage aid, not a scheduling solver, and
contiguous-chunk allocation is easy to explain and verify (and to unit test â€” see
`buildSchedule.test.ts`'s explicit check that must-have material lands on earlier days).

Edge cases: a 1-day schedule puts everything on day 1; a 60-day schedule with little
material produces honestly empty trailing days (0 minutes, no fabricated busywork) rather
than padding.

## Creative feature: Weak Spots Report

**The problem it solves:** a finished kit has a brief, a question bank, and a schedule, but
none of those answer the question a candidate actually has the night before â€” "if I only
have twenty minutes left, what should I look at?" Nothing else in the app answers that
directly.

**How it works:** `core/generation/weakSpots.ts` is a pure function (no LLM call â€” same
reasoning as coverage-check and scheduling: ranking data the app already has doesn't need
generation) that combines two things computed separately elsewhere:

- **Coverage** â€” is this requirement backed by a question at all?
- **Practice confidence** â€” did the candidate mark low confidence (or never practice) the
  flashcards tied to this requirement?

into one risk score per requirement, weighted by must/nice priority and question
difficulty, sorted descending. An uncovered must-have requirement always ranks above
everything else; a never-practiced requirement ranks above one the candidate marked low
confidence on but has at least looked at. Because it's pure computation, it's instant and
free to recompute every time â€” no LLM budget spent on something that's fundamentally a
sort.

## Key design decisions and trade-offs

- **Flashcards are derived deterministically from questions**, not separately generated by
  the LLM. This guarantees `requirement_id` traceability by construction and saves LLM
  calls against a tight TPM budget â€” but it's a purist-vs-pragmatist trade-off. A stricter
  reading of "add a flashcard" as independent content might expect genuinely distinct
  flashcard copy, not a mechanical transform of the question. Worth reconsidering if you
  have LLM budget to spare.
- **The coverage loop only forces retries on must-have gaps**, not nice-to-have gaps â€”
  matches the rubric's explicit "every must-have requirement has a question" criterion
  while still reporting nice-to-have gaps honestly rather than silently dropping them.
- **A kit owned by another user 404s, not 403s** â€” an unauthorized caller can't even
  confirm the id exists.
- **Duplicate-submission handling** (Section 10): identical `(jd, companyUrl, days)` input
  from the same user, while a prior generation for that exact input is still in flight,
  reuses the existing `GenerationRun` instead of racing it â€” the second request joins the
  first rather than starting a parallel duplicate.
- **SSRF guard resolves hostnames to actual IPs before checking against private/loopback
  ranges** (not just string-matching the hostname), to close the DNS-rebinding gap where a
  public-looking hostname resolves to `127.0.0.1`. Disabled outside production, since the
  batch command's test fixtures may be served from `localhost`.

## Known limitations

Being direct about these rather than letting them surface as surprises:

- **Public interview-discussion search isn't wired to a real provider.** The pipeline has a
  slot for it (`searchInterviewDiscussion`), and the rest of the pipeline degrades honestly
  when it returns nothing (per Section 10's "public discussion turns up nothing at all"),
  but there's no live search integration behind it in this pass.
- **No optimistic UI updates.** Every Builder edit waits for the round trip to the server
  before the UI updates, which falls short of Section 12's "make reordering and editing
  feel immediate." Functionally correct, just not as snappy as it should be.
- **SSE progress is single-instance.** The in-memory pub/sub hub (`sseHub.ts`) only works
  within one server process â€” fine for a single free-tier Render instance, but wouldn't
  survive a multi-instance deployment without a shared pub/sub layer.
- **`kitBuilderService.regenerateQuestionCategory` reimplements** the lock-respecting split
  logic from `core/builder/kitState.ts`'s `regenerateCategory()` rather than calling it
  directly, because that helper's callback is synchronous and live question generation
  needs an async LLM call. Both implementations do the same thing, but they're not
  literally the same code path, which means the unit tests for one don't strictly prove the
  other. Promoting `regenerateCategory` to accept an async callback would close this gap.
- **Ownership, duplicate-run-reuse, and version-conflict logic in `kitService.ts` /
  `kitBuilderService.ts` are only exercised by inspection, not by integration tests** â€” they
  need a real Mongo connection (e.g. `mongodb-memory-server`) to test meaningfully, which
  wasn't available in the environment this was built in. Treat these as reviewed-but-not-
  verified until they've been run against a real database.
