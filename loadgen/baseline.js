import http from 'k6/http';
import { check, sleep } from 'k6';

// Healthy-baseline profile: browse-only traffic (catalog + cart) at low
// concurrency. It deliberately never calls /api/checkout, so it avoids both
// intended defects — the 2-permit DB pool stays ahead of demand (no
// database_pool_exhausted 500s) and no payment retry fires (no double-charge).
// Use this to establish a clean "green" period before triggering the problem
// patterns (smoke.js failure storm / checkout.js duplicate charge).
//
// Runs single-VU by default: every request holds a pool connection across a
// 250ms DB hop and some routes chain multiple DB calls, so even 2 VUs can
// momentarily demand a 3rd connection and leak the odd pool-exhaustion 500.
// One VU serializes all requests, keeping at most one connection in flight.
const baseUrl = __ENV.TARGET_URL || 'http://shop:8088';
const products = ['aurora-mug', 'signal-notebook', 'orbit-lamp', 'cloud-socks', 'field-bag', 'night-hoodie'];

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '120s',
  thresholds: {
    // Baseline must be clean.
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

function jsonRequest(method, path, payload, tags) {
  return http.request(method, `${baseUrl}${path}`, payload ? JSON.stringify(payload) : null, {
    headers: { 'Content-Type': 'application/json' },
    tags,
  });
}

export default function () {
  const userId = `baseline-${__VU}-${__ITER}`;
  const tags = { workload: 'workshop-shop', user_id: userId };

  const catalog = http.get(`${baseUrl}/api/products`, { tags: { ...tags, operation: 'catalog' } });
  check(catalog, { 'catalog responds': response => response.status === 200 });

  const productId = products[__ITER % products.length];
  const add = jsonRequest('POST', `/api/cart?userId=${userId}`, { productId, quantity: 1 }, { ...tags, operation: 'cart_add' });
  check(add, { 'cart accepts item': response => response.status === 200 });

  const cart = http.get(`${baseUrl}/api/cart?userId=${userId}`, { tags: { ...tags, operation: 'cart_read' } });
  check(cart, { 'cart responds': response => response.status === 200 });

  sleep(1);
}
