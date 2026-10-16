#!/usr/bin/env bash
# Print probe event status and Davis problem count per tenant whenever either changes.
# Usage: davis-prototype/probe-watch.sh hyq2999h miz8245h
prev=""
while true; do
  out=""
  for c in "$@"; do
    ev=$(dtctl --context "$c" query 'fetch dt.davis.events.snapshots, from: now()-30m | filter event.name == "Problem creation probe" | summarize st=takeMax(record(timestamp, event.status)), by:{event.id} | fieldsAdd status = st[event.status] | fields event.id, status' --plain -o json 2>/dev/null \
      | python3 -c 'import json,sys
try:
  r=json.load(sys.stdin)["result"]["records"] or []; print(",".join(x["status"] for x in r) or "none")
except Exception: print("err")')
    pr=$(dtctl --context "$c" query 'fetch events, from: now()-30m | filter event.kind == "DAVIS_PROBLEM" | summarize n=countDistinct(event.id), names=collectDistinct(event.name)' --plain -o json 2>/dev/null \
      | python3 -c 'import json,sys
try:
  r=json.load(sys.stdin)["result"]["records"][0]; print(r["n"], r["names"])
except Exception: print("err")')
    out="$out ${c}: events=${ev} problems=${pr} |"
  done
  [ "$out" != "$prev" ] && echo "$(date -u +%T)$out"
  prev=$out
  sleep 45
done
