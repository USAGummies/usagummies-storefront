#!/usr/bin/env node
// =============================================================================
// USA Gummies — AI Response Generator
//
// Reads matched Reddit posts and generates three response variations per post,
// each in a different persona. Uses OpenAI GPT-4.1-mini for generation.
//
// Responses are TEMPLATES for human review — nothing is auto-posted.
//
// Usage:
//   node generate-responses.mjs
//   node generate-responses.mjs --dry-run     (show prompts, skip API calls)
//   node generate-responses.mjs --limit 5     (only process 5 posts)
//   node generate-responses.mjs --post-id abc (process single post)
//
// Requires OPENAI_API_KEY in environment or ../../.env.local
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { PERSONAS, RESPONSE_SETTINGS, PATHS } from './config.mjs';

// ---------------------------------------------------------------------------
// Load env vars from .env.local if present
// ---------------------------------------------------------------------------

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

function loadEnv() {
  const projectRoot = resolve(dirname(PATHS.dataDir), '..', '..');
  // Check multiple env file locations
  const envFiles = [
    resolve(projectRoot, '.env.local'),
    resolve(projectRoot, '.vercel', '.env.development.local'),
    resolve(projectRoot, '.vercel', '.env.production.local'),
  ];
  for (const f of envFiles) {
    loadEnvFile(f);
  }
}

loadEnv();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// OpenAI client (lightweight, no SDK dependency needed but using installed one)
// ---------------------------------------------------------------------------

async function callOpenAI(messages, temperature = RESPONSE_SETTINGS.temperature) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not found. Set it in environment or .env.local');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: RESPONSE_SETTINGS.model,
      messages,
      temperature,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(persona) {
  const p = PERSONAS[persona];
  const bannedPhrases = RESPONSE_SETTINGS.neverUseLanguage.map((l) => `"${l}"`).join(', ');
  const bannedWords = RESPONSE_SETTINGS.neverMention.map((w) => `"${w}"`).join(', ');

  return `You are writing a Reddit comment in the voice of a real person. Your persona:

PERSONA: ${p.name}
DESCRIPTION: ${p.description}
TONE: ${p.tone}

EXAMPLE OPENING LINES (use as inspiration, don't copy exactly):
${p.exampleOpeners.map((o) => `- "${o}"`).join('\n')}

GUIDELINES:
${p.guidelines.map((g) => `- ${g}`).join('\n')}

STRICT RULES:
1. The response MUST be under ${RESPONSE_SETTINGS.maxWords} words.
2. The response must be genuinely helpful — answer the actual question or contribute to the discussion FIRST.
3. Mention "${RESPONSE_SETTINGS.brandName}" exactly ONCE, organically woven into your personal experience.
4. Include a specific personal detail or anecdote that makes it feel authentic.
5. NEVER use these marketing phrases: ${bannedPhrases}
6. NEVER mention: ${bannedWords}
7. Write in casual Reddit style — no formal paragraphs, no bullet points, no headers.
8. Don't start with "Hey!" or "Great question!" — just dive in naturally.
9. If the post is asking for recommendations, your response should genuinely help with the broader question, not just plug one brand.
10. Sound like a normal person who happens to have relevant experience — NOT a brand ambassador.
11. Do NOT compare against supplement gummies — only compare against candy brands.
12. Keep it conversational. Use contractions. Maybe a dash of humor if it fits.
13. Do NOT use exclamation marks more than once in the entire response.

OUTPUT: Write ONLY the Reddit comment text. No labels, no metadata, no explanation.`;
}

// ---------------------------------------------------------------------------
// Generate a single response
// ---------------------------------------------------------------------------

async function generateResponse(post, personaKey) {
  const userPrompt = `Write a Reddit comment replying to this post:

SUBREDDIT: r/${post.subreddit}
TITLE: ${post.title}
POST BODY: ${post.selftext || '(no body text — title only)'}
MATCHED KEYWORDS: ${post.matched_keywords.join(', ')}

Remember: Be genuinely helpful about the topic. The brand mention should feel incidental, not central.`;

  const systemPrompt = buildSystemPrompt(personaKey);

  const response = await callOpenAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  return response;
}

