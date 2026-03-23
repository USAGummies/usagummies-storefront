#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

// Load .env.local
const envContent = fs.readFileSync(
  path.join(process.cwd(), ".env.local"),
  "utf8",
);
const match = envContent.match(/GEMINI_API_KEY=(.+)/);
const key = match ? match[1].trim() : "";

if (!key) {
  console.error("No GEMINI_API_KEY found in .env.local");
  process.exit(1);
}

// Test the actual Nano Banana 2 and newer image models
const models = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "nano-banana-pro-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.0-flash-exp-image-generation",
];

const prompt =
  "A single colorful gummy bear on a white background, professional product photography, studio lighting";

for (const model of models) {
  console.log(`\n--- Testing model: ${model} ---`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      try {
        const errorJson = JSON.parse(text);
        console.log(`  STATUS: ${res.status} — ${errorJson.error?.message?.slice(0, 200) || text.slice(0, 200)}`);
      } catch {
        console.log(`  STATUS: ${res.status} — ${text.slice(0, 200)}`);
      }
      continue;
    }

    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts || [];

    for (const p of parts) {
      if (p.inlineData?.data) {
        const sizeKB = Math.round((p.inlineData.data.length * 3) / 4 / 1024);
        console.log(`  SUCCESS! Image received (${sizeKB} KB, ${p.inlineData.mimeType})`);

        const outDir = path.join(process.cwd(), "public", "content-library");
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `test-gemini-${Date.now()}.png`);
        fs.writeFileSync(outPath, Buffer.from(p.inlineData.data, "base64"));
        console.log(`  Saved: ${outPath}`);
        console.log(`  Finish reason: ${json.candidates?.[0]?.finishReason}`);
        console.log(`\nWORKING MODEL: ${model}`);
        process.exit(0);
      }
      if (p.text) {
        console.log(`  Text response (no image): ${p.text.slice(0, 100)}`);
      }
    }
    console.log(`  Finish reason: ${json.candidates?.[0]?.finishReason}`);
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }
}

console.log("\nAll models failed. Check billing at https://ai.google.dev/");
