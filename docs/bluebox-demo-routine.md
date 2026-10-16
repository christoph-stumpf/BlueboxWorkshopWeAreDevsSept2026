# Bluebox Demo Routine — "shop-api Health Watch"

A presenter-ready proposal for a conference stage demo of a **Bluebox routine**, tailored to
the Workshop Shop application.

---

## 0. What a Bluebox "routine" is (facts vs. assumptions)

### Verified from bluebox.ai / docs.bluebox.ai (fetched 2026-09-28)

- Bluebox is a **Dynatrace observability product for AI coding agents**. It "briefs your coding
  agent before it builds, and investigates what breaks in production," using Dynatrace causal AI
  for root-cause analysis and OpenTelemetry as the ingest standard.
- You interact with it through a **CLI** (`bluebox ask ...`) and a **web UI** (dashboards for
  findings, investigations, routine health, plus a Chat interface). `bluebox ask` answers include
  an **Evidence section showing the production data it queried and any coverage gaps**. Documented
  CLI flags include `--workspace` (multi-workspace users) and `bluebox workspace list` / `switch`.
- **Routines** are the automation primitive: *"A routine runs a Bluebox agent automatically, on a
  schedule or from a matching GitHub event."* Verified properties:
  - **Schedule triggers** with presets: **Once, Hourly, Daily (default), Weekdays, Weekly, Custom
    (cron expression)**.
  - **GitHub event triggers**: event type (Pull request / Issue / Comment), specific actions,
    target repositories, and up to 20 filter conditions.
  - **Create** a custom routine: only a **name** is required; you may optionally add a **prompt**
    describing what the agent should do.
  - **Run now** executes immediately without affecting the schedule.
  - **Overlap policy**: Skip or Allow. **Visibility**: workspace-wide or private. **Run limits**:
    all runs count toward the workspace allowance; throttled runs are skipped.
  - Routines can be toggled on/off; every field except the trigger type can be edited; run history
    shows colored outcome indicators with timestamps.
  - Three **pre-built templates** ship on the Overview page: **Verify bugfix PRs** (Daily 08:00),
    **Daily deployment health** (Daily 09:00), **Dependency vulnerability scan** (Weekdays 07:00).
  - **Auto-investigations** (workspace-owner setting): every new incoming **finding** starts a run
    automatically, with a configurable daily budget limit.
