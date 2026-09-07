// wraps the NexPay gateway per docs/nexpay-contract.md
const BASE_URL = process.env.PAYMENT_GATEWAY_URL || 'https://api.nexpay.example.com';

async function charge({ amount, currency, reference, source }) {
  const res = await fetch(`${BASE_URL}/v1/charges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency, reference, source })
  });

  const body = await res.json().catch(() => ({}));
  return { httpStatus: res.status, body };
}

module.exports = { charge };
