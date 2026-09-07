# Demo scenario: duplicate transactions from a replayed webhook

## Symptom

A single NexPay charge ends up with **multiple** `SUCCESS` transaction rows in `transactions`, and
the wallet gets credited more than once for the same payment.

## Root cause

`POST /payment/webhook/nexpay` looks up the payment by `reference` and applies the outcome without
first checking whether that payment has already been resolved. NexPay's contract explicitly notes
the webhook can be delivered more than once for the same charge (see
`docs/nexpay-contract.md`) - every redelivery here creates another `Transaction` row and calls
`creditWallet` again.

## Repro

```bash
# call the webhook twice for the same (pending) payment reference
BODY='{"id":"ch_def456","status":"succeeded","amount":150000,"currency":"USD","reference":"'"$REFERENCE"'"}'
curl -s -X POST http://fintech-payments:4003/payment/webhook/nexpay -H 'Content-Type: application/json' -d "$BODY"
curl -s -X POST http://fintech-payments:4003/payment/webhook/nexpay -H 'Content-Type: application/json' -d "$BODY"

# two SUCCESS transaction rows for one payment
curl -s http://fintech-payments:4003/payment/$PAYMENT_ID -H "Authorization: Bearer $TOKEN"
# => "transactions": [ {..., "status":"SUCCESS"}, {..., "status":"SUCCESS"} ]

# wallet was credited twice for a single charge
curl -s http://fintech-ledger:4002/wallet/$WALLET_ID/entries -H "Authorization: Bearer $TOKEN"
# => two CREDIT entries for the same amount/reference
```

## Fix

Re-add the guard that treats a payment whose `status` is no longer `PENDING` as already resolved
and returns immediately without creating another transaction or crediting again (see `main`).
