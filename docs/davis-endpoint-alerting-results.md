# Davis per-endpoint 5xx alerting on OTel-only services — results

Prototype on branch `davis-endpoint-prototype`. Raw numbers: `davis-prototype/notes.md`; UTC event
log: `davis-prototype/timeline.log`; host stall/skew log for the hyq2999h run:
`davis-prototype/host-health.log`.

## Summary

| Question | Answer |
|---|---|
| Q1: built-in Davis opens a problem for OTel 5xx? | Only incidentally: per-endpoint events appear where a clean learned baseline exists; 0 problems in both runs |
| Q2: one custom detector → one problem per service with each endpoint inside? | Yes. One problem per service, one event per failing endpoint with `endpoint.name`, per-endpoint close, a new problem per episode |
| Q3: several services → one problem per service? | Only for services that don't call each other. Davis merges a caller's problem into its callee's ~1 min after opening both and names the callee as root cause |
| Variant: no merge | `dt.davis.is_merging_allowed=false` → one problem per endpoint |
| Variant: endpoint in `event.name` | Same-service events still merge into one problem |

Bluebox impact: the poller's duplicate filter lets a merged problem through (Experiment 3), so a
cross-service failure opens two investigations.

## Goal

Bluebox tenants are OTel-only. The target behaviour: a failing endpoint produces a Davis problem,
one problem per service that names every failing endpoint, and separate problems per service.

1. Without a custom detector, does Davis open a problem for 5xx on an OTel-only service?
2. With one custom detector, is there one problem per service with each failing endpoint visible
   inside it?
3. With several services failing, is there one problem per service and no cross-service merging?

Consumer: Bluebox's `DTProblemPoller`
(`bluebox/src/backend/internal/workspace/auto_investigate_poller.go`, `dtProblemPollerDQL`; line references below are from commit `1f92a4c3b`) polls
`fetch events | filter event.kind == "DAVIS_PROBLEM"` (ACTIVE, started within 10 min) every minute
and opens one investigation task per problem `event.id`. It does not read `endpoint.name`.

## Setup

- App: Workshop Shop (`shop-api`, `payment`), OTel SDK → OTLP, `DB_POOL_SIZE=20`.
- Load: `loadgen/davis-endpoints.js` (k6), steady traffic on all endpoints.
- Faults: `faults.js` reads `faults.json` (`{service: {endpoint: rate}}`) and returns 5xx at that
  rate; driven by `davis-prototype/fault.sh`.
- Detector: `davis-prototype/endpoint-5xx-detector.yaml`. A spans-based `makeTimeseries` of the 5xx
  rate per (`dt.smartscape.service`, `endpoint.name`), 1-minute bins on `start_time`, static
  threshold 5%, alert on 3 of 5 samples, close after 5 clean samples. `event.name` carries only the
  service; the endpoint is in `event.description` and the `endpoint.name` property; the event binds
  to the service via `dt.smartscape_source.id`.
- Variants: `…-no-merge.yaml` (`dt.davis.is_merging_allowed=false`) and `…-endpoint-in-name.yaml`
  (endpoint in `event.name`).
- Endpoints under test: B = `shop-api GET /api/cart`, C = `shop-api POST /api/cart`.

## Experiment 1 — built-in detection, no custom detector (miz8245h)

| Run | Faults | Expected | Built-in Davis | Custom detector (analyzer preview, same window) |
|---|---|---|---|---|
| 1a 12:58–13:18 | all 4 shop-api endpoints 50% | event/problem for the service | 1 event `SERVICE_ERROR_RATE_INCREASED` for `GET /api/products` only (start 12:58, visible ~13:04, closed 13:20); 0 problems | 4 alerts, one per failing endpoint |
| 1b 13:33–13:53 | `GET /api/cart` 53% (~2% of service traffic) | event/problem for the endpoint | 0 events, 0 problems | 1 alert, `GET /api/cart` |

The built-in baselining detector runs on OTel-only services and emits service-level and
per-endpoint events with `endpoint.name`, but only where the endpoint has a clean learned
baseline. The other endpoints had learned ~98% failure from the 28–30 Sep load storms. A
low-volume endpoint failing at 50% moves the service-level rate by ~1% and stays below the
service-level detection.

**Answer to Q1:** built-in detection is baseline-dependent and endpoint coverage is incidental.
A custom detector is needed for reliable per-endpoint alerting.

## Experiment 2 — custom detector, one service

### Event level (miz8245h)

