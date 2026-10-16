# Run notes (raw, filled during the run)

## P1a 12:58:02–13:18:03 UTC, all 4 shop-api endpoints 50% 5xx, no custom detector
- Observed 5xx rate per endpoint: GET /api/products 50% (6220 req), POST /api/cart 51% (1320), GET /api/cart 50% (240), POST /api/checkout 61% (120). payment 0%.
- Built-in: ONE event, SERVICE_ERROR_RATE_INCREASED "Failure rate increase", shop-api, endpoint.name = GET /api/products, provider BASELINING, start 12:58 (back-dated), first visible ~13:04 (~6 min), closed 13:20. correlation_id b0796a… (same as the 29/30 Sep products events).
- No event for the other three failing endpoints (their baselines learned ~98% failure on 28–30 Sep). No service-level event this time (one fired on 29 Sep).
- Problems: 0 (checked 13:22).
- Preview of the custom detector (analyzer dry-run, same window): 1 alert each for the 4 shop-api endpoints (12:58 → 13:23/13:24), 0 for payment.

## P1b 13:33:04–13:53:05 UTC, low-volume endpoints 50% 5xx, no custom detector
- shop-api GET /api/cart: 53% 5xx (125/237 req; ~2% of shop-api's ~7.8k requests). Rest of shop-api 0%.
- Built-in: NO event, no problem (checked 13:52 and 13:55). Caveat: this endpoint's baseline learned ~98% failure on 28–30 Sep.
- Preview of the custom detector (same window): 1 alert, shop-api GET /api/cart (13:33 → 13:58), nothing else.
- payment GET /health leg INVALID: payment.js answered /health before the fault check (0/197 failed). Fixed 13:53 (payment restarted, ~13 s outage). Rerun as P1b' after the main schedule.

## Problem-creation probe (davis-prototype/problem-creation-probe.yaml), applied 15:02 UTC
- hyq2999h objectId vu9U3hXa3q0AAAABAB9idWlsdGluOmRhdmlzLmFub21hbHktZGV0ZWN0b3JzAAZ0ZW5hbnQABnRlbmFudAAkYjdiNDBjMWEtMjRmYy0zNzlkLWFlNjctNmYzZjkyNTk2MTNlvu9U3hXa3q0
- miz8245h objectId vu9U3hXa3q0AAAABAB9idWlsdGluOmRhdmlzLmFub21hbHktZGV0ZWN0b3JzAAZ0ZW5hbnQABnRlbmFudAAkMWQ5MjUyZWYtYjQ1OS0zMDQzLTlmZmItNGVkOGNmY2YzYzhlvu9U3hXa3q0
- Cleanup: disable both (or delete; they are probes, not prototype config).
- Result: both tenants raised the probe event at the same time (ACTIVE by 15:03). hyq2999h opened problem P-2610021 ("Problem creation probe", 1 event, source classic_root_cause_analysis, analysis ready) by 15:04. miz8245h opened none. Problem creation is broken on miz8245h only.
- Both probes disabled ~15:06.

## P2a/P2b on miz8245h (event level only — miz8245h never creates problems)
- 14:08 detector enabled; 14:10 B (GET /api/cart) + C (POST /api/cart) 50%.
- Two custom events, visible 14:15:28 (~5.5 min): one per endpoint, event.name "Endpoint 5xx error rate on shop-api" (stable), endpoint in event.description + endpoint.name, dt.smartscape_source.id = SERVICE-E0B5A764DCDB4246, ERROR_EVENT/ERROR, merging allowed, own correlation_id each (B d3c33283…, C 75c12fb6…), own correlation_tag. All {dims:…} placeholders resolved.
- 14:25 B recovers: B's event end 14:28, CLOSED snapshot 14:31:51; C stays ACTIVE until faults end 14:40 (C's event end 14:43).
- No problem (expected 1 problem with 2 events).
- P2c 15:05–15:15 (C alone, stopped early): new event 6765498174907715003_1790953500000 with the SAME correlation_id 75c12fb6… as C's P2a event → correlation_id is stable per (detector, endpoint) across episodes; event.id is per episode.
- Left ACTIVE after the stop: the P2c event and the miz8245h probe event (their detectors were disabled mid-episode).

## hyq2999h run 1, 2026-10-05 — ABORTED at 07:21 (VM restart), results unusable
- Clock checked 06:34 (host behind real time by ~58 h on 2 Oct; the user fixed it). Phase 0 passed: shop-api SERVICE-E0B5A764DCDB4246 (same ID as on miz8245h), payment SERVICE-2AFD8C451321B3B1, endpoint.name populated. Healthy baseline 06:35–06:51: 1 5xx out of ~8.2k.
- T0 06:51:23, detector created (objectId in object-ids.tsv). P2a B+C 50% from 06:53:23.
- The VM stalled for ~5 min around 07:05–07:10: no spans in that window, the scheduler's T+17 step ran at 07:13:53 instead of 07:08, and the host clock fell 70 s behind afterwards.
- Davis raised NO event for P2a's first episode (06:53–07:05). The analyzer preview for the same window shows one alert each for B and C, 06:53→07:10. Cause unknown: maybe warm-up of a freshly created detector, maybe the stall. Still open.
- After the stall: one event for C only (POST /api/cart), start 07:13, correlation_id c872dd45…, and problem P-2610051 (1 event, opened 07:16). So hyq2999h does create problems from this detector.
- Stopped 07:21: faults {}, detector disabled, loadgen + app down.

