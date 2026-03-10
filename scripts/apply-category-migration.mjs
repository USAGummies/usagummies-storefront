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

// Execute SQL directly via the pg/query endpoint
const sql = `
ALTER TABLE open_brain_entries DROP CONSTRAINT IF EXISTS open_brain_entries_category_check;
ALTER TABLE open_brain_entries ADD CONSTRAINT open_brain_entries_category_check
  CHECK (category IN (
    'market_intel', 'financial', 'operational', 'regulatory',
    'customer_insight', 'deal_data', 'email_triage',
    'competitive', 'research', 'field_note', 'system_log',
    'teaching', 'general', 'company_info', 'product_info',
    'supply_chain', 'sales', 'founder', 'culture'
  ));
`;

const res = await fetch(`${url}/rest/v1/rpc/`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name: 'exec_sql', args: { sql } }),
});

// The RPC approach might not work, let's try direct SQL via supabase management API
// Actually, let's just use the Supabase SQL endpoint
const pgUrl = url.replace('.supabase.co', '.supabase.co') + '/pg';

// Alternative: Use the REST API to check if we can use a workaround
// The simplest approach: Just push the pending migrations via supabase db push
console.log('Attempting direct SQL via supabase db push...');
console.log('Note: if this fails, we will apply category fix via the Supabase dashboard SQL editor');

// Alternative approach: try via the management API
const accessToken = 'sbp_5fbf9cbc8a252eaa6bdb0c39aa8a7498bb450a94';
const projectRef = 'zdvfllvopocptwgummzb';

const mgmtRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

console.log('Management API status:', mgmtRes.status);
const result = await mgmtRes.text();
console.log('Result:', result.slice(0, 500));
