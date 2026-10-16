#!/usr/bin/env python3
"""Dry-run the detector's analyzer over a past timeframe and list the alerts it would raise.

Usage: DT_CONTEXT=hyq2999h davis-prototype/preview.py <start UTC> <end UTC> [detector.yaml]
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile

import yaml

start, end = sys.argv[1], sys.argv[2]
detector = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else pathlib.Path(__file__).with_name('endpoint-5xx-detector.yaml'))
inputs = {i['key']: i['value'] for i in yaml.safe_load(detector.read_text())['value']['analyzer']['input']}
request = {
    'generalParameters': {'timeframe': {'startTime': start, 'endTime': end}, 'resolveDimensionalQueryData': True},
    'extendedOutput': True,
    'timeSeriesData': {'expression': inputs['query.expression']},
    'threshold': float(inputs['threshold']),
    'alertCondition': inputs['alertCondition'],
    'slidingWindow': int(inputs['slidingWindow']),
    'violatingSamples': int(inputs['violatingSamples']),
    'dealertingSamples': int(inputs['dealertingSamples']),
    'alertOnMissingData': inputs['alertOnMissingData'] == 'true',
}
with tempfile.NamedTemporaryFile('w', suffix='.json') as f:
    json.dump(request, f)
    f.flush()
    out = subprocess.run(['dtctl', '--context', os.environ['DT_CONTEXT'], 'exec', 'analyzer',
                          'dt.statistics.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer',
                          '-f', f.name, '-o', 'json', '--plain'], capture_output=True, text=True, check=True).stdout
for series in json.loads(out)['result']['output']:
    dims = {d['key']: d['value'] for d in series['dimensions']}
    alerts = series.get('raisedAlerts') or []
    print(f"{dims.get('service_name')}\t{dims.get('endpoint')}\talerts={len(alerts)}\t"
          + '; '.join(json.dumps(a)[:300] for a in alerts))
