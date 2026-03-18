# Failures & Learnings Log

## 2026-02-19 — Session reset
- Cleared all agent sessions (7.9MB of bloated history)
- Switched primary model: mistral/mistral-medium-latest
- Fallbacks: groq/llama-3.1-8b-instant → groq/gpt-oss-20b → ollama/llama3.1:8b
- Fixed W3 delivery target error (mode: announce → none)
- Groq free tier has 6K TPM limit — cannot handle sessions with accumulated history

## Key Learnings
- Groq llama-3.1-8b-instant: 6K TPM, too low for multi-turn sessions
- Mistral tiny: rate limited as of 2026-02-19, medium works
- Session files grow rapidly (1.3MB+ per agent after 24h) — need periodic cleanup
- W3 delivery mode "announce" requires an active delivery target; use "none" for fire-and-forget
- web_fetch fails on many sites (Etsy, etc.) due to JS requirements
