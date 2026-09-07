# fintech-payments

Payments service - charges wallets via the NexPay gateway and credits `fintech-ledger` on success.

**The full third-party contract this service implements against is documented in
[docs/nexpay-contract.md](docs/nexpay-contract.md) - read that first if you're diagnosing a
payments issue, since the gateway itself is an external dependency this service does not control.**

## Endpoints

- `POST /payment/initiate` (Bearer token) `{ walletId, amount, currency, source }` -> `{ payment }`
- `GET /payment/:id` (Bearer token) -> `{ payment, transactions }`
- `GET /payment/wallet/:walletId` (Bearer token) -> `{ payments }`
- `POST /payment/webhook/nexpay` (called by NexPay, no auth) -> resolves a `PENDING` payment
- `GET /health`, `GET /health/ready`

## Config

See `.env.example`: `PORT`, `DATABASE_URL` (MySQL), `JWT_SECRET` (must match `fintech-auth`),
`PAYMENT_GATEWAY_URL` (NexPay base URL - hardcoded per-environment, not resolved via any
in-platform routing), `LEDGER_URL`, `NOTIFICATIONS_URL` (best-effort).
