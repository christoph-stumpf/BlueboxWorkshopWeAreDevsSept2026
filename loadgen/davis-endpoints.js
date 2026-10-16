import http from 'k6/http';

// Steady per-endpoint traffic for the Davis per-endpoint alerting prototype.
// Each endpoint gets a fixed arrival rate so 5xx rates injected via faults.json
// translate directly into per-endpoint error rates. GET /api/products is the
// high-volume endpoint, GET /api/cart the low-volume one on the same service.
// payment is driven directly so both of its endpoints carry independent traffic;
// a trickle of checkouts keeps the shop-api -> payment call edge in the topology.
// Run with DB_POOL_SIZE raised (e.g. 20) so the shop's intended pool-exhaustion
// defect stays out of the error signal.
const shopUrl = __ENV.TARGET_URL || 'http://localhost:8088';
const paymentUrl = __ENV.PAYMENT_URL || 'http://localhost:4004';
const duration = __ENV.DURATION || '5h';
const productIds = ['aurora-mug', 'signal-notebook', 'orbit-lamp', 'cloud-socks', 'field-bag', 'night-hoodie'];
const json = { headers: { 'Content-Type': 'application/json' } };

const scenario = (exec, rate, timeUnit = '1s') => ({
  executor: 'constant-arrival-rate', exec, rate, timeUnit, duration, preAllocatedVUs: 10, maxVUs: 40,
});

export const options = {
  discardResponseBodies: true,
  scenarios: {
    products: scenario('products', 5),
    cartAdd: scenario('cartAdd', 1),
    cartView: scenario('cartView', 12, '1m'),
    checkout: scenario('checkout', 6, '1m'),
    charge: scenario('charge', 2),
    refund: scenario('refund', 1),
  },
};

const pick = () => productIds[Math.floor(Math.random() * productIds.length)];
const user = () => `davis-${__VU}-${__ITER}`;

export function products() { http.get(`${shopUrl}/api/products`); }
export function cartAdd() { http.post(`${shopUrl}/api/cart?userId=${user()}`, JSON.stringify({ productId: pick(), quantity: 1 }), json); }
export function cartView() { http.get(`${shopUrl}/api/cart?userId=${user()}`); }
export function checkout() {
  const userId = `davis-checkout-${__VU}-${__ITER}`;
  http.post(`${shopUrl}/api/cart?userId=${userId}`, JSON.stringify({ productId: pick(), quantity: 1 }), json);
  http.post(`${shopUrl}/api/checkout?userId=${userId}`, JSON.stringify({ email: 'davis@example.com', cardNumber: '4242424242424242', shipping: 'standard' }), json);
}
export function charge() { http.post(`${paymentUrl}/charge`, JSON.stringify({ amountCents: 1200, orderId: `davis_${__VU}_${__ITER}`, attempt: 2 }), json); }
export function refund() { http.post(`${paymentUrl}/refund`, JSON.stringify({ transactionId: `txn_${__VU}_${__ITER}` }), json); }
