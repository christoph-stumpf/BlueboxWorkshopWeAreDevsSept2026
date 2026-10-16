#!/usr/bin/env bash
# Print Davis events (latest snapshot per event) and problems since a UTC time.
# Usage: DT_CONTEXT=hyq2999h davis-prototype/observe.sh 2026-10-02T12:58:00Z
set -euo pipefail
since="${1:?since (UTC ISO timestamp) required}"
q() { dtctl --context "${DT_CONTEXT:?set DT_CONTEXT}" query "$1" --plain -o table; }
echo "## events since $since"
q "fetch dt.davis.events.snapshots, from: \"$since\"
| filter event.start >= toTimestamp(\"$since\")
| summarize {snap = takeMax(record(timestamp, event.status, event.end, event.name, event.type, dt.service.name, endpoint.name, dt.event.correlation_id, event.description))}, by:{event.id, event.start}
| fieldsFlatten snap
| fields event.start, status = snap.event.status, end = snap.event.end, type = snap.event.type, service = snap.dt.service.name, endpoint = snap.endpoint.name, name = snap.event.name, correlation_id = snap.dt.event.correlation_id, event.id
| sort event.start asc"
echo "## problems since $since"
q "fetch dt.davis.problems, from: \"$since\"
| filter event.start >= toTimestamp(\"$since\")
| summarize {p = takeMax(record(timestamp, event.status, event.end, event.name, display_id, affected_entity_names, dt.davis.event_ids))}, by:{event.id, event.start}
| fieldsFlatten p
| fields event.start, display_id = p.display_id, status = p.event.status, end = p.event.end, name = p.event.name, affected = p.affected_entity_names, n_events = arraySize(p.dt.davis.event_ids), events = p.dt.davis.event_ids
| sort event.start asc"
