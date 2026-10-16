#!/usr/bin/env bash
# Timeline for experiments 2-4 on $DT_CONTEXT, as minute offsets from the start (T0 = launch).
# Endpoint B = shop-api GET /api/cart, endpoint C = shop-api POST /api/cart. On miz8245h neither
# had a clean built-in baseline, so only the custom detector reported; on a fresh tenant the
# built-in detector has no baseline at all for days.
# Recovery gaps (~25 min) let the previous problem close so runs don't merge into it.
# Usage: DT_CONTEXT=hyq2999h nohup setsid davis-prototype/schedule-p2-p4.sh > davis-prototype/schedule.log 2>&1 < /dev/null &
set -euo pipefail
: "${DT_CONTEXT:?set DT_CONTEXT to the dtctl context, e.g. hyq2999h}"
cd "$(dirname "$0")/.."
t0=$(date +%s)
at() { while [ $(( $(date +%s) - t0 )) -lt $(( $1 * 60 )) ]; do sleep 10; done; }
d=davis-prototype
BC='{"shop-api":{"GET /api/cart":0.5,"POST /api/cart":0.5}}'

at 0;   $d/detector.sh $d/endpoint-5xx-detector.yaml true
at 2;   $d/fault.sh "$BC" "[$DT_CONTEXT] P2a start: shop-api B+C 50%"
at 17;  $d/fault.sh '{"shop-api":{"POST /api/cart":0.5}}' "[$DT_CONTEXT] P2b: B (GET /api/cart) recovers, C (POST /api/cart) still 50%"
at 32;  $d/fault.sh '{}' "[$DT_CONTEXT] P2b end: all healthy"
at 57;  $d/fault.sh '{"shop-api":{"POST /api/cart":0.5}}' "[$DT_CONTEXT] P2c start: only C (POST /api/cart) 50%"
at 72;  $d/fault.sh '{}' "[$DT_CONTEXT] P2c end: all healthy"
at 97;  $d/fault.sh '{"shop-api":{"GET /api/cart":0.5,"POST /api/cart":0.5},"payment":{"POST /charge":0.5,"POST /refund":0.5}}' "[$DT_CONTEXT] P3 start: shop-api B+C + payment charge+refund 50%"
at 112; $d/fault.sh '{}' "[$DT_CONTEXT] P3 end: all healthy"
at 135; $d/detector.sh $d/endpoint-5xx-detector.yaml false; $d/detector.sh $d/endpoint-5xx-detector-no-merge.yaml true
at 137; $d/fault.sh "$BC" "[$DT_CONTEXT] P4a start: shop-api B+C 50% (no-merge variant)"
at 152; $d/fault.sh '{}' "[$DT_CONTEXT] P4a end: all healthy"
at 175; $d/detector.sh $d/endpoint-5xx-detector-no-merge.yaml false; $d/detector.sh $d/endpoint-5xx-detector-endpoint-in-name.yaml true
at 177; $d/fault.sh "$BC" "[$DT_CONTEXT] P4b start: shop-api B+C 50% (endpoint-in-name variant)"
at 192; $d/fault.sh '{}' "[$DT_CONTEXT] P4b end: all healthy"
at 217; $d/detector.sh $d/endpoint-5xx-detector-endpoint-in-name.yaml false
echo "schedule complete $(date -u +%T)"
