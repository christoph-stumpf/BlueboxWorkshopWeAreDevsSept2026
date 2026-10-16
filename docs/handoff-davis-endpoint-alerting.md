# Handoff: Davis per-endpoint 5xx alerting prototype — rerun on hyq2999h

**Status 2026-10-05 (done):** run 2 on hyq2999h completed experiments 2–4 (08:02–11:24 UTC, no host stalls). Results: `docs/davis-endpoint-alerting-results.md`. All hyq2999h detectors are disabled (kept), app + load are stopped. Still open: report the miz8245h blocker to the Davis team, the Bluebox poller duplicate-filter finding (Experiment 3), and the instrumentation fixes (§5).

**Focus for next session:** rerun experiments 2–4 (custom detector: one service, two services,
two comparison variants) on sprint tenant **`hyq2999h`**, where Davis problems are created, and
write the results doc. Experiment 1 (built-in baseline) is done on `miz8245h` and is not rerun.

**Environment:** Linux, `podman` (the `docker` shim makes the Makefile work). Workspace
`/home/agent/workspace/BlueboxWorkshopWeAreDevsSept2026`, branch **`davis-endpoint-prototype`**,
everything uncommitted. Last worked: 2026-10-02.

Read first: memory `workshop-shop-local-run-gotchas.md`, `dynatrace-otlp-ingest-miz8245h.md`
(clock-skew check, span `timestamp` is null → bin on `start_time`), `davis-endpoint-prototype.md`.
Raw run notes with all numbers: `davis-prototype/notes.md`; UTC event log: `davis-prototype/timeline.log`.

---

## 1. Goal (from the original handoff)

Bluebox tenants are OTel-only. Get notified of a failing endpoint through Davis: one problem per
service naming every failing endpoint, separate problems per service. Questions:
1. Without a custom detector, does Davis open a problem for 5xx on an OTel-only service?
2. With one custom detector, one problem per service, each failing endpoint visible inside it?
3. Several services failing → one problem per service, no cross-service merging?

Downstream consumer: Bluebox's `DTProblemPoller`
(`bluebox/src/backend/internal/workspace/auto_investigate_poller.go:134-143`). It polls
`fetch events | filter event.kind == "DAVIS_PROBLEM"`, ACTIVE, start within 10 min, every minute;
one investigation task per problem `event.id`. Optional grouping (flag `dynatrace-problems-grouping`,
default off) suppresses a problem whose affected/root-cause entity overlaps an anchor from the last
2 h — the suppressed one is only logged (`:863-873`), never attached. `endpoint.name` is not read.

## 2. Results so far

### Experiment 1 — built-in detection, no custom detector (miz8245h, final)

| Run | Faults | Built-in Davis | Custom detector (analyzer preview, same window) |
|---|---|---|---|
| 1a 12:58–13:18 | all 4 shop-api endpoints 50% | 1 event `SERVICE_ERROR_RATE_INCREASED` for `GET /api/products` only (start 12:58, visible ~13:04, closed 13:20); 0 problems | 4 alerts, one per failing endpoint |
| 1b 13:33–13:53 | `GET /api/cart` 53% (~2% of service traffic) | 0 events, 0 problems | 1 alert, `GET /api/cart` |

- The built-in baselining detector **does** run on OTel-only services and emits service-level and
  per-endpoint events with `endpoint.name`, but only where the endpoint has a clean learned baseline.
  The other endpoints had learned ~98% failure from the 28–30 Sep storms.
- 1b's `payment GET /health` leg was invalid (setup bug, fixed); rerun optional.

### Experiment 2 — custom detector (miz8245h, events only)

- B+C failing → **two events, one per endpoint**, same stable `event.name`
  ("Endpoint 5xx error rate on shop-api"), endpoint in `event.description` and `endpoint.name`,
  bound to the service (`dt.smartscape_source.id`), own `dt.event.correlation_id` and
  `correlation_tag` each. All `{dims:…}` placeholders resolved.
- B recovers → B's event closes (~3 min after), C's stays open. Per-endpoint lifecycle confirmed.
- C fails again (P2c) → new `event.id`, **same `dt.event.correlation_id`** (`75c12fb6…`) as its P2a
  event: the correlation ID is stable per (detector, endpoint) across episodes.
- **No problem was created** → rerun on hyq2999h.

### Blocker found: miz8245h never creates problems

Identical probe detector applied to both tenants at 15:02 UTC: both raised the event; `hyq2999h`
opened problem `P-2610021` within ~1 min, `miz8245h` none. Raw bucket `default_davis_events` on
miz8245h holds only `DAVIS_EVENT` records since provisioning (25 Sep). Every in-tenant check passes
(event type/category, suppression, entity binding, maintenance windows, correlation rules, problem
pipelines, third-gen processing = default `PURE_2ND_GEN`, same as working tenants). Evidence for the
Davis-on-Grail team: tenant `miz8245h`, event `-6399018330223532515_1790952900000` vs `hyq2999h`
`P-2610021`. Not yet reported — ask the user whether to draft the message.

### Handoff claims that turned out wrong (keep for the results doc)

