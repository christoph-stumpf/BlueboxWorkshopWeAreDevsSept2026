import http from 'k6/http';
import { check, sleep } from 'k6';

// Checkout-focused profile for the duplicate-charge routine demo. Runs at low
// concurrency so the 2-permit DB pool keeps up and every iteration completes a
// checkout — each of which deterministically double-charges (payment attempt 1
// takes 500ms, checkout aborts at 150ms and retries, minting a second txn).
const baseUrl = __ENV.TARGET_URL || 'http://shop:8088';
const products = ['aurora-mug', 'signal-notebook', 'orbit-lamp', 'cloud-socks', 'field-bag', 'night-hoodie'];

export const options = {
  vus: Number(__ENV.VUS || 3),
  duration: __ENV.DURATION || '90s',
  thresholds: {
    // Checkouts should succeed here — this profile is about correctness, not load.
    'checks': ['rate>0.8'],
  },
};

function jsonRequest(method, path, payload, tags) {
  return http.request(method, `${baseUrl}${path}`, payload ? JSON.stringify(payload) : null, {
    headers: { 'Content-Type': 'application/json' },
    tags,
  });
}

export default function () {
  const userId = `checkout-${__VU}-${__ITER}`;
  const tags = { workload: 'workshop-shop', user_id: userId };

  const productId = products[__ITER % products.length];
  const add = jsonRequest('POST', `/api/cart?userId=${userId}`, { productId, quantity: 1 }, { ...tags, operation: 'cart_add' });
  check(add, { 'cart accepts item': response => response.status === 200 });

  const checkout = jsonRequest('POST', `/api/checkout?userId=${userId}`, {
    email: `checkout-${__VU}@example.com`,
    cardNumber: '4242424242424242',
    shipping: { firstName: 'Load', lastName: 'Generator', address: '1 Workshop Way', city: 'Localhost', postalCode: '8088' },
  }, { ...tags, operation: 'checkout' });
  check(checkout, { 'checkout approved': response => response.status === 200 });

  sleep(1);
}
