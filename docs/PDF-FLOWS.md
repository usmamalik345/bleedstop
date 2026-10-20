# PDF flows you can test on this laptop

The idea PDF also includes AWS, Argo CD, and live Twilio. Those need your cloud accounts. Everything below runs locally.

## One command (clears data, then attacks)

```powershell
Invoke-RestMethod -Method POST http://localhost:3000/drill/run | ConvertTo-Json -Depth 6
```

Look for `parallel-ceiling-race.pass = true` and `leaked-key-ghost.ghostDetected = true`.

## Piece by piece

| Flow | Try |
|------|-----|
| Challenge | signup with `email: a@mailinator.com` and action `signup.create` |
| Fail policy | `GET /fail-policy/sms.send` → DENY; `/fail-policy/auth.login` → ALLOW |
| OTP freeze | `POST /runbooks/otp-freeze` body `{"clusterId":"C-1"}` then SMS decide |
| Bill shock | `GET /audit/bill-shock` |
| Coverage map | `GET /pdf/coverage` |
| Queue | `GET /queue/stats` |

Challenge example:

```powershell
Invoke-RestMethod -Method POST http://localhost:3000/decide -ContentType "application/json" -Body '{"actorId":"bot1","action":"signup.create","paid":false,"signals":{"deviceFingerprint":"fp1","email":"a@mailinator.com"}}'
```

Restart the server after this update (`npm start`), then hard-refresh the dashboard. New buttons: **Run PDF drill** and **Bill-shock audit**. Drill clears staging data.
