# Bluebox Demo Routine — Telemetry-Quality Audit

> **Chosen conference demo routine.** Supersedes the earlier `shop-api Health Watch`
> proposal (auto-detect-and-diagnose is Bluebox's *native* behaviour; this routine
> shows something Bluebox does not do out of the box: audit the **quality** of the
> telemetry itself).

## §0 — Facts vs. assumptions (read first)

**Verified against the live `miz8245h` tenant (via `dtctl`, under real k6 load, 2026-09-28):**
- The Workshop Shop emits **traces of high quality** but **no logs at all** reach Grail.
- Concrete numbers (10-minute window during load): **7,265** `shop-api` spans, **0** `shop-api` logs, **0** `payment` logs. Over 24h: **25,240** spans, **1** log total (a manual probe), **0** app logs.
- Failed requests **are** well-represented on spans: 7,002 failed `shop-api` spans, all `http.response.status_code = 500`, plus `span.status_code`, `request.is_failed`, `transaction.is_failed`, `dt.failure_detection.verdict`.
- `otel.js` **is** configured to export OTLP logs to the same endpoint that accepts traces (`OTLPLogExporter`, lines 3-12) — yet those logs never appear. So the gap is the **OTLP log path**, not missing instrumentation code.
- **Root cause pinned (paired-marker test, 2026-09-28):** with the *same* tenant/token, a **classic** log (`POST /api/v2/logs/ingest`, `204`) **landed**, while an **OTLP** log (`POST /v1/logs` via `OTLPLogExporter`) **did not** (0 after ~2 min). OTLP *traces* and *classic* metrics/logs all land — only **OTLP `/v1/logs` is dropped** by tenant `miz8245h`. Because the app logs via `OTLPLogExporter`, 100% of its logs are lost.

**Assumptions about Bluebox mechanics (verify before stage — see §7):** whether a routine
can run a telemetry-quality prompt, whether it opens a GitHub issue and its format, whether
the local backend (`:8000`) exposes Routines, and exact CLI/config syntax.

---

## §1 — Name & purpose

**`Telemetry-Quality Audit`** — a scheduled Bluebox routine that periodically checks whether
the services are *observable enough to debug*, and reports instrumentation/pipeline gaps as a
GitHub issue. It answers: *"If an incident happened right now, would we have the telemetry to
diagnose it?"*

Why it lands on stage: it finds a **real, counter-intuitive gap** in this app — the traces look
great, so nobody suspects a problem, but the one artifact that names the root cause (the
`database_pool_exhausted` log) **never reaches observability**. It reframes "we have telemetry"
as "we have the *right* telemetry," which resonates with any SRE/observability audience.

## §2 — Trigger / schedule

- **Schedule:** Daily (verified preset) — telemetry-quality drift is a slow problem; a daily
  audit is the natural cadence. `[ASSUMPTION]` a `Custom cron` sub-daily cadence also works.
- **Steering:** the audit logic lives in the routine **prompt** (Bluebox routines are
  prompt-steered scheduled agents). `[ASSUMPTION]` a routine can be scoped to specific services
  via its prompt rather than a native "service" field.

## §3 — What it audits (the checks)

Each check is a validated DQL query. The routine runs them, scores coverage, and flags gaps.

### Check 1 — Log coverage per service (THE headline gap)
Every active service should emit logs, not just spans.
```dql
fetch logs, from: now()-1h
| summarize log_count = count(), by: {service.name}
```
Compare against span-emitting services:
```dql
fetch spans, from: now()-1h
| summarize span_count = count(), by: {service.name}
| sort span_count desc
```
**Live result:** `shop-api` and `payment` produce thousands of spans and **zero** logs →
**flag: no log telemetry from either service.**

### Check 2 — Are failure-diagnostic logs reaching observability?
The app *emits* structured root-cause logs on every failure; verify they arrive.
```dql
fetch logs, from: now()-1h
| filter contains(content, "pool_exhausted") or contains(content, "payment_timeout")
| summarize c = count()
```
**Live result:** `0` — the logs that literally name the root cause are absent from Grail.

