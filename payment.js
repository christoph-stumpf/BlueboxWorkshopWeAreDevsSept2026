const http = require('node:http');
const { randomUUID } = require('node:crypto');
const injectFault = require('./faults');
const port = Number(process.env.PORT || 4004);
const transactionsByOrder = new Map();
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  if (injectFault('payment', req.method, req.url)) return send(res, 500, { error: 'injected fault' });
  if (req.url === '/health') return send(res, 200, { status: 'ok', service: 'payment' });
  if (req.method === 'POST' && req.url === '/refund') { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { const input = JSON.parse(body || '{}'); if (!input.transactionId) return send(res, 400, { error: 'transactionId is required' }); send(res, 200, { status: 'refunded', transactionId: input.transactionId, refundId: `rfd_${randomUUID().slice(0, 8)}` }); }); return; }
  if (req.method !== 'POST' || req.url !== '/charge') return send(res, 404, { error: 'Not found' });
  let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { const input = JSON.parse(body || '{}'); if (!input.amountCents) return send(res, 400, { error: 'Amount is required' }); const transactionId = `txn_${randomUUID().slice(0, 8)}`; const previousTransactionId = transactionsByOrder.get(input.orderId); transactionsByOrder.set(input.orderId, transactionId); const log = { event: 'payment_transaction_created', orderId: input.orderId, transactionId, attempt: input.attempt, amountCents: input.amountCents }; if (previousTransactionId) log.duplicateOf = previousTransactionId; console.log(JSON.stringify(log)); const response = { status: 'approved', transactionId }; if (previousTransactionId) response.duplicateOf = previousTransactionId; const delay = input.attempt === 1 ? 500 : 0; setTimeout(() => send(res, 200, response), delay); });
}).listen(port, () => console.log(`payment service running at http://localhost:${port}`));
