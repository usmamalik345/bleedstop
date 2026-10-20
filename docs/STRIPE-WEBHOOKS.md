# Stripe webhooks → BleedStop ledger

## Why

Checkout creates a PaymentIntent **after** BleedStop ALLOW.  
When Stripe confirms payment, the webhook updates **app ledger** so reconcile can compare app vs vendor bills (ghost spend).

## Setup (local)

1. Install [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Start BleedStop: `npm start`
3. Forward webhooks:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

4. Copy the `whsec_...` secret into `.env`:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

5. Restart `npm start`

## Events handled

| Event | Action |
|-------|--------|
| `payment_intent.succeeded` | Add actual $ to app ledger + event log |
| `payment_intent.payment_failed` | Log failure event |
| Other | Ignored (200 OK) |

## Verify

After a test checkout on http://localhost:4000/checkout.html:

- Dashboard → **Recent decisions** + **events**
- Ledger → `appSpendByKey.stripe-live-key` increases
- `GET http://localhost:3000/events` shows `stripe.payment.succeeded`

## Production

Stripe Dashboard → Developers → Webhooks → Add endpoint:

```text
https://your-bleedstop-domain.com/webhooks/stripe
```

Select: `payment_intent.succeeded`, `payment_intent.payment_failed`
