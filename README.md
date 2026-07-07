# egorov_seo — autonomous SEO/GEO content agent (Claude skill)

A reusable **Claude Code / Claude Agent skill** that deploys and runs a self‑driving SEO/GEO
content engine for Russian‑language sites. It collects semantics (including real Yandex market
**demand**, not just current impressions), generates expert articles, humanizes them, checks
uniqueness, generates cover images, publishes to the site, pings Yandex for re‑crawl, tracks
spend across every paid API, and sends a daily report to Telegram — with zero human involvement.

Distilled from a real production build (originally the accounting‑expert site
**buhgalter‑nalogi.ru**), now site‑agnostic.

## What it does (9‑step workflow)

1. **Collect** — existing pages, Yandex Webmaster (real queries/positions + **DEMAND**, market
   search demand independent of the site's current visibility), Yandex Metrika, xmlstock SERP,
   Arsenkin (LSI/Wordstat/PAA, optional).
2. **Expand keywords** — Sonnet generates long‑tail queries per niche cluster, deduped.
3. **Gap analysis** — uncovered keywords scored by ease‑of‑entry + Wordstat frequency + a bonus
   for high‑demand/zero‑click queries → top‑N candidates.
4. **Generate + verify** — Sonnet 4.6 → humanize → word‑count top‑up (max 2 rounds) → deterministic
   fact‑check (**1300+ words** — a flexible floor, not a hard 1500, to avoid burning API spend
   re‑generating borderline articles; title/desc length, internal links, factbox, table, no
   clichés) + **uniqueness ≥82%** (content‑watch.ru primary → text.ru fallback) + LLM confidence
   threshold.
5. **Images** — Pollinations.ai (free, no key) as the primary provider, kie.ai Nano Banana 2 as a
   silent fallback on failure.
6. **Publish** (live only) — write MDX → `astro build` → FTP deploy → Yandex re‑crawl + IndexNow →
   refresh `llms.txt`.
7. **Cost ledger** — every paid aigate call logs its real `usage.cost_usd` (not a token estimate);
   Arsenkin/xmlstock calls are counted (no balance API to diff against).
8. **Monitor + Telegram report** (created/skipped/errors/in top‑30/queue left), optional duplicate
   lead notification via MAX.
9. **Daily summary report** (separate cron, e.g. 09:00 UTC) — today's traffic, traffic sources
   (direct/search/link/messenger), indexed‑page count with delta, top10/50/100 positions with
   trend arrows vs. the previous report, recommendations, and spend in $ per service.

Plus: **mass batch generation** into a queue and **publish N/day** by cron; bulk **expand** of thin
pages; a **Telegram bot** (project Q&A via DeepSeek + lead forwarding, chat‑id gated); weekly
**positions report**.

## Architecture: `site.profile.mjs`

The engine itself is site‑agnostic — nothing in `scripts/` imports a specific site's content model.
Everything specific (site type, content collections, brand voice, CTA copy) lives in ONE file,
`site.profile.mjs`, in your project root, built from `site.profile.example.mjs`. This is what makes
the same engine run unmodified on an expert‑persona site, an organization site, or a catalog site.

## What's in here

```
SKILL.md                       # entrypoint — read first (full operating guide, in Russian)
site.profile.example.mjs       # site adapter contract/template — copy to site.profile.mjs and fill in
scripts/seo-agent/
  run.mjs                      # daily run: queue-publish or live-generate
  generate-batch.mjs           # mass-generate N articles into the queue
  daily-report.mjs             # daily summary: traffic/sources/pages/positions/spend
  expand-existing.mjs          # grow thin existing pages
  cleanup-mdx.mjs              # sanitize MDX (strip import/JSX, fix factbox/anchors)
  competitor-analysis.mjs      # find low-competition keywords
  positions-report.mjs         # weekly position report to Telegram
  test-apis.mjs                # integration smoke test
  config.mjs                   # .env loader + readiness()
  lib/                         # xmlstock, aigate, webmaster (+demand), metrika, content-watch/
                                # text.ru, cost-ledger, ctr-optimize, conversion, indexnow, content,
                                # generate-post
scripts/bot/                   # Telegram bot (dialogue + lead endpoint, chat-id gated) + MAX
scripts/images/                # Pollinations.ai (primary) + kie.ai Nano Banana 2 (fallback)
scripts/deploy-ftp.py          # deploy dist/ to FTP hosting
scripts/lead.php               # PHP lead forwarder (host on shared hosting, same-origin)
ecosystem.config.cjs           # pm2 (bot 24/7 + agent cron)
.env.example                   # all keys (bring your own)
```

## Install as a Claude skill

```bash
git clone https://github.com/ilan1986/egorov_seo.git ~/.claude/skills/egorov_seo
```
Then invoke with `/egorov_seo` (or just describe: "поставь сайт на SEO‑автопилот").

> Project‑scoped: clone into `.claude/skills/egorov_seo` inside a repo instead.

## Use the engine in a project

1. Copy `scripts/` + `site.profile.example.mjs` into your Astro project root, rename the latter to
   `site.profile.mjs` and fill it in (site type, content collections, brand voice, CTA — see
   SKILL.md for the full contract).
2. `cp .env.example .env` and fill in your own keys.
3. If your target content collection is `.mdx`, make sure `@astrojs/mdx` is registered in
   `astro.config.mjs` — Astro silently treats an unregistered `.mdx` collection as empty at build
   time, which looks like the agent is broken when it isn't.
4. `node scripts/seo-agent/test-apis.mjs` to verify integrations.
5. Deploy the bot + cron (+ optional daily‑report cron) on a VPS — see `ecosystem.config.cjs` and
   SKILL.md.

## ⚠️ No secrets included

Ships **no API keys, tokens, servers, or passwords**. Every integration key (xmlstock, aigate,
content‑watch/text.ru, Arsenkin, Yandex Webmaster/Metrika, kie.ai, Telegram, MAX, FTP) is read from
a local `.env` that **you** create from `.env.example`. `scripts/lead.php` reads its Telegram
token/chat from the server environment (falling back to a placeholder you must replace). Bring your
own keys; never commit a real `.env` or a filled‑in `lead.php`.

## License

MIT — see [LICENSE](LICENSE).