## hyq2999h run 2, 2026-10-05 (T0 08:02:40; Mac kept on power)
- P2a 08:04:40 B+C 50%. By 08:11:07: two events (B -1024549086281038509_1791187440000 corr 306d5ca3…; C 748288292181601001_1791187440000 corr c872dd45…, the SAME corr as run 1's C event), both start 08:04 (back-dated). ONE problem P-2610052, start 08:07, 2 events. Expected outcome met.
- A re-enabled (already existing) detector alerted ~6 min after the fault started. In run 1 the freshly created detector raised nothing in 12 min of faults before the stall → probably warm-up after creation.
- 08:19:40 B recovers. B's event CLOSED with end 08:24 (seen 08:30:21); C's event and P-2610052 stay ACTIVE.
- 08:34:40 all healthy. C's event end 08:38; P-2610052 CLOSED with end 08:38 (seen 08:42:18), i.e. the problem closes with its last event.
- P2c 08:59:40 C only. By 09:06:27: new event -3940716955779460350_1791190740000 (start 08:59), corr c872dd45… again; NEW problem P-2610053 (start 09:02, 1 event). P-2610052 stays closed, so a new episode opens a new problem.
- 09:14:40 healthy. C's event and P-2610053 CLOSED with end 09:18.
- P3 09:39:40 shop-api B+C + payment charge+refund 50%. Events: payment POST /charge (corr 66e069fd…), POST /refund (7cacf2b8…), shop-api C (c872dd45…) start 09:39, seen 09:45:36; B (306d5ca3…, same corr as in P2a) start 09:40, seen 09:46:37. TWO problems, both start 09:42: P-2610054 payment (charge+refund), P-2610055 shop-api (B+C). No cross-service merge as of 09:46.
- 09:47:03 CROSS-SERVICE MERGE: P-2610055 (shop-api) got dt.davis.is_duplicate=true; P-2610054 (payment) now holds all 4 events, duplicate_problem_ids=[P-2610055], root_cause.smartscape_entity = payment, smartscape.affected_entities = payment + shop-api, visual_resolution_path edge shop-api -calls-> payment, causal_event_relations charge→cart(C) and refund→cart(C). Merge came ~5 min after both problems opened (rca_engine platform, source classic_root_cause_analysis). The causal link is spurious: POST /api/cart does not call payment; RCA works on the service-level call edge. Both problems still exist as records; P-2610055 is flagged duplicate. matched_correlation_rule objectId …OGJjNWEzOTAt… (builtin:event-correlation-rules, uuid 8bc5a390…) is unreadable via dtctl get settings (404).
- Problem record timeline (fetch events DAVIS_PROBLEM): both CREATED 09:45:19 (visible ~3 min after event.start 09:42); P-2610055 is_duplicate=false at 09:45:19 and 09:46:19, true from 09:46:19 (second record) on; P-2610054 grows to 4 events at 09:46:29.
- Bluebox consequence: the poller DQL (bluebox-new-ui checkout, auto_investigate_poller.go:130-138) filters `is_duplicate != true` per record BEFORE `dedup event.id`, so P-2610055's early is_duplicate=false records keep matching for the whole 10-min window → the poller opens a task for P-2610055 as well as P-2610054. To skip merged problems, it would need the latest record per event.id first (e.g. sort timestamp desc | dedup event.id | filter …).
- 09:54:40 healthy. All 4 events and both problems CLOSED with end 09:58 (seen 10:02:54).
- P4a 10:19:40 B+C 50%, no-merge variant, CREATED by the schedule at 10:17:46 (main detector disabled at the same time). The C event (-7773612182052443867_1791195540000, start 10:19, corr c2a17ac9…, a NEW corr vs the main detector's c872dd45…) was seen 10:25:08 → a freshly created detector alerts within ~5.5 min; run 1's miss was NOT warm-up. More likely the Mac was already throttling before the 07:05 stall: before the second stall the guest clock drifted -73 s then -296 s. correlation_id is per (detector, endpoint).
- B event -2220897696963483292_1791195600000 (start 10:20, corr bb3e723c…) seen 10:26:08. TWO problems: P-2610056 (C only, start 10:22) and P-2610057 (B only, start 10:23, seen 10:27:09). Expected outcome met: dt.davis.is_merging_allowed=false gives one problem per endpoint.
- CONTAMINATION from my pre-create: the endpoint-in-name detector, enabled 10:35:05 (faults {} since 10:34:40), raised B (-2816618251565943677_1791196140000, corr 109e19ba…) and C (-4807024664426674009_1791196140000, corr 4f9e438b…) events back-dated to start 10:29, seen 10:38:15. A newly enabled detector evaluates a lookback window (≥6 min) and alerts on past data. P4a's own outcome (two problems at 10:22/10:23) had formed before this.
- 10:39:16 the two contaminating endpoint-in-name events merged into ONE problem P-2610058 (start 10:32, named after the first event, 'GET /api/cart'). Early P4b answer: endpoint in event.name does not prevent same-service merging. P-2610058 did not merge with P4a's non-mergeable P-2610056/57.
- All P4a events and P-2610056/57/58 CLOSED with end 10:38 (seen 10:43:18).
- P4b 10:59:40 B+C 50%, endpoint-in-name variant (enabled since 10:35:05). Events C -6177765626850836009_1791197940000 (corr 4f9e438b…, reused) + B 5592539254240138474_1791197940000 (corr 109e19ba…, reused), start 10:59, seen 11:05:20. ONE problem P-2610059 (start 11:02, 2 events, named after C), seen 11:06:20. Confirms P-2610058: endpoint in event.name does not stop same-service merging.
