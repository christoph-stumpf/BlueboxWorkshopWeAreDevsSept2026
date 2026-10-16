# Davis problems per service and endpoint for OTel-only services

**Date:** 2026-10-05
**Status:** Draft. The findings are measured; the Bluebox changes are proposals.
**Scope:** a custom Davis anomaly detector for per-endpoint 5xx alerting, and its consumption by
`DTProblemPoller` (`src/backend/internal/workspace/auto_investigate_poller.go`,
`src/backend/internal/shared/problemgroup/`)
**Related:** [DT Problem Poller redesign](https://github.com/Dynatrace-AI-first/bluebox/blob/main/docs/design/2026-08-05-dt-problem-poller-redesign.md)
(grouping, duplicate filter); raw results in `docs/davis-endpoint-alerting-results.md` of the
BlueboxWorkshop repo (branch `davis-endpoint-prototype`)

---

## Context

Bluebox tenants are OTel-only. The goal is an automatic investigation whenever an endpoint
starts failing:

- one Davis problem per failing service, naming every failing endpoint;
- separate problems for separate services;
- the existing problem poller as the trigger.

Built-in Davis detection covers this only incidentally. On an OTel-only service the baselining
detector emits per-endpoint failure-rate events, but only for endpoints with a clean learned
baseline. In a test with four endpoints failing at 50%, it raised one event and no problem. A
low-volume endpoint failing at 50% (~2% of service traffic) raised nothing. A custom detector is
needed.

The findings below come from a prototype on sprint tenant `hyq2999h` (2026-10-05). The setup was
two services, `shop-api` and `payment`, with `shop-api` calling `payment` on checkout. Steady k6
load ran against all endpoints, and 5xx faults were injected per endpoint at 50%. Endpoint B is
`shop-api GET /api/cart` and endpoint C is `shop-api POST /api/cart`.

## 1. How Davis problems behave per service and endpoint

### Observed behaviour

| Scenario | Result |
|---|---|
| Two endpoints of one service fail (B+C) | **1 problem**, 2 events (one per endpoint). Each event carries `endpoint.name`. |
| One of them recovers (B) | B's event closes ~4 min later; the problem stays open with C. |
| The last one recovers (C) | C's event and the problem close together, ~4 min after recovery. |
| The same endpoint fails again later (C) | **New problem** (new `P-…`, new `event.id`); `dt.event.correlation_id` is the same as in the earlier episode. |
| Two services fail, the caller calls the callee (shop-api B+C, payment `POST /charge` + `POST /refund`) | **2 problems** open, one per service. ~1 min later Davis merges the caller's problem into the callee's: one problem with all 4 events, root cause = `payment`, the shop-api problem flagged `dt.davis.is_duplicate=true`. |
| Detector variant with `dt.davis.is_merging_allowed=false` | **1 problem per endpoint.** |
| Detector variant with the endpoint in `event.name` | Same-service events still share **1 problem**; the problem takes the name of the first event. |

### Mechanics

- **Per-service grouping.** Each detector event is bound to its service through
  `dt.smartscape_source.id`. Davis correlates events on the same entity into one problem;
  `event.name` plays no part in this.
- **Cross-service merge.** Davis root-cause analysis follows Smartscape topology. The merged
  problem records the evidence:
  - `causal_event_relations`: callee events → caller event;
  - `visual_resolution_path.edges`: `shop-api calls payment`;
  - `root_cause.smartscape_entity`: `payment`;
  - `duplicate_problem_ids`: `[shop-api problem]`.

  The analysis works at service level. It linked payment's failures to `POST /api/cart`, an
  endpoint that never calls payment. Services without a call edge are expected to stay separate;
  the prototype did not test that case.
- **Identity.** `event.id` and the problem `P-…` are per episode. `dt.event.correlation_id` is
  stable per (detector, endpoint) across episodes, and differs between detectors for the same
  endpoint.
- **Timing** (1-minute bins, 3-of-5 alert window, 5 clean samples to close):

  | Step | Time from fault start |
  |---|---|
  | Event start (back-dated to the first violating minute) | ~0–1 min |
  | Event visible in Grail | ~6 min |
  | Problem `event.start` | ~3 min after the event start |
  | First `DAVIS_PROBLEM` record in `fetch events` | ~6 min (same time as the events) |
  | Cross-service merge, `is_duplicate` set | ~1 min after the problems are created |
  | Event and problem close | ~4 min after recovery |

- **Problems keep changing after creation.** A problem that already exists gains events as more
  endpoints cross the threshold (B joined ~1 min after C), and it is merged and flagged later.
- **Lookback.** A newly created or re-enabled detector evaluates a lookback window and alerts on
  faults from the previous several minutes. A detector created two minutes before a fault alerted
  as fast as an existing one, so there is no warm-up period.

### Tenant prerequisite

Some tenants raise detector events but never create problems: `miz8245h` produced no
`DAVIS_PROBLEM` at all, while the same probe detector applied at the same time on `hyq2999h`
opened one within a minute. Problem creation needs to be checked per tenant before it is relied
on. This case is not yet reported to the Davis team.

## 2. Detector configuration

The detector is one settings object of schema `builtin:davis.anomaly-detectors`, scope
`environment`:

```yaml
schemaId: builtin:davis.anomaly-detectors
scope: environment
value:
  enabled: true
  title: "Endpoint 5xx error rate (OTel)"
  description: Per-endpoint 5xx error rate from server spans, one event per service endpoint.
  source: bluebox
  analyzer:
    name: dt.statistics.ui.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer
    input:
      - key: query.expression
        value: |-
          fetch spans
          | filter span.kind == "server" and isNotNull(dt.smartscape.service) and isNotNull(endpoint.name)
          | makeTimeseries {total = count(), errors = countIf(http.response.status_code >= 500)},
              by:{service_id = dt.smartscape.service, service_name = dt.service.name, endpoint = endpoint.name},
              interval: 1m, time: start_time
          | fieldsAdd error_rate = 100 * errors[] / total[]
          | fieldsRemove total, errors
      - { key: threshold,         value: "5" }      # percent
      - { key: alertCondition,    value: ABOVE }
      - { key: slidingWindow,     value: "5" }      # samples (minutes)
      - { key: violatingSamples,  value: "3" }
      - { key: dealertingSamples, value: "5" }
      - { key: alertOnMissingData, value: "false" }
  executionSettings:
    actor: <user or service-user UUID>              # identity the query runs as
  eventTemplate:
    properties:
      - { key: event.type,        value: ERROR_EVENT }
      - { key: event.name,        value: "Endpoint 5xx error rate on {dims:service_name}" }
      - { key: event.description, value: "5xx error rate on endpoint `{dims:endpoint}` of service `{dims:service_name}` was {alert_condition} {threshold}% within the sliding window." }
      - { key: dt.smartscape_source.id, value: "{dims:service_id}" }
      - { key: dt.source_entity,  value: "{dims:service_id}" }
      - { key: endpoint.name,     value: "{dims:endpoint}" }
      - { key: service.name,      value: "{dims:service_name}" }
      - { key: dt.davis.is_merging_allowed, value: "true" }
```

What each part does:

- **Signal.** One time series per (service, endpoint), built from server spans. It uses only
  fields populated on OTel-only spans: `dt.smartscape.service`, `dt.service.name`,
  `endpoint.name` and `http.response.status_code`. `time: start_time` is required because span
  `timestamp` is null on these tenants.
- **Analyzer.** The static-threshold analyzer alerts when the rate is above 5% in 3 of 5
  one-minute samples and closes after 5 clean samples. The thresholds are prototype values.
- **Event binding.** `dt.smartscape_source.id` attaches each event to its service; this is what
  produces one problem per service. `event.name` is kept free of the endpoint so the problem
  title is stable per service. The endpoint travels in `endpoint.name` and `event.description`.
- **Merge switch.** `dt.davis.is_merging_allowed`. Set it to `true` for one problem per service,
  or `false` for one problem per endpoint.
- **Actor.** `executionSettings.actor` is the identity the detector's query runs as every minute.
  The apply is rejected without it. The actor needs `storage:spans:read` and
  `storage:buckets:read`.
- **Apply.** `dtctl apply -f <file>` creates the object, and re-applying it with its `objectId`
  updates it in place. `--dry-run` validates client-side only.
- **Threshold tuning.** Thresholds can be tested against past data without creating events by
  calling the analyzer directly (`davis:analyzers:execute`, `dtctl exec analyzer …`). The
  prototype's `davis-prototype/preview.py` does this.

Corrections to earlier assumptions:
- The schema has no `davisMerge` field; the merge switch is the event property above.
- The `dt.statistics.ui.*` analyzer names are valid.
- These tenants offer no record-based analyzer.

## 3. Findings for the Bluebox problem poller

The current poller DQL (`dtProblemPollerDQL`, `auto_investigate_poller.go:130-138` at
`1f92a4c3b`):

```dql
fetch events, from:now()-10m
| filter event.kind == "DAVIS_PROBLEM"
| filter event.status == "ACTIVE"
| filter event.start > now()-10m
| filter isNull(dt.davis.mute.status) or dt.davis.mute.status == "NOT_MUTED"
| filter isNull(dt.davis.is_duplicate) or dt.davis.is_duplicate != true
| dedup event.id
| fields event.id, display_id, event.name, event.severity, event.start, affected_entity_ids,
         smartscape.affected_entities, root_cause.smartscape_entity
| limit 1000
```

### F1. Merged problems still open investigations

`fetch events` returns every snapshot record of a problem. The duplicate filter runs on each
record before `dedup event.id`. The shop-api problem in the cross-service test had two records
with `is_duplicate=false` (09:45:19 and 09:46:19) before it was flagged at 09:46:19. Those early
records stay inside the 10-minute window, so every poll in that window selects the problem, and
the poller opens a second investigation for it.

**Proposal:** reduce to the latest record per problem first, then filter:

```dql
| sort timestamp desc
| dedup event.id
| filter isNull(dt.davis.is_duplicate) or dt.davis.is_duplicate != true
| filter isNull(dt.davis.mute.status) or dt.davis.mute.status == "NOT_MUTED"
```

By the same reasoning, the `event.status` and mute filters also see earlier records of a problem
that closes or is muted inside the window. This is inferred from the record model; only the
duplicate case was observed. It affects all Davis problems, beyond this detector.

### F2. The first sighting is incomplete

The poller creates its task when it first sees a problem. At that moment the problem may still be
missing endpoints that join a minute later, and it may be merged into another problem shortly
after. In the cross-service test, the shop-api problem was investigated as a standalone problem
before Davis made the payment problem its parent.

**Proposal**, one of:
- a settle delay: open the task only for problems whose first record is at least ~3 min old;
- re-read the problem (event IDs, duplicate flag, root cause) when the investigation starts and
  hand over the current state.

The settle delay also covers F1 without depending on the filter order. It costs ~3 min of
latency on top of the ~6 min detection latency.

### F3. The investigation needs the endpoint list

The poller reads entity and root-cause fields, which identify only the service. The failing
endpoints are on the problem's events.

**Proposal:** resolve them via `dt.davis.event_ids`:

```dql
fetch dt.davis.events
| filter in(event.id, <problem's dt.davis.event_ids>)
| summarize {start = min(event.start), end = max(event.end), status = takeLast(event.status)},
    by:{endpoint.name, dt.smartscape_source.id}
```

Pass the result into the investigation context: service, failing endpoints with per-endpoint
start/end, and, for merged problems, Davis's root-cause service.

### F4. Problem grouping over-suppresses detector problems

`problemgroup.Signatures` keys on service-level entity IDs: affected entities plus the
root-cause entity, with a 2-hour window. With `bluebox-dt-problem-grouping` on, the first
investigation on `shop-api` would suppress, for 2 hours:

- a later failure of another `shop-api` endpoint;
- a second episode of the same endpoint;
- the merged cross-service problem, because it lists `shop-api` as affected.

That run would have produced one investigation for four separate incidents.

Davis already does the grouping that grouping was designed for: one problem per service, and
caller merged into callee. **Proposal:** exempt detector-generated problems from poller grouping,
for example by event name prefix or a detector-set property, or key their grouping on
(`dt.smartscape_source.id`, `endpoint.name`) instead of entity overlap.

### F5. Identity, recurrence and timing fit the current model

- One problem per episode maps onto the existing one-investigation-per-`display_id` dedup
  (`trigger_ref = "dt:" + display_id`).
- `dt.event.correlation_id` is stable per (detector, endpoint), so Bluebox can link a recurring
  failure to an earlier investigation ("same endpoint failed at 08:04").
- Problems appear in `fetch events` ~3 min after their `event.start`, inside the poller's
  `event.start > now()-10m` window.

### F6. The per-endpoint variant is an option

With `dt.davis.is_merging_allowed=false`, every failing endpoint gets its own problem and its own
investigation, and no cross-service merging happens. That means more investigations, each
narrower, and the root-cause linkage between caller and callee is lost. The per-service variant
fits "one investigation per failing service" better.

## 4. Open questions for creating the detector from Bluebox

### Permissions

1. **Minimum scope set.** dtctl maps the writes to `settings:objects:write` and the reads to
   `settings:objects:read`. The prototype applied detectors with a broad user session, so the
   minimum was not proven.
   *Test:* apply the detector with a platform token carrying only those two scopes.
2. **Schema-scoped policy.** Is a policy restricted to this schema valid and enforced?
   `ALLOW settings:objects:read, settings:objects:write WHERE settings:schemaId = "builtin:davis.anomaly-detectors";`
3. **Actor other than the caller.** Every prototype apply set `actor` to the applying user.
   Unknown: can an identity set another user or service user as actor, and which permission does
   that need?
4. **Actor permissions.** Does the actor need anything beyond `storage:spans:read` and
   `storage:buckets:read`? What happens to a running detector when the actor loses access: does
   it fail silently, disable itself, or raise a signal?

### Identity

5. **SPINE-provisioned tenants.** These tenants have a service user (`ServiceUserUUID` in the
   connection secret). Bluebox mints platform tokens for it, so it already holds span-read
   permissions. Its policy is owned by SPINE/LIMA and has no settings write. Can SPINE add
   `settings:objects:read/write`, limited to this schema?
   - IAM rejects a whole token mint when one requested scope is missing from the policy
     (#3303/#9600), so the policy change has to land before Bluebox requests the scope.
6. **SSO and manual connections.** Tenants connected this way have no Bluebox service user; the
   only available identity is the connecting person. Options to decide between:
   - the customer creates a service user;
   - Bluebox provisions one through Account Management;
   - the detector is offered as a customer-applied template.

### Lifecycle and configuration

7. **Ownership and updates.** How does Bluebox track its detector per tenant: store the
   `objectId`, or look it up by `source`/title? How are threshold changes rolled out? What
   happens when a customer edits or disables the detector?
8. **Thresholds per tenant or service.** Are 5% / 3-of-5 / 5 clean samples the right defaults?
   Do low-traffic endpoints need a minimum request count to avoid alerting on single failures?
   The prototype's lowest-volume endpoint carried ~12 req/min.
9. **Query cost.** The detector runs a spans query every minute over all server spans. What does
   that cost on a high-volume tenant, and does the query need a span sampling hint or a
   per-service filter?
10. **Problem creation per tenant.** How does Bluebox detect a tenant that raises events but never
    creates problems, like `miz8245h`? Options: a probe at onboarding, or alerting on detector
    events without problems.
11. **Coexistence with built-in detection.** Built-in baselining events are bound to the same
    service entities, so they are expected to land in the detector's problems. The prototype
    never saw both fire together. Is the combined problem still a good investigation trigger, or
    should the detector's problems be distinguishable (see F4)?
12. **Unrelated services.** Confirm that two failing services without a call edge stay in
    separate problems. The prototype only tested a calling pair.
