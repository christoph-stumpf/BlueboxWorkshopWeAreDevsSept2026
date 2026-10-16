#!/usr/bin/env bash
# Set the injected 5xx faults and record the change in timeline.log.
# Usage: davis-prototype/fault.sh '<faults json>' '<label>'
#   davis-prototype/fault.sh '{"shop-api":{"GET /api/cart":0.5}}' 'P1b start'
#   davis-prototype/fault.sh '{}' 'all healthy'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
faults="${1:?faults json required}"
label="${2:-}"
printf '%s' "$faults" | python3 -c 'import json,sys; json.load(sys.stdin)'
tmp="$(mktemp "$root/.faults.XXXXXX")"
printf '%s\n' "$faults" > "$tmp"
chmod 644 "$tmp"
mv "$tmp" "$root/faults.json"
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$faults" >> "$root/davis-prototype/timeline.log"
