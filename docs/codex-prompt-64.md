# Codex Prompt 64: Production Auth Fix + Smoke Test Suite

## Objective

Fix the CRON_SECRET authorization bug that affects 17 API route files, extract auth into a shared utility, add CRON_SECRET fallback to the chat endpoint, and create a runnable production smoke test script.

## Background

- All Abra API routes duplicate a `isCronAuthorized()` function that compares `process.env.CRON_SECRET` against the `Authorization: Bearer <token>` header
- The Vercel CRON_SECRET env var has been known to contain trailing whitespace (documented issue), causing all Bearer token comparisons to fail
- None of the 17 files call `.trim()` on either value
- The chat endpoint (`/api/ops/abra/chat`) only uses NextAuth session auth with NO cron fallback, making it untestable from scripts/CLI
- This is blocking all production validation

## Task 1: Create shared auth utility

Create `src/lib/ops/abra-auth.ts`:

```typescript
import { auth } from "@/lib/auth/config";

/**
 * Check if a request is authorized via CRON_SECRET bearer token.
 * Trims both values to handle env var whitespace corruption.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = req.headers.get("authorization")?.trim();
  return authHeader === `Bearer ${secret}`;
}

/**
 * Check if a request is authorized via NextAuth session OR CRON_SECRET.
 * Use this for endpoints that should be accessible from both web UI and scripts.
 */
export async function isAuthorized(req: Request): Promise<boolean> {
  // Check NextAuth session first
  try {
    const session = await auth();
    if (session?.user?.email) return true;
  } catch {
    // Session check failed, fall through to cron check
  }
  // Fall back to CRON_SECRET
  return isCronAuthorized(req);
}
```

## Task 2: Update all 17 route files to use the shared utility

Replace the duplicated `isCronAuthorized` / `isAuthorized` / `isAuthorizedCron` functions in ALL of these files with an import from `@/lib/ops/abra-auth`:

1. `src/app/api/ops/abra/anomalies/route.ts` — has `isAuthorizedCron`
2. `src/app/api/ops/abra/anomaly-history/route.ts` — has `isCronAuthorized`
3. `src/app/api/ops/abra/attribution/route.ts` — has `isCronAuthorized`
4. `src/app/api/ops/abra/digest/route.ts` — has `isCronAuthorized`
5. `src/app/api/ops/abra/email-fetch/route.ts` — has `isAuthorized` (cron-only version)
6. `src/app/api/ops/abra/feed-health/route.ts` — has `isCronAuthorized`
7. `src/app/api/ops/abra/forecast/route.ts` — has `isCronAuthorized`
8. `src/app/api/ops/abra/health/route.ts` — has both `isCronAuthorized` AND `isAuthorized`
9. `src/app/api/ops/abra/integration-test/route.ts` — has `isAuthorized` (cron-only version)
10. `src/app/api/ops/abra/inventory-forecast/route.ts` — has `isCronAuthorized`
11. `src/app/api/ops/abra/kpi-history/route.ts` — has `isCronAuthorized`
12. `src/app/api/ops/abra/morning-brief/route.ts` — has `isAuthorizedCron`
13. `src/app/api/ops/abra/operational-signals/route.ts` — has `isCronAuthorized`
14. `src/app/api/ops/abra/pipeline/route.ts` — has `isCronAuthorized`
15. `src/app/api/ops/abra/pulse/route.ts` — has `isCronAuthorized`
16. `src/app/api/ops/abra/revenue-by-channel/route.ts` — has `isCronAuthorized`
17. `src/app/api/ops/abra/scheduler/route.ts` — has `isAuthorizedCron`

For each file:
- Add `import { isAuthorized } from "@/lib/ops/abra-auth";` (or `isCronAuthorized` if the file only needs cron auth without session)
- Delete the local `isCronAuthorized` / `isAuthorized` / `isAuthorizedCron` function definition
- If the file had both `isCronAuthorized` and `isAuthorized`, import `isAuthorized` (which checks both session + cron)
- If the file only had `isCronAuthorized` or `isAuthorizedCron`, decide: if the endpoint should be accessible from the web UI too, import `isAuthorized`. If it's strictly a cron/scheduler endpoint, import `isCronAuthorized`.
- Make sure the call sites still match — if the file called `isAuthorizedCron(req)`, update to `isCronAuthorized(req)` or `isAuthorized(req)` as appropriate

