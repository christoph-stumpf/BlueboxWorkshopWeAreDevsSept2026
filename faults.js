const fs = require('node:fs');
const path = require('node:path');

// Fault injection for the Davis per-endpoint alerting prototype. faults.json maps
// service -> "<METHOD> <path>" -> probability of answering 500, e.g.
// { "shop-api": { "GET /api/cart": 0.5 } }. Re-read when its mtime changes, so
// faults switch on and off without a restart. A missing file injects nothing.
const file = process.env.FAULTS_FILE || path.join(__dirname, 'faults.json');
let cache = { mtimeMs: -1, faults: {} };

const load = () => {
  try {
    const { mtimeMs } = fs.statSync(file);
    if (mtimeMs !== cache.mtimeMs) cache = { mtimeMs, faults: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    cache = { mtimeMs: -1, faults: {} };
  }
  return cache.faults;
};

module.exports = (service, method, pathname) => {
  const rate = Number(load()[service]?.[`${method} ${pathname}`] || 0);
  return rate > 0 && Math.random() < rate;
};
