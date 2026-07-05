# Business Marketing Diagnostic Tool — Setup & Deployment

## What this is
A Next.js app that takes a business's details + website URL and generates a
21-module marketing diagnostic report (live data + deterministic rule
scoring + AI-written synthesis) with a downloadable branded PDF.

## 1. Get your free API keys (~10 minutes, ZERO cost, no card anywhere)

| Key | Where to get it | Cost |
|---|---|---|
| `GROQ_API_KEY` | https://console.groq.com/keys → sign in with Gmail → "Create API key" | Free, no card |
| `GOOGLE_SAFE_BROWSING_API_KEY` | https://console.cloud.google.com → APIs & Services → Library → enable "Safe Browsing API" → Credentials → Create API Key | Free, no card |
| `GOOGLE_PAGESPEED_API_KEY` | Same Google Cloud project → enable "PageSpeed Insights API" → reuse or create a key | Free, no card |

That's it — only 3 keys, all genuinely free. Local Competition Density
(OpenStreetMap), Competitor Intelligence (DuckDuckGo), SSL/domain
age/scraping, and Seasonal Demand Timing (Google Trends) need **zero
keys and zero signup**.

## 2. Run it locally (optional, to test before deploying)
```
cp .env.example .env.local
# paste your keys into .env.local
npm install
npm run dev
```
Open http://localhost:3000

## 3. Deploy for real (recommended: Vercel, free tier)
1. Push this project folder to a GitHub repository.
2. Go to https://vercel.com → New Project → import that GitHub repo.
3. In Vercel's "Environment Variables" step, paste in the same keys from
   `.env.example`.
4. Click Deploy. Vercel gives you a live URL immediately.
5. To use your own domain: Vercel dashboard → Project → Settings → Domains
   → add your domain → follow the DNS instructions it gives you (usually
   one CNAME record at your domain registrar).

## 4. What works with zero keys
SSL check, domain age, website scraping/audit, and seasonal demand
(Google Trends) all work immediately with no configuration — useful for
testing the pipeline before you've set up any keys.

## 5. Consistency guarantee
Every score in this tool is produced by a deterministic rule engine
(`src/lib/ruleEngine.ts`) fed by live-fetched facts. Re-running the same
business/website will produce the same scores unless the underlying facts
changed (e.g. the site was edited, a certificate renewed). The AI layer
(`src/lib/aiSynthesis.ts`) runs at temperature 0.2 and only writes the
prose explanation of decisions already made by the rule engine — it never
invents scores.
