const https = require('node:https');
const { context, trace } = require('@opentelemetry/api');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const { LoggerProvider, SimpleLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

// Tenant miz8245h drops OTLP /v1/logs, so route console output to the classic
// Log Monitoring ingest API (/api/v2/logs/ingest), which lands in Grail. The
// endpoint and token are derived from the OTLP exporter env so no extra config
// is needed.
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const tokenMatch = (process.env.OTEL_EXPORTER_OTLP_HEADERS || '').match(/Api-Token\s+(\S+)/);
const ingestToken = tokenMatch ? tokenMatch[1] : null;
const classicLogsUrl = otlpEndpoint
  ? `${otlpEndpoint.replace(/\/api\/v2\/otlp\/?$/, '')}/api/v2/logs/ingest`
  : null;
const serviceName = process.env.OTEL_SERVICE_NAME || 'workshop-shop';
const loggingEnabled = Boolean(classicLogsUrl && ingestToken);

class ClassicLogExporter {
  constructor(ingestUrl, token, service) {
    this.url = new URL(ingestUrl);
    this.token = token;
    this.service = service;
  }
  export(records, resultCallback) {
    const payload = records.map(record => {
      const millis = record.hrTime ? record.hrTime[0] * 1e3 + record.hrTime[1] / 1e6 : Date.now();
      const entry = {
        content: typeof record.body === 'string' ? record.body : JSON.stringify(record.body),
        timestamp: new Date(millis).toISOString(),
        severity: record.severityText || 'INFO',
        'service.name': this.service,
        'log.source': 'console',
      };
      const spanContext = record.spanContext;
      if (spanContext && spanContext.traceId) {
        entry.trace_id = spanContext.traceId;
        entry.span_id = spanContext.spanId;
      }
      return entry;
    });
    const data = Buffer.from(JSON.stringify(payload));
    const request = https.request({
      hostname: this.url.hostname,
      port: this.url.port || 443,
      path: this.url.pathname,
      method: 'POST',
      headers: {
        Authorization: `Api-Token ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': data.length,
      },
    }, response => {
      response.resume();
      response.on('end', () => resultCallback({ code: response.statusCode < 300 ? 0 : 1 }));
    });
    request.on('error', error => resultCallback({ code: 1, error }));
    request.write(data);
    request.end();
  }
  shutdown() { return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}

const loggerProvider = loggingEnabled ? new LoggerProvider({
  processors: [new SimpleLogRecordProcessor({ exporter: new ClassicLogExporter(classicLogsUrl, ingestToken, serviceName) })],
}) : new LoggerProvider();
if (loggingEnabled) {
  logs.setGlobalLoggerProvider(loggerProvider);
}

const sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] });
sdk.start();

const originalConsole = { log: console.log, error: console.error, warn: console.warn };
const severity = { log: SeverityNumber.INFO, warn: SeverityNumber.WARN, error: SeverityNumber.ERROR };
for (const method of Object.keys(originalConsole)) {
  console[method] = (...args) => {
    originalConsole[method](...args);
    if (!loggingEnabled) return;
    const body = args.length === 1 ? args[0] : args.map(String).join(' ');
    const record = logs.getLogger('console').emit({
      body,
      severityNumber: severity[method],
      severityText: method.toUpperCase(),
      attributes: { 'log.type': 'console' },
      context: context.active(),
      timestamp: Date.now(),
    });
    return record;
  };
}

process.once('SIGTERM', async () => {
  await Promise.all([sdk.shutdown(), loggerProvider.shutdown()]);
});
