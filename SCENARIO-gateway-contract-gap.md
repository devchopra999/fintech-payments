# Demo scenario: NexPay gateway contract gap (pending review misreported as success)

## Symptom

A large payment (>= $1,000 / 100000 minor units) shows up as `SUCCESS` immediately, even though
NexPay's contract (`docs/nexpay-contract.md`) says charges that size are never approved
synchronously - they come back `202 pending` and are only finalized later via a webhook. If NexPay
later declines that same charge, there is no way for this service to ever find out.

## Root cause

`POST /payment/initiate` only checks the gateway response's HTTP status (`httpStatus < 300`) to
decide success, never the response body's `status` field. A `202 Accepted` "pending review"
response is still a `2xx`, so it's treated identically to a `201 succeeded` response - the payment
is marked `SUCCESS` and the wallet is credited immediately. Compounding this, this branch has no
`POST /payment/webhook/nexpay` endpoint registered at all, so even if NexPay tries to deliver the
real outcome later, there's nowhere for it to land.

## Repro

Point `fintech-payments`'s `PAYMENT_GATEWAY_URL` at a mock of NexPay (via the orchestrator's
header-injector, redirecting the hardcoded gateway hostname to `mock-server`) that implements the
contract in `docs/nexpay-contract.md`:

```bash
# 1. a small payment (< 100000) - control case, NexPay approves synchronously
curl -s -X POST http://fintech-payments:4003/payment/initiate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"walletId":"'"$WALLET_ID"'","amount":5000,"currency":"USD","source":"tok_test_visa"}'
# => payment.status: "SUCCESS" (correct either way)

# 2. a large payment (>= 100000) - per contract, NexPay returns 202 pending
curl -s -X POST http://fintech-payments:4003/payment/initiate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"walletId":"'"$WALLET_ID"'","amount":150000,"currency":"USD","source":"tok_test_visa"}'
# => payment.status: "SUCCESS"   <-- BUG: contract says this must still be "PENDING"

# 3. proves the webhook gap: NexPay's callback for the pending charge has nowhere to go
curl -s -X POST http://fintech-payments:4003/payment/webhook/nexpay -H 'Content-Type: application/json' \
  -d '{"id":"ch_def456","status":"failed","amount":150000,"currency":"USD","reference":"'"$REFERENCE"'"}'
# => 404 (no route registered) - even a later decline can never be reflected
```

## Fix

Branch on `gatewayResponse.body.status` (`"succeeded"` / `"pending"` / anything else) instead of
just the HTTP status, and implement `POST /payment/webhook/nexpay` to resolve payments left
`PENDING` after a `202` response (see `main`).
