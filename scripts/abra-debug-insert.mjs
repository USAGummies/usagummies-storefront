#!/usr/bin/env node
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

console.log('URL:', url ? url.slice(0, 40) + '...' : 'MISSING');
console.log('Key:', key ? key.slice(0, 10) + '...' : 'MISSING');

// 1. Check existing entries
const listRes = await fetch(`${url}/rest/v1/open_brain_entries?select=id,title,entry_type,department,confidence,priority&limit=3`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
});
console.log('\n--- Existing entries ---');
console.log('Status:', listRes.status);
const existing = await listRes.json();
console.log(JSON.stringify(existing, null, 2));

// 2. Try insert WITHOUT embedding (no vector)
console.log('\n--- Test insert (no embedding) ---');
const testRes = await fetch(`${url}/rest/v1/open_brain_entries`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({
    source_type: 'manual',
    source_ref: `debug-${Date.now()}`,
    entry_type: 'teaching',
    title: 'Debug test',
    raw_text: 'Debug content for testing constraints',
    summary_text: 'debug',
    category: 'teaching',
    department: 'executive',
    confidence: 'high',
    priority: 'important',
    processed: true,
  }),
});
const testBody = await testRes.text();
console.log('Status:', testRes.status);
console.log('Response:', testBody.slice(0, 600));

// 3. Check table columns via OpenAPI
console.log('\n--- Check table definition ---');
const defRes = await fetch(`${url}/rest/v1/?apikey=${key}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
});
if (defRes.ok) {
  const openapi = await defRes.json();
  const schema = openapi?.definitions?.open_brain_entries;
  if (schema) {
    console.log('Columns:', Object.keys(schema.properties || {}).join(', '));
    console.log('Required:', JSON.stringify(schema.required));
  } else {
    console.log('Table not found in OpenAPI spec');
  }
} else {
  console.log('OpenAPI fetch failed:', defRes.status);
}