- Routine/agent output is delivered as **GitHub Issues with full context** for an agent or human
  to act on (stated on the marketing site; the "Verify bugfix PRs" template "opens a GitHub issue
  for each").

### Assumptions a presenter MUST verify against the real Bluebox before going on stage

The docs pages fetched did **not** specify the following. They are reasonable interpretations,
flagged throughout with **[ASSUMPTION]**:

1. The exact **CLI/config syntax** to create or trigger a routine from the terminal. The docs show
   routines are created and managed in the **web UI**; a CLI for routines may or may not exist.
   Where this doc shows a `bluebox routine ...` command, treat it as **intent — exact syntax TBD,
   verify against Bluebox docs/UI.**
2. That a routine can be **bound to a specific service** (`shop-api`) the same way `bluebox ask
   --service <svc>` is. The `ask` CLI uses `--service`; routines likely scope via their prompt
   and/or the workspace's connected data. **Exact scoping mechanism TBD.**
3. That a routine can carry a **threshold/condition** ("fire when failure rate > X%"). Docs
   confirm *schedule* and *GitHub-event* triggers only. A threshold is most plausibly expressed
   inside the routine **prompt** (the agent decides), not as a native trigger field. **TBD.**
4. That the routine emits a **GitHub issue draft with embedded DQL evidence**. Issue output is
   confirmed at the template level; the precise body format and whether raw DQL is included is
   **not documented — the mock below is illustrative.**
5. **DQL field names/units** for the OTel-ingested signals — `request.is_failed` is given as
   verified by the workshop; `endpoint.name`, `span.kind`, log `content`/`body`, and `duration`
   units (nanoseconds) are **[ASSUMPTION]** and should be confirmed in a Grail notebook first.
6. That `BLUEBOX_API_URL=http://localhost:8000` local backend exposes the same routine features as
   the hosted product. **TBD.**

Design principle for the demo: **lean on what is verified** (a scheduled agent that investigates
and opens a GitHub issue) and **drive the "fire now" moment with `Run now`**, which is a confirmed
feature — so the demo does not depend on any unverified threshold-trigger mechanism.

---

## 1. Recommended routine

### Name & purpose

> **`shop-api Health Watch`** — a scheduled Bluebox agent that periodically checks `shop-api` for a
> failure-rate spike, autonomously diagnoses the likely root cause from spans + logs, and opens a
> GitHub issue with the evidence.

### Why this one lands on stage

- **Visible and fast.** The Workshop Shop's defects produce a *dramatic* signal — ~96–98% request
  failure at 10–15 concurrent users — so the routine has something unambiguous to find within one
  ingest cycle.
- **Ties directly to the two known defects.** The agent's evidence naturally surfaces the
  2-connection pool (sub-millisecond fast-fails + `database_pool_exhausted` logs) and the payment
  timeout/retry (`payment_timeout_retrying`).
- **Produces a tangible artifact.** A GitHub issue on screen is the perfect handoff into the rest
  of the workshop story (coding agent picks up the issue → fixes it).
- **Uses only verified Bluebox mechanics for the "wow" beat.** The spike is generated by k6; the
  routine is fired with **Run now** (a confirmed feature), so nothing on stage hinges on an
  unverified threshold trigger.
- **It is essentially the shipped "Daily deployment health" template, re-scoped** to `shop-api` —
  credible and low-risk.

### Trigger / schedule

- **Production-realistic config:** **Hourly** schedule (verified preset), **Overlap policy = Skip**,
  visibility workspace-wide. Rationale: a health watch should sweep continuously without piling up
  overlapping runs; hourly is the tightest *documented* recurring preset and matches how you'd
  actually run this.
- **[ASSUMPTION] Tighter cadence:** if a **Custom cron** every few minutes is supported by the
  backend, use `*/5 * * * *` for a more "live" feel. Verify cron granularity is honored.
- **On-stage:** keep the schedule as above but drive the demo with **Run now** immediately after
  load generation, so timing is under the presenter's control and independent of the wall clock.

### What it does, step by step

The routine's **prompt** (the one field that carries the investigation intent) instructs the agent
to, on each run:

1. **Measure the failure rate** of `shop-api` over the last 15 minutes and compare against a healthy
   baseline. The agent queries failed vs. total server spans.
2. **If failure rate is elevated** (target threshold ~>10%; **[ASSUMPTION]** expressed in the prompt,
   not a native trigger), **localize** which endpoints and which failure mode dominate.
3. **Inspect span latency of failures** — the pool-exhaustion path fails in **<1 ms** (fast-fail
   before any downstream call), which is a strong, distinctive fingerprint.
4. **Corroborate with logs** — count `database_pool_exhausted` and `payment_timeout_retrying`
   events and align them in time with the span spike.
5. **Reason to a root cause** using the causal AI + evidence, and **emit an artifact**: a diagnosis
   summary and a **GitHub issue draft** containing the finding, the supporting DQL, and a suggested
   fix direction.

#### Concrete DQL the agent runs (Grail / Dynatrace tenant `miz8245h`)

> `request.is_failed` is verified by the workshop. Other field names/units are **[ASSUMPTION]** —
> validate in a Grail notebook first (see fallback in §4).

**A. Failure rate over time (the spike):**
```dql
fetch spans, from: -15m
| filter service.name == "shop-api"
| makeTimeseries
    total  = count(),
    failed = countIf(request.is_failed == true),
    interval: 1m
| fieldsAdd failure_rate_pct = 100.0 * failed[] / total[]
```

**B. Which endpoints are failing (localization):**
```dql
fetch spans, from: -15m
| filter service.name == "shop-api" and span.kind == "server"   // [ASSUMPTION] span.kind
| summarize total  = count(),
            failed = countIf(request.is_failed == true),
            by: { endpoint.name }                                 // [ASSUMPTION] endpoint.name
| fieldsAdd failure_rate_pct = 100.0 * failed / total
| sort failure_rate_pct desc
```

**C. Latency of failed spans — the fast-fail fingerprint:**
```dql
fetch spans, from: -15m
| filter service.name == "shop-api" and request.is_failed == true
| summarize p50_ms = percentile(duration, 50) / 1000000.0,        // [ASSUMPTION] duration in ns
            p90_ms = percentile(duration, 90) / 1000000.0,
            failures = count()
```
Expected: **p50 well under 1 ms** — proof the request died *before* doing real work (pool exhausted),
not a slow downstream.

**D. Log corroboration — pool exhaustion:**
```dql
fetch logs, from: -15m
| filter service.name == "shop-api"
| filter matchesPhrase(content, "database_pool_exhausted")        // [ASSUMPTION] field: content/body
| summarize pool_exhausted_events = count(), by: { bin(timestamp, 1m) }
```

**E. Log corroboration — payment timeout/retry:**
```dql
fetch logs, from: -15m
| filter service.name == "shop-api" and matchesPhrase(content, "payment_timeout_retrying")
| summarize retry_events = count()
```

### Expected output the audience sees (mocked)

**In the Bluebox UI / CLI — diagnosis summary:**

```
● shop-api Health Watch — run #7  (manual: Run now)          ✔ completed  14:32:41

FINDING: Elevated failure rate on shop-api (severity: high)

Failure rate jumped 1% → 97% at 14:31 and held for the load window.
Failures are concentrated on the DB-backed endpoints and share one fingerprint:
they fail in <1 ms — before any downstream call — which points to a resource
that is exhausted at admission, not a slow dependency.

Root cause (most likely):
  shop-api uses a hard-capped in-process "connection pool" of size 2
  (const databasePool = [{}, {}] in server.js). Under concurrency the pool is
  empty on arrival, the request throws "database connection pool exhausted"
  and returns HTTP 500 immediately. This fully accounts for the <1 ms failures
  and the database_pool_exhausted log spike.

Secondary signal:
  payment_timeout_retrying is firing on /api/checkout. The payment charge uses a
  150 ms client timeout with a single retry; the first attempt is aborted and
  retried, which risks duplicate charges even when checkout "succeeds."

Evidence:
  • Failure rate 1% → 97% at 14:31       (query A)
  • Top failing endpoints: /api/cart, /api/products, /api/checkout  (query B)
  • Failed-span latency p50 = 0.4 ms, p90 = 0.9 ms  → fast-fail  (query C)
  • database_pool_exhausted: 1,412 events, aligned to the spike   (query D)
  • payment_timeout_retrying: 38 events on /api/checkout          (query E)
  Coverage gaps: none for shop-api; payment service spans not inspected this run.

Action: GitHub issue draft prepared →  #<n>
```

**The GitHub issue artifact (mocked — exact format [ASSUMPTION]):**

```markdown
Title: shop-api: 97% request failure under load — 2-connection DB pool exhausted

## Summary
Under concurrent load, shop-api fails ~97% of DB-backed requests. Requests fail in
<1 ms with `database_pool_exhausted`, returning HTTP 500 before any downstream call.

## Evidence (Dynatrace / Grail, tenant miz8245h)
- Failure rate 1% → 97% at 14:31 (spans, request.is_failed == true)
- Failed-span latency p50 ≈ 0.4 ms → admission-time fast-fail
- 1,412 × `database_pool_exhausted` logs aligned to the spike
- Secondary: 38 × `payment_timeout_retrying` on /api/checkout

<details><summary>DQL used</summary>

```dql
fetch spans, from: -15m
| filter service.name == "shop-api"
| makeTimeseries total = count(), failed = countIf(request.is_failed == true), interval: 1m
| fieldsAdd failure_rate_pct = 100.0 * failed[] / total[]
```
</details>

## Likely root cause
`server.js`: `const databasePool = [{}, {}]` — a hardcoded 2-slot array used as a
connection pool. `database()` pops a slot and throws when empty. This caps real
concurrency at 2.

## Suggested fix direction
Replace the toy array with a real pooled client (or raise/replace the limit) and
apply backpressure instead of immediate 500s. Separately, review the payment
charge 150 ms timeout + retry to prevent duplicate transactions.

## Affected
- Service: shop-api (:8088)
- Repo: christoph-stumpf/BlueboxWorkshopWeAreDevsSept2026
```

### How to set it up / where it's configured

**Primary path — web UI (verified this is where routines live):**

1. Bluebox UI at **http://localhost:5173** → **Overview** or **Routines**.
2. **New routine** (or start from the **"Daily deployment health"** template and re-scope).
3. **Name:** `shop-api Health Watch`.
4. **Prompt** (the investigation intent — the mechanism that carries the threshold/logic):

   > *"Every run, assess the health of the **shop-api** service over the last 15 minutes. Compute
   > its request failure rate from spans (`request.is_failed == true`). If the failure rate is
   > elevated (>10%), localize the failing endpoints, inspect the latency of failed spans, and
   > check the logs for `database_pool_exhausted` and `payment_timeout_retrying`. Determine the
   > most likely root cause with evidence, and open a GitHub issue containing the finding, the DQL
   > you ran, and a suggested fix. If shop-api is healthy, end the run with no issue."*

5. **Trigger:** **Hourly**, **Overlap = Skip**, **Visibility = workspace**. (Optionally **Custom
   cron** `*/5 * * * *` — **[ASSUMPTION]**, verify granularity.)
6. Ensure the **GitHub connection** targets `christoph-stumpf/BlueboxWorkshopWeAreDevsSept2026` so
   issue creation works. (Connections are configured per workspace — **exact steps TBD**.)
7. Confirm the workspace is reading telemetry from tenant **`miz8245h`** (the app's active
   `OTEL_EXPORTER_OTLP_ENDPOINT`).

**[ASSUMPTION] CLI path (intent only — exact syntax TBD, verify against Bluebox docs/UI):**
```bash
export BLUEBOX_API_URL=http://localhost:8000
# Sanity check the same investigation interactively first (verified command shape):
bluebox ask --service shop-api "Over the last 15m, what is shop-api's failure rate and most likely root cause? Show evidence."
# Creating/triggering a routine from the CLI is NOT documented — do this in the UI unless verified:
# bluebox routine create --name "shop-api Health Watch" --schedule hourly --prompt "<prompt above>"   # TBD
# bluebox routine run "shop-api Health Watch"                                                          # TBD (UI: "Run now")
```

---

## 2. Alternatives considered (briefly)

1. **`checkout Duplicate-Charge Sentinel`** — a routine focused on `/api/checkout` that correlates
   `payment_timeout_retrying` with the payment service's duplicate `transactionId` logs (attempt 1
   always sleeps 500 ms > the 150 ms client timeout, so it *always* retries and can double-charge).
   *Why not primary:* the story is subtler and slower to read on stage than a 97% failure cliff,
   and duplicate-charge evidence needs both services' logs. Excellent as a **second routine** or a
   follow-up talking point.
