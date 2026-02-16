# USA Gummies Community Monitor

Automated community monitoring and AI-powered response generation system. Scans Reddit, tracks competitor complaints, monitors trending keywords, and generates natural response templates for human review.

**This system generates response TEMPLATES. Nothing is auto-posted. Every response requires human review before use.**

## Quick Start

```bash
cd growth-ops/community-monitor

# Full pipeline (monitor + keywords + responses)
node run-monitor.mjs

# Dry run (no files written, no API calls)
node run-monitor.mjs --dry-run

# Individual scripts
node reddit-monitor.mjs
node keyword-tracker.mjs
node generate-responses.mjs --limit 5
```

## Requirements

- Node.js 20+
- `OPENAI_API_KEY` in environment or `../../.env.local` (only needed for response generation)
- No Reddit API key required (uses public JSON endpoints)

## Scripts

### `run-monitor.mjs` - Orchestrator
Runs the full pipeline in sequence. Flags:
- `--dry-run` - Preview mode, no files written
- `--reddit-only` - Only scan Reddit
- `--keywords-only` - Only track keywords
- `--responses-only` - Only generate responses
- `--skip-responses` - Run monitor + keywords, skip response generation
- `--limit N` - Limit response generation to N posts

### `reddit-monitor.mjs` - Reddit Scanner
Scans 14 subreddits for posts matching our keywords from the last 48 hours.
- Uses Reddit's public `.json` API (no auth)
- Rate-limited to 1 request per 2 seconds
- Deduplicates with existing matches
- Outputs: `data/reddit-matches.json`

### `keyword-tracker.mjs` - Keyword & Competitor Tracker
Tracks trending conversations and competitor complaints.
- Searches Reddit for competitor brands + complaint keywords
- Tracks trending keyword searches
- Checks Google Trends RSS for relevant trends
- Outputs: `data/keyword-report.json`

### `generate-responses.mjs` - AI Response Generator
Generates three response variations per post using different personas.
- Flags: `--dry-run`, `--limit N`, `--post-id <id>`
- Requires `OPENAI_API_KEY`
- Validates responses for banned language, word count, brand mentions
- Outputs: `data/generated-responses.json`

### `response-queue.html` - Review Dashboard
Open in any browser to review and manage generated responses.
1. Open the file in a browser
2. Click "Load generated-responses.json" and select `data/generated-responses.json`
3. Review responses side-by-side by persona
4. Copy responses to clipboard for posting
5. Mark posts as "Posted" or "Skip"
6. State is saved to localStorage

### `config.mjs` - Configuration
Central configuration for all scripts: subreddits, keywords, personas, file paths, API settings.

## Personas

| Persona | Focus | Tone |
|---------|-------|------|
| Helpful Parent | Kids, health, clean ingredients | Warm, relatable, concerned parent |
| Patriotic Consumer | Buy American, domestic manufacturing | Enthusiastic, knowledgeable |
| Ingredient Nerd | Label reading, Red 40, titanium dioxide | Nerdy, matter-of-fact, informative |

## Scheduling

### With launchd (macOS)

Create `~/Library/LaunchAgents/com.usagummies.community-monitor.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.usagummies.community-monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/ben/usagummies-storefront/growth-ops/community-monitor/run-monitor.mjs</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict>
            <key>Hour</key>
            <integer>8</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>18</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
    </array>
    <key>StandardOutPath</key>
    <string>/Users/ben/usagummies-storefront/growth-ops/community-monitor/logs/monitor.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/ben/usagummies-storefront/growth-ops/community-monitor/logs/monitor-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.usagummies.community-monitor.plist
```

### With cron

```bash
# Run at 8am and 6pm daily
0 8,18 * * * cd /Users/ben/usagummies-storefront/growth-ops/community-monitor && /usr/local/bin/node run-monitor.mjs >> logs/monitor.log 2>&1
```

## File Structure

```
community-monitor/
├── config.mjs                 # Central configuration
├── reddit-monitor.mjs         # Reddit scanner
├── keyword-tracker.mjs        # Keyword & competitor tracker
├── generate-responses.mjs     # AI response generator
├── run-monitor.mjs            # Orchestrator
├── response-queue.html        # Review dashboard
├── README.md
├── data/
│   ├── .gitkeep
│   ├── reddit-matches.json        (generated)
│   ├── generated-responses.json   (generated)
│   └── keyword-report.json        (generated)
└── logs/
    ├── .gitkeep
    └── monitor.log                (generated)
```

## Important Notes

- Responses are TEMPLATES -- always review before posting
- Reddit public API has implicit rate limits; the scripts wait 2s between requests
- Never mention Albanese (supplier) in any response
- Only compare against candy brands, not supplement gummies
- Generated data files are gitignored via `data/` and `logs/` patterns
