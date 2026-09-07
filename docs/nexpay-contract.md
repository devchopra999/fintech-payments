# NexPay Payments Gateway API - Contract v1

This is the contract shared by NexPay (the third-party payment gateway `fintech-payments`
integrates with). It is **not** part of this codebase's source - it's the specification NexPay
gave us, and `src/gatewayClient.js` is our implementation against it. Keep this file in sync with
whatever NexPay actually publishes; when the two disagree, that's a bug in this service, not in
the contract.

Base URL: configured via `PAYMENT_GATEWAY_URL` (e.g. `https://api.nexpay.example.com`).

## `POST /v1/charges`

Create a charge.

Request body:

```json
{
  "amount": 5000,
  "currency": "USD",
  "reference": "payment_51a2...",
  "source": "tok_test_visa"
}
```

- `amount` - integer, minor units (cents).
- `currency` - ISO 4217, 3 letters.
- `reference` - merchant-supplied idempotency/reference key (we send our internal `payment.id`).
- `source` - a tokenized payment source.

### Responses

**`201 Created`** - charge approved synchronously.

```json
{ "id": "ch_abc123", "status": "succeeded", "amount": 5000, "currency": "USD", "reference": "payment_51a2..." }
```

**`202 Accepted`** - charge is under manual/fraud review, **not final yet**. NexPay's contract
states this is returned whenever `amount >= 100000` minor units (i.e. any charge of $1,000 or
more) - high-value charges are never approved synchronously. The final outcome is delivered later
via the webhook below.

```json
{
  "id": "ch_def456",
  "status": "pending",
  "amount": 150000,
  "currency": "USD",
  "reference": "payment_51a2...",
  "review_reason": "high_value_review"
}
```

**`402 Payment Required`** - charge declined synchronously.

```json
{ "error": { "code": "card_declined", "message": "The card was declined.", "decline_code": "insufficient_funds" } }
```

**`400 Bad Request`** - malformed request.

```json
{ "error": { "code": "invalid_request", "message": "amount must be a positive integer", "param": "amount" } }
```

### Caller contract (important)

**A `2xx` HTTP status alone does not mean the charge succeeded.** `202` is a `2xx` response but
means "pending, ask me later" - callers **must** branch on the response body's `status` field
(`"succeeded"` vs `"pending"` vs anything else), not just the HTTP status code. Any integration
that treats HTTP status `< 300` as "payment succeeded" will silently misreport every `202 pending`
high-value charge as successful and will never learn the true outcome, because it will also never
implement the webhook below.

## Webhook: charge outcome (async, for anything that returned `202 pending`)

NexPay `POST`s the final outcome to the merchant's configured webhook URL once a pending charge is
resolved (typically seconds to hours later for manual review). The merchant (this service) is
required to expose an endpoint to receive it - NexPay does not retry indefinitely and does not
offer a polling/GET alternative in this contract version.

Request body NexPay sends:

```json
{ "id": "ch_def456", "status": "succeeded", "amount": 150000, "currency": "USD", "reference": "payment_51a2..." }
```

or

```json
{ "id": "ch_def456", "status": "failed", "amount": 150000, "currency": "USD", "reference": "payment_51a2...", "failure_code": "fraud_suspected" }
```

`fintech-payments` receives this at `POST /payment/webhook/nexpay` (see `src/routes/payment.js`).
Expected merchant response: `2xx` to acknowledge; any other status is treated by NexPay as
delivery failure (out of scope here since we don't control NexPay's retry behavior).

## Summary of what `fintech-payments` must do to honor this contract

1. Call `POST /v1/charges`.
2. Inspect the response body's `status`, not just the HTTP status:
   - `"succeeded"` -> mark the payment `SUCCESS` immediately, credit the wallet.
   - `"pending"` -> mark the payment `PENDING`, do **not** credit the wallet yet, wait for the webhook.
   - decline / `402` -> mark the payment `FAILED`.
3. Implement `POST /payment/webhook/nexpay` to resolve any `PENDING` payment to `SUCCESS` or
   `FAILED` once NexPay calls back, crediting the wallet only at that point for `succeeded`.
4. Treat the webhook as an at-least-once delivery (NexPay may call it more than once for the same
   `id`/`reference`) - resolving an already-resolved payment again must be a no-op, not a second
   credit.
