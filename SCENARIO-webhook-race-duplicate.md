# Demo scenario: concurrent webhook deliveries create duplicate transactions

## Symptom

Under normal traffic, a payment resolves cleanly with exactly one `Transaction` row. But when
NexPay redelivers the webhook for the same charge in quick succession (which its contract
explicitly allows, see `docs/nexpay-contract.md`), the payment intermittently ends up with
**two** `SUCCESS` transaction rows and the wallet gets credited twice for a single charge.

## Root cause

`POST /payment/webhook/nexpay` reads the payment, checks `payment.status !== 'PENDING'` to
avoid re-processing an already-resolved payment, and only then creates a `Transaction` row and
updates the payment's status - but none of this is wrapped in a shared DB transaction or row
lock. Two webhook deliveries arriving close together can both read the payment while its status
is still `PENDING`, both pass the "already resolved" check before either one writes, and both
proceed to create a `Transaction` row and credit the wallet.

## Repro

```bash
# after PAYMENT_ID/REFERENCE is in a PENDING state, deliver the same webhook twice at once
BODY='{"id":"ch_abc123","status":"succeeded","amount":150000,"currency":"USD","reference":"'"$REFERENCE"'"}'
curl -s -X POST http://fintech-payments:4003/payment/webhook/nexpay -H 'Content-Type: application/json' -d "$BODY" &
curl -s -X POST http://fintech-payments:4003/payment/webhook/nexpay -H 'Content-Type: application/json' -d "$BODY" &
wait

# both calls return 200 with no "already resolved" message
curl -s http://fintech-payments:4003/payment/$PAYMENT_ID -H "Authorization: Bearer $TOKEN"
# => "transactions": [ {..., "status":"SUCCESS"}, {..., "status":"SUCCESS"} ]

# the wallet was credited twice for one charge
curl -s http://fintech-ledger:4002/wallet/$WALLET_ID/entries -H "Authorization: Bearer $TOKEN"
# => two CREDIT entries for the same amount/reference
```

Firing a burst of many concurrent identical webhook deliveries (e.g. 100 at once) makes this
reproduce essentially every time, rather than only occasionally.

## Fix

Wrap the payment lookup, status re-check, and status/transaction writes in one
`sequelize.transaction()` with a row lock (`lock: t.LOCK.UPDATE`) on the payment, so only one
concurrent delivery can ever observe `status === 'PENDING'` and act on it (see `main`).