// ---------------------------------------------------------------------------
// Validate a generated response
// ---------------------------------------------------------------------------

function validateResponse(text) {
  const issues = [];

  // Word count check
  const wordCount = text.split(/\s+/).length;
  if (wordCount > RESPONSE_SETTINGS.maxWords + 20) {
    issues.push(`Too long: ${wordCount} words (max ${RESPONSE_SETTINGS.maxWords})`);
  }

  // Banned phrases check
  for (const phrase of RESPONSE_SETTINGS.neverUseLanguage) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push(`Contains banned phrase: "${phrase}"`);
    }
  }

  // Banned words check
  for (const word of RESPONSE_SETTINGS.neverMention) {
    if (text.toLowerCase().includes(word.toLowerCase())) {
      issues.push(`Contains banned word: "${word}"`);
    }
  }

  // Brand mention check
  if (!text.toLowerCase().includes(RESPONSE_SETTINGS.brandName.toLowerCase())) {
    issues.push('Missing brand mention');
  }

  // Multiple brand mentions
  const brandRegex = new RegExp(RESPONSE_SETTINGS.brandName, 'gi');
  const mentionCount = (text.match(brandRegex) || []).length;
  if (mentionCount > 2) {
    issues.push(`Too many brand mentions: ${mentionCount} (max 2)`);
  }

  // Confidence score: 100 minus penalties
  let confidence = 100;
  confidence -= issues.length * 15;
  confidence -= Math.max(0, wordCount - RESPONSE_SETTINGS.maxWords) * 0.5;
  if (mentionCount === 1) confidence += 5; // Bonus for exactly one mention
  confidence = Math.max(0, Math.min(100, confidence));

  return {
    valid: issues.length === 0,
    issues,
    confidence: Math.round(confidence),
    wordCount,
    brandMentions: mentionCount,
  };
}

// ---------------------------------------------------------------------------
// Main generation pipeline
// ---------------------------------------------------------------------------