2. **`Daily Deployment Health` (stock template, unmodified)** — lowest-risk, zero custom config.
   *Why not primary:* it isn't scoped to the workshop's specific defects, so the diagnosis is less
   pointed and the "aha" is weaker. Good safety net if custom-prompt behavior misbehaves in
   rehearsal.

---

## 3. Live-demo script (minute-by-minute stage runbook)

Pre-flight (before you present): app is up (`make up`), telemetry is flowing to `miz8245h`, Bluebox
UI (`:5173`) and backend (`:8000`) are running, the `shop-api Health Watch` routine exists and is
enabled, GitHub connection is wired. Do a **full rehearsal run** and keep its issue URL as a
backup slide.

| Time | You do | Audience sees |
|------|--------|---------------|
| 0:00 | Frame it: "Bluebox routines are scheduled agents that watch production and hand your coding agent a fix. Here's one watching our shop." Show the routine config + green run history. | The routine, its Hourly schedule, prior healthy runs. |
| 0:30 | Show the shop working at `http://localhost:8088`; note it's fine at rest. | A working store. |
| 1:00 | **Generate load** (command below) in a visible terminal. | k6 starting 15 VUs; failure counter climbing. |
| 1:15 | Narrate: "15 concurrent shoppers — watch what happens." Point out k6's rising `http_req_failed`. | ~96–98% failures in k6 output. |
| ~2:00 | Let load run; ingest lag is ~1 min so telemetry is landing in Grail now. Optionally show the live failure-rate DQL (query A) in a Grail notebook as proof. | Failure-rate timeseries spiking 1% → ~97%. |
| 2:30 | In Bluebox, hit **Run now** on `shop-api Health Watch`. | Run kicks off; status spinner. |
| 2:30–3:30 | While it thinks, recap the two defects you *expect* it to find. | Agent progressing through its investigation. |
| 3:30 | Open the completed run → read the **diagnosis** aloud, emphasizing the **<1 ms fast-fail** fingerprint and the **`database_pool_exhausted`** evidence. | The mocked-style diagnosis in §1. |
| 4:15 | Open the **GitHub issue** it drafted. "No human wrote this — it's evidence-backed and ready for a coding agent." | The GitHub issue artifact. |
| 4:45 | Bridge to the rest of the workshop: hand the issue to a coding agent to fix `const databasePool = [{}, {}]`. | The closing story beat. |

