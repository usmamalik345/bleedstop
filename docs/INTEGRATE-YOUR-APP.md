# Drop BleedStop into YOUR Express app

Copy this pattern into any Node/Express SaaS — OTP, AI, payments, email.

## 1. Install / copy SDK

Copy `src/sdk/express.js` or import from this repo:

```js
import { createClient, protectPaidAction } from "../../src/sdk/express.js";
```

## 2. Create one client

```js
const bleedstop = createClient({
  baseUrl: process.env.BLEEDSTOP_URL || "http://localhost:3000",
});
```

## 3. Wrap every paid route

```js
function withBleedstop(action, vendorKeyId) {
  return (req, _res, next) => {
    req.bleedstop = {
      action,
      actorId: req.user?.id || req.body.actorId || req.ip,
      paid: Boolean(req.user?.paid || req.body.paid),
      vendorKeyId,
      signals: {
        deviceFingerprint: req.headers["x-device-fingerprint"],
        email: req.body.email || req.user?.email,
      },
    };
    next();
  };
}

// SMS / OTP
app.post(
  "/api/otp/send",
  withBleedstop("sms.send", "tw-live-key"),
  protectPaidAction(bleedstop, { action: "sms.send" }),
  sendOtpHandler
);

// AI
app.post(
  "/api/ai/chat",
  withBleedstop("llm.call", "oa-live-key"),
  protectPaidAction(bleedstop, { action: "llm.call" }),
  chatHandler
);

// Stripe checkout step (before PaymentIntent)
app.post(
  "/api/checkout/start",
  withBleedstop("payment.attempt", "stripe-live-key"),
  protectPaidAction(bleedstop, { action: "payment.attempt" }),
  createPaymentIntentHandler
);
```

## 4. Fail closed in production

```env
BLEEDSTOP_FAIL_CLOSED=1
```

If BleedStop is down, money routes return 503 instead of fail-open.

## 5. Stripe webhooks → BleedStop ledger

Point Stripe to your **control plane**, not your app:

```text
POST https://your-domain.com/webhooks/stripe
```

Local dev:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
# copy whsec_... into .env as STRIPE_WEBHOOK_SECRET
```

On `payment_intent.succeeded`, BleedStop updates **app ledger** for ghost-spend reconcile.

## 6. Reconcile on a schedule

```bash
npm run worker:reconciler
# or POST /reconcile from cron / K8s CronJob
```

## Minimal starter

See `apps/my-saas-starter/server.js` — smallest copy-paste example.

## Checklist

- [ ] BleedStop running (`npm start`)
- [ ] `BLEEDSTOP_URL` in your app `.env`
- [ ] Every paid vendor call behind `protectPaidAction`
- [ ] Stripe webhook → `:3000/webhooks/stripe`
- [ ] Postgres for persistence (`npm run db:up`)
