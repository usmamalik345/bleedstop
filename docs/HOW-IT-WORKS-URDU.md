# BleedStop short — Roman Urdu

## Ye project kya hai?

Tumhari app jab SMS ya AI pe **paisa** lagati hai, pehle BleedStop se poochti hai:

> Is user/bot pe kharcha allow hai?

Jawab: **ALLOW / LIMIT / DENY**

## Dummy kyun nahi kehna?

Portfolio mein yeh **control plane** hai:
- asli Express middleware (`src/sdk/express.js`)
- asli rules + cluster bill
- asli benchmark numbers (`npm run benchmark`)
- optional **asli OpenAI** (`OPENAI_API_KEY`)

Jo “mock” hai wo sirf vendor bill hai jab tum key nahi lagate — taake hundreds dollars na jalain. Design production jaisa hai.

## Asli test kaise karein?

```bash
npm start
npm run app
npm run benchmark
```

Yeh tumhari protected SaaS pe bot farm + AI abuse + leaked key chalata hai aur **$ saved** table deta hai. Wahi portfolio pe lagao.

## Live OpenAI (real money, chhota budget)

`.env` mein:
```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Phir `npm run app` — `/ai/rewrite` real OpenAI call karega, lekin pehle BleedStop decide karega.

**Zaroori:** OpenAI dashboard pe hard spend limit / alert laga do.

## Dashboard buttons

- **Refresh** — naya data
- **Run leaked-key red team** — har click pe vendor +$25, phir kill switch (ghost gap badhega)
- **Reconcile** — app vs vendor compare
- **Clear staging data** — reset

## Yaad rakho

- Paisa rokna = **rules** (AI nahi)
- AI = report / suggestion
- Portfolio proof = **benchmark table**, sirf button clicks nahi