**Load-generation command (copy/paste):**
```bash
podman run --rm --network host \
  -e TARGET_URL=http://localhost:8088 -e VUS=15 -e DURATION=90s \
  -v ./loadgen/smoke.js:/scripts/smoke.js:ro \
  docker.io/grafana/k6:0.55.0 run /scripts/smoke.js
```
(Equivalent in-repo: `make load` runs the same k6 script via compose at VUS=10/60s.)

### Fallbacks if something is slow

- **Ingest lag (~1 min):** start load **before** you talk about the routine (steps at 1:00), so by
  the time you hit **Run now** (2:30) the data is already in Grail. If the run finds nothing, widen
  the routine/query window to `-30m` and **Run now** again while narrating.
- **Load a second wave:** re-run the k6 command (or bump `-e DURATION=180s`) to keep the spike alive
  across a re-run.
- **Routine run stalls or the agent under-diagnoses:** fall back to the **verified** `bluebox ask
  --service shop-api "..."` command live — same evidence, interactive — then show the *rehearsal*
  issue you saved pre-flight.
- **DQL field mismatch:** if `endpoint.name`/`span.kind`/`content`/`duration`-units differ in this
  tenant, use the pre-validated notebook queries from your rehearsal (validate all five in §1
  against `miz8245h` the day before — this is the single most likely thing to bite you).