- B+C failing → two events, one per endpoint, same stable `event.name`
  ("Endpoint 5xx error rate on shop-api"), endpoint in `event.description` and `endpoint.name`,
  bound to the service (`dt.smartscape_source.id`), each with its own `dt.event.correlation_id` and
  `correlation_tag`. All `{dims:…}` placeholders resolved. Visible ~5.5 min after fault start.
- B recovers → B's event closes ~3 min later; C's stays open. Lifecycle is per endpoint.
- C fails again → new `event.id`, same `dt.event.correlation_id` as its earlier event. The
  correlation ID is stable per (detector, endpoint) across episodes; `event.id` is per episode.

### Problem level (hyq2999h, run 2, 2026-10-05)

| Phase (UTC) | Faults | Expected | Observed |
|---|---|---|---|
| P2a 08:04:40–08:19:40 | B+C 50% | 1 problem, 2 events | Events B and C start 08:04, visible 08:11. **1 problem `P-2610052`** (start 08:07) with both events |
| P2b 08:19:40–08:34:40 | B recovers, C still 50% | B's event closes, problem stays open | B's event end 08:24; C's event and `P-2610052` stay ACTIVE. Both close with end 08:38 when C recovers |
| P2c 08:59:40–09:14:40 | C 50% | 1 problem, 1 event | New event for C (same `correlation_id` `c872dd45…` as in P2a), **new problem `P-2610053`** (start 09:02). Closed with end 09:18 |

- Detection latency: event visible ~6 min after fault start, back-dated to the first violating
  minute; the problem starts ~3 min after the event (`dt.analysis.offset` −3 min) and appears in
  `fetch events … DAVIS_PROBLEM` at about the same time as the events.
- A problem closes with its last event, ~4 min after the endpoint recovers (5 clean samples).
- Each new episode on an endpoint opens a new problem, even with the same `correlation_id`. For
  Bluebox this is one investigation per episode.
- Consumer view: each problem's `dt.davis.event_ids` resolve to one `dt.davis.events` row per
  failing endpoint, each carrying `endpoint.name`.

**Answer to Q2:** yes. One custom detector gives one problem per service, with one event per
failing endpoint inside it and a per-endpoint lifecycle.

## Experiment 3 — two services failing (hyq2999h)

| Phase (UTC) | Faults | Expected | Observed |
|---|---|---|---|
| P3 09:39:40–09:54:40 | shop-api B+C, payment `POST /charge` + `POST /refund`, all 50% | 2 problems, one per service | 4 events (09:39–09:40). At 09:42 **2 problems**: `P-2610054` payment (charge, refund) and `P-2610055` shop-api (B, C). At ~09:46 Davis **merged them**: `P-2610055` flagged `dt.davis.is_duplicate=true`, `P-2610054` holds all 4 events. All closed with end 09:58 |

The merge is Davis root-cause analysis over topology. `P-2610054` records
`root_cause.smartscape_entity = payment`, `smartscape.affected_entities = [payment, shop-api]`,
`visual_resolution_path` edge shop-api `calls` payment, `causal_event_relations` charge → C and
refund → C, `duplicate_problem_ids = [P-2610055]`, and keeps the payment event's name. The causal
link is spurious at endpoint level (`POST /api/cart` does not call payment); the analysis reasons
on the service call edge.

Problem-record timeline (`fetch events | filter event.kind == "DAVIS_PROBLEM"`): both problems
CREATED 09:45:19; `P-2610055` carries `is_duplicate=false` at 09:45:19 and 09:46:19 and `true`
from 09:46:19 on.

**Answer to Q3:** no, when the failing services call each other. Davis opens one problem per
service first and then merges the caller's problem into the callee's within ~1 minute,
attributing root cause to the callee. Unrelated services (no call edge) are expected to stay
separate; this run did not test that case.

**Bluebox consequence.** The poller DQL (`dtProblemPollerDQL`, `auto_investigate_poller.go:130-138`)
filters `dt.davis.is_duplicate != true` per record and then runs
`dedup event.id`. `P-2610055`'s early `is_duplicate=false` records stay in the 10-minute window,
so the poller opens an investigation for `P-2610055` as well as `P-2610054`. Skipping merged
problems requires taking the latest record per `event.id` first
(`sort timestamp desc | dedup event.id | filter …`).

## Experiment 4 — comparison variants (hyq2999h)

| Phase (UTC) | Variant | Faults | Expected | Observed |
|---|---|---|---|---|
| P4a 10:19:40–10:34:40 | `dt.davis.is_merging_allowed=false` | B+C 50% | 2 problems, one per endpoint | Events C (10:19) and B (10:20). **2 problems**: `P-2610056` (C, start 10:22) and `P-2610057` (B, start 10:23). Closed with end 10:38 |
| P4b 10:59:40–11:14:40 | endpoint in `event.name` | B+C 50% | records whether a per-endpoint name stops merging | Events C and B (10:59). **1 problem `P-2610059`** (start 11:02) with both events, named after the first event ("5xx error rate on shop-api POST /api/cart") |

