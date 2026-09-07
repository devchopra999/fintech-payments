const LEDGER_URL = process.env.LEDGER_URL || 'http://ledger:4002';

async function creditWallet(walletId, amount, reference) {
  const res = await fetch(`${LEDGER_URL}/wallet/${walletId}/credit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, reference })
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`ledger credit failed: ${res.status} ${JSON.stringify(body)}`);
  }

  return res.json();
}

module.exports = { creditWallet };