- **Total telemetry outage:** show the saved rehearsal run + issue as a recorded backup.

---

## 4. Talking points — tying the finding back to the real root cause

- **"The agent found the fast-fail, not a slowdown."** Failed requests die in **under a millisecond**,
  *before* any DB or payment call. That's the tell for **admission-time resource exhaustion**, and
  it maps exactly to `const databasePool = [{}, {}]` in `server.js`: a 2-slot array masquerading as
  a connection pool. Beyond 2 concurrent DB-backed requests, `database()` pops an empty pool, throws
  *"database connection pool exhausted,"* and returns HTTP 500 — hence ~97% failure at 15 users.
- **"Logs confirmed the mechanism."** The `database_pool_exhausted` event spike lines up minute-for-
  minute with the span failures — causation, not coincidence.
- **"It also caught a subtler bug for free."** `payment_timeout_retrying` on `/api/checkout`: the
  charge uses a **150 ms** client timeout with a single retry, but the payment service delays the
  **first** attempt by **500 ms** — so attempt 1 is *always* aborted and retried, and the payment
  service mints a **new `transactionId` per attempt**. That's a **duplicate-charge** risk hiding
  behind a "successful" checkout — exactly the kind of latent defect a routine surfaces before it
  becomes an incident.
- **"This is the loop Bluebox is selling."** Scheduled routine → autonomous investigation with
  Dynatrace causal AI → evidence-backed GitHub issue → coding agent fix. The human reviews; the
  agents do the legwork.
- **Honesty beat (optional):** "The threshold logic and the issue format here ride on the routine's
  prompt and Bluebox's issue output; the schedule, `Run now`, and GitHub-issue delivery are
  first-class routine features." Keeps you credible if an expert in the room probes the mechanics.

---

## Appendix — presenter's pre-stage verification checklist (assumptions to confirm)

- [ ] Can a routine be **scoped to `shop-api`**, or only via its prompt? (mechanism)
- [ ] Is a **threshold/condition** expressible, or must the agent decide in-prompt?
- [ ] Does **Custom cron** honor sub-hourly (`*/5`) cadence?
- [ ] Does the routine actually **open a GitHub issue**, and what's the real body format?
- [ ] Does the issue/evidence include **raw DQL**, or just prose evidence?
- [ ] Are the **DQL fields/units** correct in tenant `miz8245h`: `request.is_failed`,
      `endpoint.name`, `span.kind`, log `content` vs `body`, `duration` in ns?
- [ ] Does the **local backend** (`:8000`) expose routines, or only the hosted product?
- [ ] Is there any **`bluebox routine` CLI**, or is creation/trigger UI-only?
- [ ] Is the **GitHub connection** wired to the workshop repo?
- [ ] Full **rehearsal run** completed and its issue URL saved as backup.
