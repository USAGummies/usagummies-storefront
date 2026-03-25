import fs from "node:fs";
import { processAbraMessage } from "@/lib/ops/abra-slack-responder";

type InputMessage = {
  text: string;
  user: string;
  channel: string;
  ts?: string;
  threadTs?: string;
  displayName?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: tsx scripts/run-slack-message.ts <input.json>");
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const payload = JSON.parse(raw) as InputMessage | InputMessage[];
  const inputs = Array.isArray(payload) ? payload : [payload];
  const results = [];

  for (const item of inputs) {
    const startedAt = Date.now();
    const result = await processAbraMessage({
      text: item.text,
      user: item.user,
      channel: item.channel,
      ts: item.ts || `${Date.now() / 1000}`,
      ...(item.threadTs ? { threadTs: item.threadTs } : {}),
      ...(item.displayName ? { displayName: item.displayName } : {}),
      ...(item.history ? { history: item.history } : {}),
    });
    results.push({
      ms: Date.now() - startedAt,
      ...result,
    });
  }

  process.stdout.write(JSON.stringify(Array.isArray(payload) ? results : results[0]));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