- Analyzer names `dt.statistics.ui.*` **are** real (`…StaticThresholdAnomalyDetectionAnalyzer`).
- `builtin:davis.anomaly-detectors` has no `davisMerge`; the merge switch is the event property
  `dt.davis.is_merging_allowed`.
- `dtctl apply --dry-run` validates client-side only; the real apply needs
  `executionSettings.actor` (a user/service-user UUID).
- No Record analyzer exists on these tenants → Phase 4 uses an "endpoint in event.name" variant instead.
- Spans-based `makeTimeseries` works as detector input (needs `time: start_time`).
- The poller reads `fetch events … DAVIS_PROBLEM`, not `dt.davis.problems`.

## 3. Rerun on hyq2999h

1. **Telemetry → hyq2999h.** The user swaps `.env` to the hyq2999h endpoint + header (a commented
   block is already there). Never read, print or edit the token (Bluebox instrumentation Hard rule 1).
   Check the host clock first (memory note).
2. **Start the app with a raised pool and the load:**
   ```bash
   cd /home/agent/workspace/BlueboxWorkshopWeAreDevsSept2026
   DB_POOL_SIZE=20 make up
   podman run -d --name davis-loadgen --network host -e DURATION=5h \
     -v ./loadgen/davis-endpoints.js:/scripts/davis-endpoints.js:ro \
     docker.io/grafana/k6:0.55.0 run --quiet /scripts/davis-endpoints.js
   ```
3. **Phase 0 on hyq2999h** (new service entities there): both services resolve to a
   `dt.smartscape.service`, `endpoint.name` populated —
   `dtctl --context hyq2999h query 'fetch spans, from: now()-10m | filter span.kind == "server" | summarize count(), by:{dt.service.name, dt.smartscape.service, endpoint.name}'`.
   Wait ≥15 min of healthy load before starting.
4. **Run the schedule** (offsets from launch, ~3.6 h; detectors are created on first apply and
   their IDs recorded in `davis-prototype/object-ids.tsv`):
   ```bash
   DT_CONTEXT=hyq2999h nohup setsid davis-prototype/schedule-p2-p4.sh \
     > davis-prototype/schedule.log 2>&1 < /dev/null &
   ```
   | T+min | Step | Expected |
   |---|---|---|
   | 0 | endpoint detector on | — |
   | 2–32 | P2a B+C 50%, at 17 B recovers | 1 problem, 2 events; at B's recovery its event closes, problem stays open |
   | 57–72 | P2c only C | 1 problem, 1 event (correlation-ID reuse already shown on miz8245h) |
   | 97–112 | P3 shop-api B+C + payment charge+refund | 2 problems (one per service), no cross-service merge — watch for topology merging via the shop-api → payment checkout call |
   | 137–152 | P4a no-merge variant | 2 problems (one per endpoint) |
   | 177–192 | P4b endpoint in `event.name` | records whether a per-endpoint name stops merging |
   | 217 | last detector off | — |
5. **Observe** while it runs: `DT_CONTEXT=hyq2999h davis-prototype/observe.sh <UTC start>`
   (latest event + problem state). Dry-run the analyzer on a past window:
   `DT_CONTEXT=hyq2999h davis-prototype/preview.py <start> <end>`.
   Consumer-side check per problem: its `dt.davis.event_ids` → `dt.davis.events` rows, one per
   failing endpoint (`endpoint.name`).

Note: `hyq2999h`'s dtctl context is `readwrite-all` (was already so). It is a separate
dtctl context safety level from `miz8245h`, which is back to `readonly`.

## 4. Deliverable

`docs/davis-endpoint-alerting-results.md`: expected-vs-observed table per experiment (1 from §2,
2–4 from hyq2999h), the miz8245h blocker, the wrong-claims list above, and the open design question
below. Prototype files: `davis-prototype/*.yaml` (dtctl style of the Bluebox settings dir),
`loadgen/davis-endpoints.js`, `faults.js`.

## 5. Open questions discussed with the user

- **Events vs problems for Bluebox.** Events alone carry service, endpoint, per-endpoint lifecycle
  and a stable `correlation_id` — enough for a dedicated event poller with configurable grouping
  (per endpoint / per service with later endpoints attached / none). Problems add merging, root
  cause, `P-…` identity and the annotation write-back the current poller uses. Today's poller on
  events + grouping would notify only the first endpoint per service (rest suppressed for 2 h).
- **Instrumentation audit** vs Bluebox skills: compliant except missing `vcs.ref.head.revision`,
  `Api-Token` scheme with a platform token (rule says `Bearer`), and the custom classic-log exporter
  in `otel.js`. None affect span-based detection. Fix after the run if the user wants.

## 6. Cleanup state / owed

- miz8245h: all 4 prototype detectors **disabled** (kept for inspection); context `readonly`.
  The P2c event and the probe event there still show ACTIVE (detectors disabled mid-episode).
- hyq2999h: probe detector **disabled**.
- App and load generator **stopped**; `faults.json` is `{}`.
- After the hyq2999h run: disable its detectors (keep config), stop load + `make down`.
- Git: nothing committed. Commit only when asked; ask before any push/PR; no AI-attribution trailers.