export async function runResponseGenerator(options = {}) {
  const dryRun = process.argv.includes('--dry-run') || options.dryRun;

  // Parse --limit flag
  let limit = Infinity;
  const limitIdx = process.argv.indexOf('--limit');
  if (limitIdx !== -1 && process.argv[limitIdx + 1]) {
    limit = parseInt(process.argv[limitIdx + 1], 10);
  }
  if (options.limit) limit = options.limit;

  // Parse --post-id flag
  let targetPostId = null;
  const postIdIdx = process.argv.indexOf('--post-id');
  if (postIdIdx !== -1 && process.argv[postIdIdx + 1]) {
    targetPostId = process.argv[postIdIdx + 1];
  }

  const startTime = Date.now();
  log('=== Response Generator Starting ===');

  // Load matched posts
  if (!existsSync(PATHS.redditMatches)) {
    log('No reddit-matches.json found. Run reddit-monitor.mjs first.');
    return { generated: 0 };
  }

  let posts = JSON.parse(readFileSync(PATHS.redditMatches, 'utf-8'));
  log(`Loaded ${posts.length} matched posts`);

  // Filter by post ID if specified
  if (targetPostId) {
    posts = posts.filter((p) => p.id === targetPostId);
    log(`Filtered to post: ${targetPostId}`);
  }

  // Filter by minimum score
  posts = posts.filter((p) => p.score >= RESPONSE_SETTINGS.minPostScore);
  log(`After score filter (>=${RESPONSE_SETTINGS.minPostScore}): ${posts.length} posts`);

  // Load existing responses to skip already-processed posts
  let existingResponses = [];
  if (existsSync(PATHS.generatedResponses)) {
    try {
      existingResponses = JSON.parse(readFileSync(PATHS.generatedResponses, 'utf-8'));
    } catch {
      existingResponses = [];
    }
  }
  const processedUrls = new Set(existingResponses.map((r) => r.post_url));

  // Filter out already-processed posts
  const unprocessed = posts.filter((p) => !processedUrls.has(p.url));
  log(`Unprocessed posts: ${unprocessed.length}`);

  // Apply limit
  const toProcess = unprocessed.slice(0, limit);
  log(`Will generate responses for ${toProcess.length} posts`);

  if (dryRun) {
    log('\n--- DRY RUN ---');
    for (const post of toProcess) {
      log(`\nPost: ${post.title.slice(0, 80)}`);
      log(`  URL: ${post.url}`);
      log(`  Keywords: ${post.matched_keywords.join(', ')}`);
      log(`  Would generate 3 responses (helpful_parent, patriotic_consumer, ingredient_nerd)`);
    }
    log('\n=== Dry Run Complete ===');
    return { generated: 0, wouldGenerate: toProcess.length * 3 };
  }

  // Check API key
  if (!process.env.OPENAI_API_KEY) {
    log('ERROR: OPENAI_API_KEY not set. Cannot generate responses.');
    log('Set it in your environment or in ../../.env.local');
    return { generated: 0, error: 'Missing API key' };
  }

  const newResponses = [];
  const personaKeys = Object.keys(PERSONAS);

  for (let i = 0; i < toProcess.length; i++) {
    const post = toProcess[i];
    log(`\n[${i + 1}/${toProcess.length}] Processing: ${post.title.slice(0, 60)}...`);

    for (const personaKey of personaKeys) {
      const persona = PERSONAS[personaKey];
      log(`  Generating ${persona.name} response...`);

      try {
        const responseText = await generateResponse(post, personaKey);
        const validation = validateResponse(responseText);

        newResponses.push({
          id: `${post.id}_${personaKey}_${Date.now()}`,
          post_id: post.id,
          post_url: post.url,
          post_title: post.title,
          post_subreddit: post.subreddit,
          post_score: post.score,
          post_keywords: post.matched_keywords,
          persona: persona.name,
          persona_key: personaKey,
          response_text: responseText,
          confidence_score: validation.confidence,
          validation: validation,
          generated_at: new Date().toISOString(),
          status: 'pending_review',
          ftc_reminder: 'FTC/REDDIT DISCLOSURE: If posting on behalf of USA Gummies or as a brand affiliate, you MUST disclose your material connection. Reddit TOS prohibits undisclosed commercial promotion.',
        });

        if (!validation.valid) {
          log(`    WARNING: Validation issues: ${validation.issues.join('; ')}`);
        }
        log(`    Done (${validation.wordCount} words, confidence: ${validation.confidence})`);

        // Small delay between API calls
        await sleep(500);
      } catch (err) {
        log(`    ERROR generating ${persona.name} response: ${err.message}`);
        newResponses.push({
          id: `${post.id}_${personaKey}_${Date.now()}`,
          post_id: post.id,
          post_url: post.url,
          post_title: post.title,
          post_subreddit: post.subreddit,
          persona: persona.name,
          persona_key: personaKey,
          response_text: null,
          confidence_score: 0,
          error: err.message,
          generated_at: new Date().toISOString(),
          status: 'error',
        });
      }
    }
  }

  // Merge with existing responses
  const allResponses = [...newResponses, ...existingResponses];

  // Write output
  const dir = dirname(PATHS.generatedResponses);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(PATHS.generatedResponses, JSON.stringify(allResponses, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = newResponses.filter((r) => r.response_text).length;
  const errorCount = newResponses.filter((r) => r.error).length;

  log(`\nGeneration complete in ${elapsed}s`);
  log(`Generated: ${successCount} responses`);
  log(`Errors: ${errorCount}`);
  log(`Total responses in database: ${allResponses.length}`);
  log(`Wrote to ${PATHS.generatedResponses}`);
  log('=== Response Generator Complete ===\n');

  return { generated: successCount, errors: errorCount, total: allResponses.length };
}

// Run directly
if (process.argv[1] && process.argv[1].includes('generate-responses')) {
  runResponseGenerator().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