- Merging follows the entity binding (`dt.smartscape_source.id`), independent of `event.name`.
  `dt.davis.is_merging_allowed=false` is the switch for one problem per endpoint.
- `dt.event.correlation_id` is per (detector, endpoint): the same endpoint gets a different ID
  under each detector variant, and keeps it across episodes within one detector.
- A newly created or newly enabled detector evaluates a lookback window and alerts on past data.
  The endpoint-in-name variant, enabled at 10:35:05 (faults off since 10:34:40), raised B and C
  events back-dated to 10:29 and opened `P-2610058`, which also held both events. This happened
  after P4a's problems had formed and repeats P4b's result.
- A freshly created detector alerts within ~6 min (P4a's detector was created at 10:17:46).

## miz8245h never creates problems

An identical probe detector (`davis-prototype/problem-creation-probe.yaml`) was applied to both
tenants at 2026-10-02 15:02 UTC. Both raised the event; `hyq2999h` opened `P-2610021` within ~1
min and `miz8245h` opened none. The raw bucket `default_davis_events` on miz8245h holds only
`DAVIS_EVENT` records since provisioning (25 Sep). In-tenant settings match working tenants: event
type/category, suppression, entity binding, maintenance windows, correlation rules, problem
pipelines, third-gen processing (`PURE_2ND_GEN`, the default). Evidence for the Davis-on-Grail team:
miz8245h event `-6399018330223532515_1790952900000` vs hyq2999h `P-2610021`. Not yet reported.

## Original handoff claims that turned out wrong

- Analyzer names `dt.statistics.ui.*` are real
  (`dt.statistics.ui.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer`).
- `builtin:davis.anomaly-detectors` has no `davisMerge` field; the merge switch is the event
  property `dt.davis.is_merging_allowed`.
- `dtctl apply --dry-run` validates client-side only; the real apply needs
  `executionSettings.actor` (a user or service-user UUID).
- These tenants have no Record analyzer, so Experiment 4 uses an "endpoint in `event.name`"
  variant instead.
- Spans-based `makeTimeseries` works as detector input; it needs `time: start_time` because span
  `timestamp` is null on these tenants.
- The poller reads `fetch events … DAVIS_PROBLEM`, not `dt.davis.problems`.

## Run log and validity

- hyq2999h run 1 (2026-10-05 06:51–07:21) was aborted: the host Mac went to sleep and the VM
  stalled ~5 min. Its only usable observation: hyq2999h opened `P-2610051` from the endpoint
  detector (1 event, C).
- hyq2999h run 2 (08:02:40–11:24, all results above) ran with the Mac on power.
  `davis-prototype/host-watch.sh` logged every minute to `host-health.log`; it recorded no stall
  (tick gap >90 s) and no clock skew (>20 s) during the run. Before the second stall, the guest
  clock fell behind (−73 s, then −296 s) before the VM froze, so in run 1 spans were likely already
  late before the 07:05 stall. That explains why run 1's first P2a episode raised no event.
- Deviation in run 2: the endpoint-in-name variant was enabled at 10:35:05 instead of 10:57:40.
  Its lookback raised back-dated events on P4a's fault data (Experiment 4, `P-2610058`). P4a's
  problems had formed before then.
- The schedule was stopped after P4b closed; its final step (disable the last detector) was done
  by hand at 11:25.

## Open design question: events vs problems for Bluebox

Events alone carry service, endpoint, per-endpoint lifecycle and a stable `correlation_id`, which
is enough for a dedicated event poller with configurable grouping (per endpoint, per service with
later endpoints attached, or none). Problems add merging, root cause, `P-…` identity and the
annotation write-back the current poller uses. With today's poller and the optional grouping flag
(`dynatrace-problems-grouping`), a second endpoint's problem on the same service within 2 h is
suppressed and only logged (`writeTenantProblems`, `auto_investigate_poller.go:646-670`), so only the first endpoint per
service would reach an investigation.

The hyq2999h run supports problems for the default case: one problem per service per episode
with every failing endpoint inside matches "one investigation per failing service". The
topology merge (Experiment 3) works against "separate problems per service" whenever one failing
service calls another; with problems, Bluebox gets one investigation rooted at the callee (once
the duplicate filter is fixed). An event-based poller can keep services separate by grouping on
`dt.smartscape_source.id` itself.