### Check 3 — Log⇄trace correlation coverage
Can you pivot from a failed span to the log that explains it?
```dql
fetch logs, from: now()-1h
| summarize total = count(), with_trace = countIf(isNotNull(trace_id))
```
**Live result:** no logs exist → **0% correlatable**. During an incident you can see *that*
`shop-api` returns 500s but have **no log** to explain *why*.

### Check 4 — Span error-semantics completeness (the healthy control)
Confirms what *is* good, so the report is credible and not alarmist.
```dql
fetch spans, from: now()-1h
| filter service.name == "shop-api"
| summarize total = count(),
            failed = countIf(request.is_failed == true),
            with_status = countIf(isNotNull(http.response.status_code))
```
**Live result:** failures carry `500` + `span.status_code` + `request.is_failed` +
`dt.failure_detection.verdict` → **traces pass.** The audit's verdict: *traces green, logs red.*

## §4 — Expected output (mocked artifact the audience sees)

A GitHub issue (or Bluebox chat summary):

```
Title: [Telemetry Audit] shop-api & payment emit 0 logs — incidents are undebuggable

Coverage scorecard (last 1h):
  service    spans     logs    log⇄trace corr.   verdict
  shop-api   7,265     0       0%                ❌ NO LOGS
  payment    ~600      0       0%                ❌ NO LOGS

Findings
  🔴 Critical — No application logs in Grail.
     Both services export OTLP traces successfully but zero logs land.
     The app DOES emit structured diagnostics (server.js logs
     `database_pool_exhausted`; payment.js logs `payment_timeout_retrying`),
     so root-cause evidence is generated but lost in the OTLP log pipeline.
     Impact: during the current 97%-failure incident, a responder sees failed
     spans but has NO log naming the cause.

  🟢 Healthy — Trace instrumentation.
     Failed requests correctly carry http.response.status_code=500 and
     failure-detection verdicts.

Recommended action
  1. OTLP /v1/logs is dropped for tenant miz8245h (classic /api/v2/logs/ingest
     works; OTLP traces work). Fix the logs OpenPipeline OTLP route, OR switch
     the app's log exporter to classic log ingest as a stopgap.
  2. Re-run this audit; expect shop-api log_count > 0 and correlation > 0%.

Evidence: [DQL queries from Checks 1-4]
```

## §5 — Setup (best-effort; assumptions flagged)

**UI-first (verified path):**
1. Bluebox UI → **Routines** → **New routine**.
2. Name: `Telemetry-Quality Audit`. Schedule: **Daily**.
3. Prompt (paste the audit intent + the four DQL checks from §3, instruct it to score coverage
   and open a GitHub issue when any service has spans but zero logs).
4. Set **Overlap policy: Skip**, enable, and use **Run now** for the live demo.

`[ASSUMPTION]` exact prompt-to-DQL behaviour, service scoping, and issue creation/format — verify
against the real Bluebox. `[ASSUMPTION]` a `bluebox routine` CLI exists; creation shown as UI-only.

### §5.1 — Full routine prompt (copy-paste)

Paste the block below verbatim into the routine's **prompt** field. It is self-contained: the
services, the exact DQL, the scoring rules, and the output format are all specified.

```text
You are a telemetry-quality auditor for the "Workshop Shop" application. Your job is
NOT to diagnose incidents — it is to check whether the services are observable enough to
debug an incident if one occurred. Audit the services shop-api and payment.

Run the following DQL checks over the last 1 hour and collect the results:

1. Log coverage per service:
   fetch logs, from: now()-1h | summarize log_count = count(), by: {service.name}
2. Span coverage per service (baseline of what IS active):
   fetch spans, from: now()-1h | summarize span_count = count(), by: {service.name} | sort span_count desc
3. Failure-diagnostic logs actually reaching the backend:
   fetch logs, from: now()-1h | filter contains(content, "pool_exhausted") or contains(content, "payment_timeout") | summarize c = count()
4. Log-to-trace correlation coverage:
   fetch logs, from: now()-1h | summarize total = count(), with_trace = countIf(isNotNull(trace_id))
5. Span error-semantics completeness (the healthy control):
   fetch spans, from: now()-1h | filter service.name == "shop-api" | summarize total = count(), failed = countIf(request.is_failed == true), with_status = countIf(isNotNull(http.response.status_code))

Scoring and flag rules:
- CRITICAL if any service produces spans (span_count > 0) but zero logs (log_count == 0).
- CRITICAL if check 3 returns 0 while shop-api has failed spans — it means the app's own
  root-cause logs (database_pool_exhausted, payment_timeout_retrying) are not reaching the
  backend, so incidents are undebuggable from logs.
- Report log-to-trace correlation as with_trace / total (0% if no logs exist).
- Mark trace instrumentation HEALTHY if failed spans carry http.response.status_code and
  request.is_failed — state this explicitly so the report is balanced, not alarmist.

Produce a GitHub issue with:
- Title: "[Telemetry Audit] <one-line summary of the worst finding>".
- A coverage scorecard table: service | spans | logs | log-trace correlation | verdict.
- A Findings section: one bullet per flagged gap (severity + plain-language impact) and one
  bullet for what is healthy.
- A Recommended action section with concrete next steps.
- An Evidence section containing the exact DQL queries you ran and their result counts.

Be concise and factual. If a query returns zero rows, say so explicitly rather than omitting it.
If you cannot open a GitHub issue, output the same content as your final message instead.
```

