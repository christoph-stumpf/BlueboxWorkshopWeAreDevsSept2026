# Handoff — Bluebox Workshop: Conference Demo (run the app + trigger both problem patterns)

**Focus for next session (live at the conference):** bring up the Workshop Shop, generate
load to trigger **two** problem patterns, and show both Bluebox behaviours:
1. **Native auto-RCA** on the original failure storm (DB-pool exhaustion + payment timeout).
2. **The customer routine** — `Duplicate-Charge Watchdog` — which already returned a finding.

**Environment:** Linux, `podman` (no Docker; a `docker`→`podman` shim at `~/.local/bin/docker`
makes the Makefile work). Workspace: `/home/agent/workspace/BlueboxWorkshopWeAreDevsSept2026`.
Dynatrace sprint tenant **`miz8245h`**. Last worked: 2026-09-28.

Read these memories first (do not duplicate here):
- `~/.claude/.../memory/workshop-shop-local-run-gotchas.md`
- `~/.claude/.../memory/dynatrace-otlp-ingest-miz8245h.md` (updated this session — logs now land)

---

## 1. Current state

- **Demo app: STOPPED.** `make down` was run (Postgres volume preserved). Bring up with `make up`.
- **Bluebox routine: CREATED and returned a finding** (done by the user). The prompt lives in
  `docs/bluebox-routine-duplicate-charge-prompt.md`. It runs on a **daily (24h)** lookback.
- **Telemetry: fully working.** Traces land; **app logs now land too** (fixed this session — see §4).
- **Git:** branch `main`, 1 commit. **Uncommitted, nothing pushed:** `M compose.yaml`,
  `M otel.js`, `?? loadgen/checkout.js`, `?? docs/`. Commit only if asked; **ask before any
  push/PR** (standing rule) and **never add AI-attribution trailers**.

## 2. Bring up the app

```bash
cd /home/agent/workspace/BlueboxWorkshopWeAreDevsSept2026
make up          # shop-api :8088, payment :4004, postgrest :3000, postgres :5433
# health: curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8088/health   (expect 200)
```
Stop after: `make down` (keeps DB volume) / `make down -v` (wipes).

## 3. Trigger the two problem patterns

**Do NOT use `make load`** — its profiled `up` makes podman-compose recreate the whole stack and
k6 races the restart. Use direct `podman run` for both.

### 3a. Original failure storm (for Bluebox native auto-RCA)
High concurrency saturates the hardcoded 2-permit DB pool (`server.js:9`) → sub-ms HTTP 500s
(`database_pool_exhausted`), and the 150ms-timeout+retry on payment (`payment.js`) adds
`payment_timeout_retrying`. Expect **~97% failures + k6 exit 99 — intended defects, not a bug.**
```bash
podman run --rm --network host -e TARGET_URL=http://localhost:8088 -e VUS=15 -e DURATION=90s \
  -v ./loadgen/smoke.js:/scripts/smoke.js:ro docker.io/grafana/k6:0.55.0 run /scripts/smoke.js
```

### 3b. Duplicate-charge pattern (for the routine)
**Low** concurrency so checkouts complete instead of dying on the pool. Every completed checkout
double-charges deterministically (attempt 1 always takes 500ms > the 150ms client timeout → retry
mints a second `txn_` with `duplicateOf`). Checkouts return **200 approved** — the double charge
is invisible to error/latency monitoring.
```bash
podman run --rm --network host -e TARGET_URL=http://localhost:8088 -e VUS=3 -e DURATION=90s \
  -v ./loadgen/checkout.js:/scripts/checkout.js:ro docker.io/grafana/k6:0.55.0 run /scripts/checkout.js
```

## 4. What changed this session (so telemetry works)

- **`otel.js` — app logs now land in Grail.** The tenant drops OTLP `/v1/logs`, and the original
  `new SimpleLogRecordProcessor(new OTLPLogExporter())` was also wrong for sdk-logs 0.222.0 (the
  constructor takes `{ exporter }`), so the app had exported **no** logs at all. Replaced with a
  custom `ClassicLogExporter` that POSTs to the classic `/api/v2/logs/ingest` endpoint (URL + token
  derived from the existing OTLP env — no `compose.yaml`/`.env` change). Logs are queryable with
  `content` (the JSON line), `` `service.name` ``, `log.source=console`, and `trace_id`.
- **`loadgen/checkout.js`** — new checkout-every-iteration profile at VUS=3 (see §3b).
- **`docs/bluebox-routine-duplicate-charge-prompt.md`** — the routine prompt (verified DQL).
- **Superseded:** `docs/bluebox-demo-routine-telemetry-audit.md` (built on the missing-logs gap,
  which is now fixed) and `docs/bluebox-demo-routine.md`. Keep for reference only.

## 5. Verify data landed (dtctl)

`dtctl ctx miz8245h` is already the active context. Query auth = the shared OAuth session
(the `.env` token is ingest-only). Ingest lag: spans ~1 min, logs a few minutes.
```bash
# spans by service
dtctl query 'fetch spans, from: now()-15m | summarize c=count(), by:{`service.name`}'
# duplicate charges (the routine's headline metric)
dtctl query 'fetch logs, from: now()-24h | filter `service.name` == "payment" and contains(content, "duplicateOf") | parse content, "JSON:o" | summarize duplicate_charges = count(), orders_double_charged = countDistinct(o[orderId]), duplicate_amount_cents = sum(o[amountCents])'
```
Last verified (2026-09-28, under `checkout.js`): 52 duplicate charges, 51 orders, **$1,884**
over-charged in 24h; 113/712 payment traces showed the retry fan-out.

## 6. Suggested live-demo arc

1. **Native RCA:** `make up`, run 3a, let Bluebox auto-detect the incident and diagnose the
   DB-pool/payment-timeout root cause (now with the `database_pool_exhausted` /
   `payment_timeout_retrying` logs visible alongside the failed spans).
2. **Customer routine:** run 3b (or rely on the existing 24h data), open the `Duplicate-Charge
   Watchdog` finding / its GitHub issue — the business-invariant violation ($ over-charged) that
   Bluebox would never flag by default because it doesn't know the payment model.
3. Punchline: Bluebox finds the outage; the routine *you* wrote finds you're double-charging
   customers while every dashboard is green.

## 7. Open items
- Pre-warm: run load ~2 min before each segment (ingest lag). If a query runs dry, wait 30s.
- If the DQL runner rejects backticks on dotted fields, drop them (some interfaces resolve unquoted).
- Decide whether to commit `compose.yaml` + `otel.js` + `loadgen/checkout.js` + `docs/` (confirm
  first; ask before any push/PR).

## Suggested skills for next session
- **`run`** — to launch/verify the Workshop Shop and confirm load reaches the app.
