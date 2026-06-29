# egorov_seo — autonomous SEO/GEO content agent (Claude skill)

A reusable **Claude Code / Claude Agent skill** that deploys and runs a self‑driving SEO/GEO
content engine for Russian‑language sites. It collects semantics, generates expert articles
(**≥1500 words**), humanizes them, checks uniqueness, publishes to the site, pings Yandex for
re‑crawl, and reports to Telegram — on a daily cron, with zero human involvement.

Distilled from a real build (the accounting‑expert site **buhgalter‑nalogi.ru**).

## What it does (6‑step workflow)

1. **Collect** — existing pages, Yandex Webmaster (real queries/positions), Yandex Metrika, xmlstock SERP.
2. **Expand keywords** — Sonnet generates long‑tail queries per niche cluster, deduped.
3. **Gap analysis** — uncovered keywords scored by ease‑of‑entry → top‑N candidates.
4. **Generate + verify** — Sonnet 4.6 → humanize → **word‑count top‑up to ≥1500** → deterministic
   fact‑check (length, title/desc, internal links, factbox, table, no clichés) + **text.ru
   uniqueness ≥82%** + LLM confidence ≥0.85.
5. **Publish** (live only) — write MDX → `astro build` → FTP deploy → Yandex re‑crawl + IndexNow →
   refresh `llms.txt`.
6. **Monitor + Telegram report.**

Plus: **mass batch generation** into a queue and **publish N/day** by cron; bulk **expand** of thin
pages; a **Telegram bot** (project Q&A via DeepSeek + lead forwarding); **image generation** via
kie.ai Nano Banana 2.

## What's in here

```
SKILL.md                       # entrypoint — read first (full operating guide)
scripts/seo-agent/
  run.mjs                      # daily run: queue-publish or live-generate
  generate-batch.mjs           # mass-generate N articles into the queue
  expand-existing.mjs          # grow existing pages to >=1500 words
  cleanup-mdx.mjs              # sanitize MDX (strip import/JSX, fix factbox/anchors)
  competitor-analysis.mjs      # find low-competition keywords
  test-apis.mjs                # integration smoke test
  config.mjs                   # .env loader + readiness()
  lib/                         # xmlstock, aigate, textru, webmaster, metrika, indexnow, content, generate-post
scripts/bot/                   # Telegram bot (dialogue + lead endpoint)
scripts/images/                # kie.ai Nano Banana 2 + sharp optimization
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

1. Copy `scripts/` into your Astro project root (the scripts read site/brand/contacts from your
   `src/consts.ts`).
2. `cp .env.example .env` and fill in your own keys.
3. Adapt the niche: cluster list + system prompt in `generate-post.mjs` / `generate-batch.mjs`,
   and bot knowledge in `bot/project-context.mjs`.
4. `node scripts/seo-agent/test-apis.mjs` to verify integrations.
5. Deploy the bot + cron on a VPS (see `ecosystem.config.cjs` and SKILL.md).

## ⚠️ No secrets included

Ships **no API keys, tokens, servers, or passwords**. Every integration key (xmlstock, aigate,
text.ru, Yandex Webmaster/Metrika, kie.ai, Telegram, FTP) is read from a local `.env` that **you**
create. `lead.php` reads its Telegram token/chat from environment. Bring your own keys; never commit
a real `.env`.

## License

MIT — see [LICENSE](LICENSE).