> Field-name note for whoever adapts this: `service.name`, `content`, `http.response.status_code`,
> and `request.is_failed` are verified in tenant `miz8245h`. `trace_id` on logs is unconfirmed
> (no logs currently exist to confirm the field name) — if check 4 errors, try `trace.id`.

## §6 — Live-demo runbook (~4 min)

| T | Action | What the audience sees |
|---|--------|------------------------|
| 0:00 | Show the **Routines** list with `Telemetry-Quality Audit` (pre-created). | Bluebox does scheduled, not just reactive, work. |
| 0:20 | Generate load (command below). | k6 ramps; ~97% failures. |
| 1:00 | Hit **Run now** on the routine (ingest lag ~1 min, so data is ready). | Routine starts investigating. |
| 1:30 | Routine reports back. | Scorecard: traces ✅, **logs ❌ 0/0**. |
| 2:30 | Open the produced GitHub issue. | Tangible artifact naming the gap. |
| 3:00 | Punchline (see §7). | "We had telemetry. We didn't have the *right* telemetry." |

Load command (proven; avoids the `make load` recreate race):
```bash
podman run --rm --network host \
  -e TARGET_URL=http://localhost:8088 -e VUS=15 -e DURATION=90s \
  -v ./loadgen/smoke.js:/scripts/smoke.js:ro \
  docker.io/grafana/k6:0.55.0 run /scripts/smoke.js
```
**Fallbacks:** ingest lag is ~1 min for spans; if the routine runs dry, wait 30s and Run now
again. Pre-warm by running load ~2 min before the segment. If Routines aren't wired on the local
backend, fall back to `bluebox ask --service shop-api "audit our telemetry quality: do we emit
logs, and can we correlate failed spans to logs?"` and show the same evidence.

## §7 — Talking points

- "Everyone checks *whether* they have telemetry. Almost nobody checks whether it's **good enough
  to debug with**."
- "Look — beautiful traces. 7,000 failed spans, all tagged 500. But watch: **zero logs.** The app
  is *literally logging* `database_pool_exhausted` — the root cause, by name — and it never
  arrives. You can see the fire, not the cause."
- "This is the failure mode you find at 3 a.m., not at design time. A routine catches it on a
  Tuesday afternoon instead."
- "Bluebox didn't just say 'you're down' — it audited its *own* inputs and told us our
  observability has a blind spot."

## §8 — Assumptions to verify before stage
- [ ] Local backend (`:8000`) exposes **Routines** (vs. hosted only).
- [ ] A routine can run this prompt-driven audit and **open a GitHub issue** (+ its format).
- [ ] Routine can be **scoped/steered to shop-api & payment** via prompt.
- [ ] DQL field names hold in `miz8245h`: `service.name`, `content`, `trace_id`,
      `http.response.status_code`, `request.is_failed` — **all verified 2026-09-28** except
      `trace_id` on logs (no logs exist to confirm the field name).
- [ ] GitHub connection wired to the workshop fork.
- [x] Root-cause of the missing logs: **confirmed** — OTLP `/v1/logs` is dropped by the tenant
      (classic `/api/v2/logs/ingest` lands; OTLP traces land). The app exporter is fine; the
      tenant's OTLP-logs ingest is the culprit.
