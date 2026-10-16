# Handoff: run the Workshop Shop and reproduce the Davis endpoint-alerting findings

Audience: a colleague taking over the `davis-endpoint-prototype` branch. This guide explains the
project, the fault-injection mechanism, and the steps that reproduce each finding in
`docs/davis-endpoint-alerting-results.md`.

Last worked: 2026-10-05 (experiments 2–4 on the original author's tenant). Everything in this branch was
uncommitted when this guide was written.

## 1. What the project is

**Workshop Shop** is a small ecommerce app built to produce observable failures for the Bluebox
demo. Two Node services run in prebuilt containers, with the source mounted read-only:

| Service | OTel `service.name` | Port | Role |
|---|---|---|---|
| `shop-api` (`server.js`) | `shop-api` | 8088 | Frontend, `/api/products`, `/api/cart` (GET/POST/DELETE), `/api/checkout`, `/health` |
| `payment` (`payment.js`) | `payment` | 4004 | `POST /charge`, `POST /refund`, `GET /health` |
| PostgREST + Postgres | — | 3000 / 5433 | Data layer (Postgres on 5433 to coexist with a local Bluebox stack on 5432) |

`otel.js` is preloaded into both services (`node --require /workshop/otel.js …`). It exports traces
and metrics over OTLP and ships console logs through the classic log-ingest API
(`/api/v2/logs/ingest`), because the tenant used for the original runs dropped OTLP `/v1/logs`.

### Two intended defects (from the original demo)

- **DB pool exhaustion.** `DB_POOL_SIZE` (default `2`) limits concurrent DB connections. Concurrent
  load produces sub-millisecond HTTP 500s and a `database_pool_exhausted` log line.
- **Duplicate charge.** Checkout aborts the first payment call after 150 ms and retries. The
  payment service answers attempt 1 after 500 ms, so every completed checkout creates two
  transactions (the second carries `duplicateOf`) and still returns 200.

The Davis experiments run with `DB_POOL_SIZE=20` so the pool defect adds no 5xx to the error
signal. The conference demo uses the defaults; its runbook is `docs/handoff-conference-demo.md`.

## 2. Prerequisites

- `podman` with a `docker` shim on `PATH` (the Makefile calls `docker compose`), or Docker.
- `node`/`npm` (the Makefile runs `npm ci` on first `make up`), `python3` with `pyyaml`
  (`preview.py`), `curl`.
- `dtctl` with a context for your Dynatrace tenant. The context needs permission to apply
  anomaly-detector settings and to query Grail.
- A token that can ingest OTLP traces (platform token scopes `openpipeline:traces:ingest`,
  `openpipeline:logs:ingest`, `openpipeline:metrics:ingest`) for that tenant.
- A host that stays awake for about 4 hours. The VM clock drifts when a laptop sleeps (section 7).

### Configure telemetry

Create `.env` (git-ignored) in the repo root:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://<tenant-host>/api/v2/otlp
OTEL_EXPORTER_OTLP_HEADERS=<header value from the Bluebox setup page>
```

`otel.js` extracts the token from an `Api-Token <token>` header value to build the classic
log-ingest request, so keep that scheme in the header.

Use the tenant's API host (for a sprint tenant `<id>.sprint.dynatracelabs.com`; the `.apps` host
redirects and 404s). Compose reads
`.env` automatically. Verify that spans land after the app has run for a minute:

```bash
dtctl --context <tenant> query 'fetch spans, from: now()-10m | filter span.kind == "server" | summarize count(), by:{dt.service.name, dt.smartscape.service, endpoint.name}'
```

Both services should appear with `dt.smartscape.service` and `endpoint.name` populated.

### Adapt the detector files to your identity

`davis-prototype/*.yaml` carry `executionSettings.actor: 366c5f46-…`, the UUID of the user who ran
the experiments. Replace it in all three detector YAMLs with
your own user or service-user UUID; the apply fails without a valid actor.

`davis-prototype/object-ids.tsv` maps `tenant → detector file → settings objectId`.
`detector.sh` creates a detector on first apply, appends its objectId, and updates in place
afterwards. On your tenant the first apply creates fresh detectors and adds their rows. The rows
already in the file belong to the original author's tenants; leave them or delete them.

## 3. Run the app and the load

```bash
DB_POOL_SIZE=20 make up        # shop :8088, payment :4004; waits until both answer
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8088/health    # 200
```

Stop with `make down` (keeps the DB volume) or `make reset` (wipes it).

Run k6 with `podman run` directly. `make load` recreates the whole stack under podman-compose and
produces spurious connection-refused errors.

| Profile | Script | Purpose | Command variables |
|---|---|---|---|
| Davis experiments | `loadgen/davis-endpoints.js` | Steady per-endpoint arrival rates (below) | `DURATION` (default `5h`) |
| Failure storm | `loadgen/smoke.js` | Trips pool exhaustion; ~97% failures and k6 exit 99 are expected | `VUS=15 DURATION=90s` |
| Duplicate charge | `loadgen/checkout.js` | Completes checkouts at low concurrency; each double-charges | `VUS=3 DURATION=90s` |
| Healthy baseline | `loadgen/baseline.js` | Browse-only, no checkout, single VU; stays green | `VUS=1 DURATION=120s` |

Start the Davis load (leave it running for the whole experiment):

```bash
podman run -d --name davis-loadgen --network host -e DURATION=5h \
  -v ./loadgen/davis-endpoints.js:/scripts/davis-endpoints.js:ro \
  docker.io/grafana/k6:0.55.0 run --quiet /scripts/davis-endpoints.js
```

Arrival rates in `davis-endpoints.js`:

| Endpoint | Rate |
|---|---|
| `shop-api GET /api/products` | 5 / s (high volume) |
| `shop-api POST /api/cart` | 1 / s |
| `shop-api GET /api/cart` | 12 / min (low volume) |
| `shop-api POST /api/checkout` | 6 / min (keeps the shop-api → payment call edge in the topology) |
| `payment POST /charge` | 2 / s |
| `payment POST /refund` | 1 / s |

Stop the load with `podman rm -f davis-loadgen`.

## 4. Fault injection

`faults.js` is a require-able module that both services call at the top of their request handler.
It decides per request whether to answer HTTP 500 (`{"error":"injected fault"}`).

### Configuration file

`faults.json` in the repo root (override the path with `FAULTS_FILE`) maps
`service → "<METHOD> <pathname>" → probability`:

```json
{
  "shop-api": { "GET /api/cart": 0.5, "POST /api/cart": 0.5 },
  "payment":  { "POST /charge": 0.5, "POST /refund": 0.5 }
}
```

- Service keys are the literals `shop-api` and `payment`, set in the call sites in `server.js` and
  `payment.js`. They do not follow `OTEL_SERVICE_NAME_*`.
- The path is `url.pathname` without the query string (`/api/cart`, not `/api/cart?userId=…`).
- Probability `0.5` answers 500 for about half of the matching requests; `1` answers 500 for all
  of them. `0` or an absent key injects nothing.
- `{}` or a missing file means a healthy system.
- The module compares the file's mtime on every request and reloads on change, so faults switch on
  and off with no restart. `faults.json` and `.faults.*` are git-ignored.
- Both `GET /health` endpoints run the fault check too, so they can be faulted like any other
  endpoint (`payment` checks faults before answering `/health`).

### Switching faults: `davis-prototype/fault.sh`

```bash
davis-prototype/fault.sh '{"shop-api":{"GET /api/cart":0.5}}' 'P1b start'
davis-prototype/fault.sh '{}' 'all healthy'
```

The script validates the JSON, writes `faults.json` atomically (temp file plus `mv`), and appends
`<UTC time> <label> <json>` to `davis-prototype/timeline.log`. Use it for every change during an
experiment so the log is the authoritative UTC timeline.

Check that a fault is live:

```bash
for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code} ' http://localhost:8088/api/cart?userId=t; done; echo
```

At `0.5`, about half of the 20 responses are `500`.

### Endpoint labels used in the results

| Label | Endpoint |
|---|---|
| B | `shop-api GET /api/cart` |
| C | `shop-api POST /api/cart` |

## 5. Detectors and observation tools

All commands take the tenant through `DT_CONTEXT` (a `dtctl` context name).

| File | Role |
|---|---|
| `davis-prototype/endpoint-5xx-detector.yaml` | Main detector. Spans-based `makeTimeseries` of the 5xx rate per (`dt.smartscape.service`, `endpoint.name`); static threshold 5%, alert on 3 of 5 one-minute samples, close after 5 clean samples. `event.name` carries the service; the endpoint travels in `event.description` and the `endpoint.name` property; the event binds to the service through `dt.smartscape_source.id`. |
| `…-no-merge.yaml` | Same, with `dt.davis.is_merging_allowed=false` |
| `…-endpoint-in-name.yaml` | Same, with the endpoint in `event.name` |
| `detector.sh <yaml> true\|false` | Enables or disables a detector on `$DT_CONTEXT` and logs it to `timeline.log`. The YAML on disk stays `enabled: false`. |
| `observe.sh <UTC ISO time>` | Prints event snapshots (`dt.davis.events.snapshots`) and problems (`dt.davis.problems`) since that time |
| `preview.py <start> <end> [yaml]` | Dry-runs the detector's analyzer over a past window and lists the alerts it would raise (`pyyaml` required) |
| `schedule-p2-p4.sh` | The timed run for experiments 2–4 (section 6) |
| `host-watch.sh` | Logs a tick every 60 s and flags VM stalls and clock skew to `host-health.log` |
| `notes.md`, `timeline.log` | Raw numbers and the UTC event log from the 2026-10-02 and 2026-10-05 runs |

Two details to know before using them:

- `host-watch.sh` reads the Date header of `https://hyq2999h.sprint.dynatracelabs.com/`. Edit the
  hostname to your tenant host.
- A detector evaluates a lookback window when it is created or enabled and alerts on past fault
  data. Enable a detector before its fault phase, never right after one.

## 6. Reproduce the findings

Start with section 3 running and a healthy period of at least 15 minutes, so the service
entities and endpoint data exist before any detector or fault is active.

### Experiments 2–4 in one scheduled run (about 3.6 hours)

```bash
export DT_CONTEXT=<your-dtctl-context>
nohup setsid davis-prototype/host-watch.sh > /dev/null 2>&1 < /dev/null &
nohup setsid davis-prototype/schedule-p2-p4.sh > davis-prototype/schedule.log 2>&1 < /dev/null &
```

Follow progress with `tail -f davis-prototype/timeline.log` and
`davis-prototype/observe.sh <UTC start of the run>`.

The schedule runs these steps (offsets in minutes from launch):

| T+min | Step | Expected result |
|---|---|---|
| 0 | Main detector on | — |
| 2–32 | P2a: B and C at 50%. At T+17 B recovers (C stays at 50%). | Events for B and C become visible ~6 min after the fault starts. **One problem** (starts ~3 min after the events) contains both events. After B recovers, B's event closes ~4 min later and the problem stays open. Everything closes ~4 min after C recovers. |
| 57–72 | P2c: C alone at 50% | New event with the **same `dt.event.correlation_id`** as C's earlier event, and a **new problem** |
| 97–112 | P3: B, C, `payment POST /charge` and `POST /refund` at 50% | Two problems first (one per service). About 1 min later Davis merges them: the shop-api problem gets `dt.davis.is_duplicate=true` and the payment problem holds all four events, with `root_cause` = payment |
| 135–152 | P4a: `no-merge` detector, B and C at 50% | **Two problems**, one per endpoint |
| 175–192 | P4b: `endpoint-in-name` detector, B and C at 50% | **One problem** with both events, named after the first event. The endpoint in `event.name` does not stop merging. |
| 217 | Last detector off | — |

Problem IDs (`P-…`) and clock times differ per run; compare the counts and the lifecycle.

### Check a problem's contents

Events behind a problem (one row per failing endpoint, each with `endpoint.name`):

```bash
dtctl --context "$DT_CONTEXT" query 'fetch dt.davis.problems, from: now()-2h
| summarize {p = takeMax(record(timestamp, event.status, display_id, dt.davis.event_ids))}, by:{event.id}
| fieldsFlatten p'
```

The Bluebox poller reads problem records, not the table above:

```bash
dtctl --context "$DT_CONTEXT" query 'fetch events, from: now()-30m | filter event.kind == "DAVIS_PROBLEM" | fields timestamp, event.id, display_id, event.status, dt.davis.is_duplicate, event.name | sort timestamp asc'
```

For P3 this shows the shop-api problem with `is_duplicate=false` in its first two records and
`true` afterwards, which is why the poller's per-record `is_duplicate` filter still lets it
through (Experiment 3).

### Experiment 1: built-in detection without a custom detector

Disable all prototype detectors, then run the fault phases below and list Davis events with
`observe.sh`:

- Fault all four shop-api endpoints at 50% for 20 minutes, then fault only B for 20 minutes.
- Observed in the original run: one built-in `SERVICE_ERROR_RATE_INCREASED` event for
  `GET /api/products` only, and none for B. Zero problems.

This result depends on the baselines Davis had learned on the original tenant, where the faulted
endpoints had earlier learned ~98% failure from load storms. A fresh tenant has no baseline for
days, so expect no built-in events at all there. `preview.py <start> <end>` over the same window
shows the custom detector would have alerted on each faulted endpoint.

### Manual single-phase test (about 20 minutes)

```bash
export DT_CONTEXT=<your-dtctl-context>
davis-prototype/detector.sh davis-prototype/endpoint-5xx-detector.yaml true
davis-prototype/fault.sh '{"shop-api":{"GET /api/cart":0.5,"POST /api/cart":0.5}}' 'manual B+C'
sleep 600                                                    # events appear ~6 min in
davis-prototype/observe.sh "$(date -u -d '15 minutes ago' +%FT%TZ)"
davis-prototype/fault.sh '{}' 'manual healthy'
davis-prototype/detector.sh davis-prototype/endpoint-5xx-detector.yaml false
```

Expected: two events (B and C) and one problem containing both.

## 7. Gotchas

- **Host sleep.** When the machine hosting the VM sleeps, the VM stalls about 5 minutes and its clock
  falls behind. Spans then arrive back-dated and Dynatrace drops them without an exporter error.
  Keep the host awake and run `host-watch.sh` during long schedules. Compare `date -u` with the
  tenant's clock: `curl -sI https://<tenant-host>/ | grep -i ^date`. The
  2026-10-05 run 1 was lost to this.
- **Span `timestamp` is null** on the original tenants (check yours). Aggregate on `start_time` (the detectors use
  `time: start_time`).
- **Detector backfill.** A new or newly enabled detector alerts on the lookback window (the
  endpoint-in-name variant raised events back-dated to P4a's faults and opened an extra problem).
  Leave 25 minutes between phases so the previous problem closes and does not absorb the next one.
- **`dtctl apply --dry-run`** validates client-side only.
- **Ingest latency.** Spans are queryable after about 1 minute, logs after several minutes.

## 8. Open items

1. Fix the Bluebox poller's duplicate filter: take the latest record per `event.id`
   (`sort timestamp desc | dedup event.id | filter dt.davis.is_duplicate != true`) before
   filtering. `dtProblemPollerDQL` in `bluebox/src/backend/internal/workspace/auto_investigate_poller.go`
   currently filters per record and then runs `dedup event.id`.
2. Instrumentation gaps versus the Bluebox skills: missing `vcs.ref.head.revision`, the
   `Api-Token` scheme used with a platform token (the rule says `Bearer`), and the custom classic
   log exporter in `otel.js`. None affect span-based detection.
3. Decide between problems and events as the Bluebox input
   (`docs/davis-endpoint-alerting-results.md`, last section; `docs/design-davis-endpoint-problems.md`).

## 9. Cleanup after a run

```bash
for y in endpoint-5xx-detector endpoint-5xx-detector-no-merge endpoint-5xx-detector-endpoint-in-name; do
  DT_CONTEXT=<tenant> davis-prototype/detector.sh davis-prototype/$y.yaml false
done
davis-prototype/fault.sh '{}' 'cleanup'
podman rm -f davis-loadgen
make down
```

Detectors stay in the tenant, disabled, so their configuration stays available for inspection.

## 10. Where to read more

| Topic | File |
|---|---|
| Findings, tables, wrong early assumptions | `docs/davis-endpoint-alerting-results.md` |
| Design discussion (events vs problems) | `docs/design-davis-endpoint-problems.md` |
| Earlier, agent-oriented handoff for the rerun | `docs/handoff-davis-endpoint-alerting.md` |
| Conference demo runbook (duplicate-charge routine) | `docs/handoff-conference-demo.md` |
| Raw run numbers and UTC timeline | `davis-prototype/notes.md`, `davis-prototype/timeline.log` |
