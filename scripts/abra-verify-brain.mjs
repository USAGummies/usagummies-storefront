#!/usr/bin/env node
/**
 * abra-verify-brain.mjs — Verify Abra brain health and test retrieval
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

async function getEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000), dimensions: 1536 }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function searchBrain(query, limit = 5) {
  const embedding = await getEmbedding(query);

  // Try tiered search first (matches production path in abra-memory-tiers.ts)
  let res = await fetch(`${url}/rest/v1/rpc/search_temporal_tiered`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query_embedding: embedding,
      hot_count: Math.max(2, Math.ceil(limit * 0.35)),
      warm_count: Math.max(2, Math.ceil(limit * 0.35)),
      cold_count: Math.max(1, Math.ceil(limit * 0.3)),
    }),
  });

  // Fallback to search_temporal with filter_tables (matches searchFallback in abra-memory-tiers.ts)
  if (!res.ok) {
    const tieredErr = await res.text();
    console.log(`   (tiered RPC failed, falling back to search_temporal: ${tieredErr.slice(0, 80)})`);
    res = await fetch(`${url}/rest/v1/rpc/search_temporal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query_embedding: embedding,
        match_count: limit,
        filter_tables: ['brain', 'email'],
      }),
    });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Search failed (${res.status}): ${err.slice(0, 200)}`);
  }
  return await res.json();
}

async function main() {
  console.log('\n🧠 ABRA BRAIN VERIFICATION\n');
  console.log('═'.repeat(60));

  // 1. Count total entries
  const countRes = await fetch(`${url}/rest/v1/open_brain_entries?select=id&limit=1000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  const totalCount = countRes.headers.get('content-range');
  console.log(`\n📊 Total brain entries: ${totalCount}`);

  // 2. Count by category
  const allEntries = await fetch(`${url}/rest/v1/open_brain_entries?select=category,department,entry_type`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).then(r => r.json());

  const byCat = {};
  const byDept = {};
  const byType = {};
  for (const e of allEntries) {
    byCat[e.category] = (byCat[e.category] || 0) + 1;
    byDept[e.department || 'null'] = (byDept[e.department || 'null'] || 0) + 1;
    byType[e.entry_type] = (byType[e.entry_type] || 0) + 1;
  }
  console.log('\n📁 By Category:', JSON.stringify(byCat, null, 2));
  console.log('\n🏢 By Department:', JSON.stringify(byDept, null, 2));
  console.log('\n📝 By Entry Type:', JSON.stringify(byType, null, 2));

  // 3. Test searches — does Abra find the right teachings?
  const TEST_QUERIES = [
    'What is USA Gummies?',
    'Who is the founder?',
    'How should we set up QuickBooks?',
    'What is our gross margin on Amazon?',
    'How do gummy vitamins get manufactured?',
    'How do we get into retail stores before Memorial Day?',
    'What should our weekly operating rhythm look like?',
    'How much funding are we getting?',
    'What are the FDA requirements for supplements?',
    'How does Faire work for wholesale?',
    'What is our competitive landscape?',
    'How should we manage cash flow?',
  ];

  console.log('\n\n🔍 SEARCH RETRIEVAL TESTS\n');
  console.log('═'.repeat(60));

  for (const query of TEST_QUERIES) {
    console.log(`\n❓ "${query}"`);
    try {
      const results = await searchBrain(query, 3);
      if (results.length === 0) {
        console.log('   ⚠️  No results found');
      } else {
        for (let i = 0; i < Math.min(results.length, 3); i++) {
          const r = results[i];
          const score = (r.temporal_score || r.similarity || 0).toFixed(3);
          console.log(`   ${i + 1}. [${score}] ${(r.title || '').slice(0, 60)} (${r.department || '?'})`);
        }
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message.slice(0, 100)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ Brain verification complete');
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
