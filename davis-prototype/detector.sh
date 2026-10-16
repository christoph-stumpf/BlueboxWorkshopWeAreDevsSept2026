#!/usr/bin/env bash
# Enable or disable a prototype detector on $DT_CONTEXT and record it in timeline.log.
# The YAML on disk stays enabled: false and tenant-neutral; the objectId per tenant lives in
# object-ids.tsv (recorded on first create, injected on later applies so they update in place).
# Usage: DT_CONTEXT=hyq2999h davis-prototype/detector.sh davis-prototype/endpoint-5xx-detector.yaml true|false
set -euo pipefail
ctx="${DT_CONTEXT:?set DT_CONTEXT to the dtctl context, e.g. hyq2999h}"
file="${1:?detector yaml required}"
state="${2:?true|false required}"
dir="$(cd "$(dirname "$0")" && pwd)"
ids="$dir/object-ids.tsv"
name="$(basename "$file")"
id="$(awk -F'\t' -v c="$ctx" -v f="$name" '$1==c && $2==f {print $3}' "$ids")"
tmp="$(mktemp --suffix .yaml)"
trap 'rm -f "$tmp"' EXIT
sed "s/^  enabled: .*/  enabled: $state/" "$file" > "$tmp"
[ -n "$id" ] && sed -i "s/^schemaId: builtin:davis.anomaly-detectors$/&\nobjectId: $id/" "$tmp"
out="$(dtctl --context "$ctx" apply -f "$tmp" --plain)"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") else 1)' || { echo "$out" >&2; exit 1; }
if [ -z "$id" ]; then
  id="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["id"])')"
  printf '%s\t%s\t%s\n' "$ctx" "$name" "$id" >> "$ids"
fi
printf '%s\t[%s] detector %s enabled=%s\t\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ctx" "$name" "$state" >> "$dir/timeline.log"
echo "[$ctx] $name enabled=$state"
