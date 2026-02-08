import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const eslintCacheDir = path.join(process.cwd(), ".next", "cache", "eslint");

function runLint() {
  const result = spawnSync("next", ["lint"], {
    stdio: "inherit",
    shell: true,
  });
  return result.status ?? 1;
}

let status = runLint();
if (status === 0) {
  process.exit(0);
}

if (existsSync(eslintCacheDir)) {
  try {
    rmSync(eslintCacheDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Failed to clear eslint cache:", error);
  }
}

status = runLint();
process.exit(status ?? 1);
