#!/usr/bin/env bash
# Run alongside a schedule: nohup setsid davis-prototype/host-watch.sh &
# Every 60 s: log the gap since the last tick (a gap above 90 s means a stall) and the host clock skew vs the tenant.
log=davis-prototype/host-health.log
last=$(date +%s)
while true; do
  sleep 60
  now=$(date +%s); gap=$((now-last)); last=$now
  dt=$(curl -sI --max-time 10 https://hyq2999h.sprint.dynatracelabs.com/ | grep -i ^date | cut -d' ' -f2- | tr -d '\r')
  skew=$([ -n "$dt" ] && echo $(( now - $(date -d "$dt" +%s) )) || echo "?")
  flag=""; [ "$gap" -gt 90 ] && flag="STALL"; [ "$skew" != "?" ] && [ "${skew#-}" -gt 20 ] && flag="$flag SKEW"
  printf '%s\tgap=%ss\tskew=%ss\t%s\n' "$(date -u +%FT%TZ)" "$gap" "$skew" "$flag" >> $log
done
