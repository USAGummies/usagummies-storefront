import fs from "node:fs";

function loadEnvFile(path) {
  const text = fs.readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(".env.local");

const baseUrl = process.argv[2] || process.env.NEXTAUTH_URL || "https://www.usagummies.com";
const cronSecret = (process.env.CRON_SECRET || "").trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackChannel = process.env.SLACK_CHANNEL_ALERTS || "C0ALS6W7VB4";

if (!cronSecret) throw new Error("CRON_SECRET missing");
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase env missing");

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${cronSecret}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabase(path) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function slackHistory() {
  if (!slackBotToken) throw new Error("SLACK_BOT_TOKEN missing");
  const res = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(slackChannel)}&limit=20`, {
    headers: {
      Authorization: `Bearer ${slackBotToken}`,
    },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack history failed: ${data.error}`);
  return data.messages || [];
}

async function main() {
  const startedAt = Date.now();

  const opRes = await fetch(`${baseUrl}/api/ops/abra/operator`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ trigger: "integration-test" }),
  });
  const opData = await opRes.json();
  if (!opRes.ok || !opData.ok) {
    throw new Error(`Operator route failed (${opRes.status}): ${JSON.stringify(opData).slice(0, 500)}`);
  }

  const tasks = await supabase("/rest/v1/abra_operator_tasks?select=id,task_type,status,title,execution_params,created_at&order=created_at.desc&limit=100");
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("No operator tasks found after operator run");
  }

  const completed = tasks.filter((task) => task.status === "completed");
  if (completed.length === 0) {
    throw new Error("No completed operator tasks found");
  }

  const naturalKeyCounts = new Map();
  for (const task of tasks) {
    const key = String(task.execution_params?.natural_key || "").trim().toLowerCase();
    if (!key) continue;
    naturalKeyCounts.set(key, (naturalKeyCounts.get(key) || 0) + 1);
  }
  const duplicates = [...naturalKeyCounts.entries()].filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate operator tasks found: ${duplicates.slice(0, 5).map(([key, count]) => `${key} (${count})`).join(", ")}`);
  }

  const slackMessages = await slackHistory();
  const operatorMessage = slackMessages.find((message) =>
    typeof message.text === "string" && message.text.includes("Abra Operator Cycle"),
  );
  if (!operatorMessage) {
    throw new Error("No operator cycle Slack report found in #abra-control");
  }

  const output = {
    ok: true,
    duration_ms: Date.now() - startedAt,
    operator: opData,
    tasks: {
      total: tasks.length,
      completed: completed.length,
      latest: tasks.slice(0, 5).map((task) => ({
        id: task.id,
        task_type: task.task_type,
        status: task.status,
        title: task.title,
      })),
    },
    slack: {
      ts: operatorMessage.ts,
      text: String(operatorMessage.text).slice(0, 500),
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