**IMPORTANT**: Some of these files also use `Bearer ${serviceKey}` for OUTBOUND Supabase requests (e.g., `headers.set("Authorization", \`Bearer ${serviceKey}\`)`). Do NOT touch those lines — they are NOT the auth check, they are Supabase client headers.

## Task 3: Add CRON_SECRET fallback to the chat endpoint

In `src/app/api/ops/abra/chat/route.ts`, the POST handler currently does:
```typescript
const session = await auth();
if (!session?.user?.email) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Replace this with:
```typescript
import { isAuthorized } from "@/lib/ops/abra-auth";
// ... in the POST handler:
if (!(await isAuthorized(req))) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Keep the `session` variable accessible below if it's used for `session.user.email` later in the handler. If so, do:
```typescript
const session = await auth();
const userEmail = session?.user?.email;
if (!userEmail && !isCronAuthorized(req)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Also check these other Abra endpoints that may ONLY use NextAuth (no cron fallback) and add the same pattern:
- `src/app/api/ops/abra/initiative/route.ts`
- `src/app/api/ops/abra/session/route.ts`
- `src/app/api/ops/abra/research/route.ts`
- `src/app/api/ops/abra/teach/route.ts`
- `src/app/api/ops/abra/correct/route.ts`
- `src/app/api/ops/abra/cost/route.ts`
- `src/app/api/ops/abra/actions/route.ts` (and subdirectories)
- `src/app/api/ops/abra/approvals/route.ts`
- `src/app/api/ops/abra/dashboard-config/route.ts`

For each one: if it only checks `auth()` session, add the `isCronAuthorized` fallback so it can be tested from CLI/scripts.

## Task 4: Create production smoke test script

Create `scripts/production-smoke-test.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Production smoke test for Abra API endpoints.
 * Reads CRON_SECRET from .env.local and tests key endpoints.
 *
 * Usage: node scripts/production-smoke-test.mjs [base_url]
 * Default base_url: https://www.usagummies.com
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
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

const BASE_URL = process.argv[2] || 'https://www.usagummies.com';
const CRON_SECRET = process.env.CRON_SECRET?.trim();

if (!CRON_SECRET) {
  console.error('❌ CRON_SECRET not found in .env.local');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${CRON_SECRET}`,
};

const tests = [
  {
    name: 'Health endpoint',
    method: 'GET',
    path: '/api/ops/abra/health',
    validate: (data) => data && typeof data === 'object' && !data.error,
  },
  {
    name: 'Integration test',
    method: 'GET',
    path: '/api/ops/abra/integration-test',
    validate: (data) => data && !data.error,
  },
  {
    name: 'Chat — identity question',
    method: 'POST',
    path: '/api/ops/abra/chat',
    body: { message: 'What does USA Gummies sell? Answer in one sentence.' },
    validate: (data) => data && data.reply && !data.error,
  },
  {
    name: 'Initiative — list finance',
    method: 'GET',
    path: '/api/ops/abra/initiative?department=finance',
    validate: (data) => Array.isArray(data) || (data && !data.error),
  },
  {
    name: 'Cost — monthly spend',
    method: 'GET',
    path: '/api/ops/abra/cost',
    validate: (data) => data && !data.error,
  },
  {
    name: 'Morning brief',
    method: 'GET',
    path: '/api/ops/abra/morning-brief',
    validate: (data) => data && !data.error,
  },
  {
    name: 'Operational signals',
    method: 'GET',
    path: '/api/ops/abra/operational-signals',
    validate: (data) => data && !data.error,
  },
  {
    name: 'Pipeline',
    method: 'GET',
    path: '/api/ops/abra/pipeline',
    validate: (data) => data && !data.error,
  },
];

async function runTest(test) {
  const url = `${BASE_URL}${test.path}`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: test.method,
      headers,
      body: test.body ? JSON.stringify(test.body) : undefined,
    });
    const elapsed = Date.now() - start;
    const data = await res.json().catch(() => null);

    if (res.status === 401) {
      return { name: test.name, pass: false, status: 401, ms: elapsed, error: 'Unauthorized — CRON_SECRET auth failed' };
    }
    if (res.status >= 500) {
      return { name: test.name, pass: false, status: res.status, ms: elapsed, error: data?.error || 'Server error' };
    }
    if (!test.validate(data)) {
      return { name: test.name, pass: false, status: res.status, ms: elapsed, error: `Validation failed: ${JSON.stringify(data).slice(0, 200)}` };
    }
    return { name: test.name, pass: true, status: res.status, ms: elapsed };
  } catch (err) {
    return { name: test.name, pass: false, status: 0, ms: Date.now() - start, error: err.message };
  }
}

async function main() {
  console.log(`\n🔍 SMOKE TEST: ${BASE_URL}\n${'═'.repeat(60)}\n`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await runTest(test);
    const icon = result.pass ? '✅' : '❌';
    const status = result.status ? `[${result.status}]` : '[ERR]';
    console.log(`${icon} ${status} ${result.name} (${result.ms}ms)`);
    if (!result.pass) {
      console.log(`   └─ ${result.error}`);
      failed++;
    } else {
      passed++;
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${tests.length}`);
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
```

## Task 5: Verify

1. Run `npm run build` — must pass with 0 errors
2. Run `node scripts/production-smoke-test.mjs http://localhost:3000` against local dev (start with `npm run dev` first) to verify auth works locally
3. If any test returns 401, the auth fix didn't work — debug
4. If any test returns 500, log the error and investigate the root cause in that specific route

