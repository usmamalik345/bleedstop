# Real-world test kaise chalaen (Roman Urdu + English)

Yeh test **asli attack jaisa** flow chalata hai, lekin **asli Twilio/OpenAI ka paisa nahi** kat'ta.  
Hum apni hi victim app (`ResumeGlow`) pe bot farm + leaked key simulate karte hain.

## Kyun safe hai?

- Sirf `localhost` pe apni apps
- Vendor bills **mock** hain
- Real card / real SMS nahi

## 3 terminals

**Terminal 1 — BleedStop**
```bash
npm start
```

**Terminal 2 — Victim app (fake SaaS)**
```bash
npm run victim
```

**Terminal 3 — Real-world test**
```bash
npm run test:realworld
```

## Test kya karta hai?

1. **SMS pumping** — bohat saare fake accounts OTP mangte hain  
2. **Free AI abuse** — free rewrites spam  
3. **Leaked key** — key seedha vendor pe use (ghost spend) → kill switch  

End pe report aati hai:
- bina BleedStop kitna lagta (estimate)
- ab kitna laga
- kitni bachat
- PASS / FAIL

## Pass ka matlab

- OTP spam DENY hua  
- AI abuse LIMIT/DENY hua  
- Ghost spend pakra gaya aur key disable hui  

## Dashboard pe dekho

- http://localhost:3000/dashboard/  
- http://localhost:3000/ledger  
- http://localhost:4000/health  (victim)

## Agar fail aaye

1. `npm start` chal raha hai?  
2. `npm run victim` chal raha hai?  
3. Ports free hain? `3000` aur `4000`  

## Asli production vendors kab?

Jab samajh aa jaye — tab:
- Twilio **test credentials**
- OpenAI **tiny budget + separate test key**
- pehle staging, kabhi bhi production keys test mein mat dalo
