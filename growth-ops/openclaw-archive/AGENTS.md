# OpenClaw Fleet v2 — USA Gummies Growth Engine

## Tools
- `exec`/`bash`: Scripts, git, curl. `read`/`write`/`edit`: Files. `web_search`/`web_fetch`: Web.
- Email: `bash scripts/send-email.sh --to X --subject Y --body Z` / `bash scripts/check-email.sh --folder INBOX --count 20`
- Social: `bash scripts/social-post.sh --platform all --text "TEXT"`
- Blog PR: `bash scripts/create-blog-pr.sh --slug "SLUG" --content-file /tmp/FILE.mdx`
- Notion: `bash scripts/notion-log.sh --db DB_ID --title "T" --status "✅ Success" --agent "NAME" --body "D"`

## Notion DBs
- OPS: `--db 30d4c0c42c2e81b0914ee534e56e2351`
- CONTENT: `--db 30d4c0c42c2e8168b826d88344832be0`
- SOCIAL: `--db 30d4c0c42c2e815b942afaf1a671d611`
- INTEL: `--db 30d4c0c42c2e81ef862ec6c0036e3f51`
- OUTREACH: `--db 30d4c0c42c2e813e8216c1118a12ecf1`

## W1: SEO Content Factory (every 4h)
Read memory/seo_content_pipeline.md. Pick ONE keyword. web_search trending topics (dye free candy, red 40 ban, natural gummies, made in usa candy). Write 1000-1500 word MDX blog post. Save to /tmp/, run create-blog-pr.sh. Log Notion CONTENT DB. Update pipeline. ONE post per cycle.

## W2: Amazon Optimizer (every 6h)
Read memory/amazon_intel.md. web_search competitor Amazon listings (Black Forest, SmartSweets, YumEarth, Haribo, Albanese). Extract prices, reviews, bullets. Compare to ASIN B0DSM8XQWH. Find keyword gaps. Write memory/amazon_intel.md. Log Notion INTEL DB.

## W3: Social Content Engine (every 4h)
Read memory/social_post_log.md. MAX 3 posts/day. Mon=product, Tue=health, Wed=BTS, Thu=community, Fri=fun, Sat-Sun=patriotic. Post via social-post.sh. Log Notion SOCIAL DB. Under 280 chars, 1-2 hashtags.

## W4: Backlink Hunter (every 6h)
Read memory/backlink_opportunities.md. web_search ONE rotated query for resource pages/guest posts/directories. Extract contacts, assess quality. Log opportunities. If HIGH priority + clear email, send ONE pitch. Log Notion OUTREACH DB. MAX 1 email/cycle.

## W5: Competitive Intel Radar (every 6h)
Read memory/competitor_battlecards.md. Pick ONE competitor (rotate: Black Forest, SmartSweets, YumEarth, Haribo, Albanese, Zarbee's). Search news, Amazon, social. Write findings + daily snapshot. Log Notion INTEL DB.

## W6: Inbox Monitor (every 2h)
Run check-email.sh --folder INBOX --count 20. Log bounces to memory/bounce_log.md. Log real human replies to memory/inbox_monitor.md. DO NOT auto-reply. IGNORE spam/alerts. Log Notion OPS DB.

## W7: Ops Health Sentinel (every 3h)
Quick check. ONLY log to memory/failures_and_learnings.md if error/blocker found. If OK, stop.

## W8: Smart Outreach (2x/day)
Read memory/outreach_queue.md + memory/email_send_log.md. If >=2 emails today STOP. Pick highest priority target. web_search to personalize. Send custom email via send-email.sh. Log Notion OUTREACH DB. MAX 2 emails/day.

## W13: Faire Autopilot (every 3h)
Read memory/faire_autopilot.md. Check inbox for Faire notifications. Reply to buyer messages using templates. If none, stop. Log Notion OPS DB.

## Rules
- ONE action per cycle. No bulk ops. Log everything to Notion. No dupes—check logs first.
- Max 6 emails/day total. Max 3 social posts/day. Never fake reviews. Never disparage competitors.
- Stop on error/rate limit. Never spend money without Ben. Email sig: "Best, Ben — USA Gummies"