## Files to create
- `src/lib/ops/abra-auth.ts`
- `scripts/production-smoke-test.mjs`

## Files to modify (17 route files + chat + any others using auth-only)
- `src/app/api/ops/abra/anomalies/route.ts`
- `src/app/api/ops/abra/anomaly-history/route.ts`
- `src/app/api/ops/abra/attribution/route.ts`
- `src/app/api/ops/abra/chat/route.ts`
- `src/app/api/ops/abra/digest/route.ts`
- `src/app/api/ops/abra/email-fetch/route.ts`
- `src/app/api/ops/abra/feed-health/route.ts`
- `src/app/api/ops/abra/forecast/route.ts`
- `src/app/api/ops/abra/health/route.ts`
- `src/app/api/ops/abra/integration-test/route.ts`
- `src/app/api/ops/abra/inventory-forecast/route.ts`
- `src/app/api/ops/abra/kpi-history/route.ts`
- `src/app/api/ops/abra/morning-brief/route.ts`
- `src/app/api/ops/abra/operational-signals/route.ts`
- `src/app/api/ops/abra/pipeline/route.ts`
- `src/app/api/ops/abra/pulse/route.ts`
- `src/app/api/ops/abra/revenue-by-channel/route.ts`
- `src/app/api/ops/abra/scheduler/route.ts`
- `src/app/api/ops/abra/initiative/route.ts` (add cron fallback)
- `src/app/api/ops/abra/session/route.ts` (add cron fallback)
- `src/app/api/ops/abra/research/route.ts` (add cron fallback)
- `src/app/api/ops/abra/teach/route.ts` (add cron fallback)
- `src/app/api/ops/abra/correct/route.ts` (add cron fallback)
- `src/app/api/ops/abra/cost/route.ts` (add cron fallback)
- `src/app/api/ops/abra/actions/route.ts` (add cron fallback if exists)
- `src/app/api/ops/abra/approvals/route.ts` (add cron fallback if exists)
- `src/app/api/ops/abra/dashboard-config/route.ts` (add cron fallback if exists)

## Commit message
```
Abra v2 Prompt 64: shared auth utility + production smoke test

- Extract isCronAuthorized/isAuthorized to src/lib/ops/abra-auth.ts
- Add .trim() to CRON_SECRET and Authorization header comparison
- Replace duplicated auth functions in 17 route files with shared import
- Add CRON_SECRET fallback to chat, initiative, session, teach, correct, cost, actions, approvals, dashboard-config endpoints
- Create scripts/production-smoke-test.mjs for endpoint validation
```
