/**
 * OpenAI Image Generation wrapper for the Content Factory.
 *
 * Calls the gpt-image-1 model with a composed prompt + (optional) reference
 * image for style locking. Returns the path to the saved PNG.
 *
 * Usage:
 *   import { generateImage } from "./lib/openai-image.mjs";
 *   const result = await generateImage({
 *     prompt: "...",
 *     referenceImagePath: "public/brand/ad-assets-round2/comic-libertys-break.png",
 *     outputPath: "public/brand/factory/abc123/1.png",
 *     dimensions: "1024x1024",
 *     quality: "high",
 *   });
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const OPENAI_BASE = "https://api.openai.com/v1";

export async function generateImage({
  prompt,
  referenceImagePath = null,
  outputPath,
  dimensions = "1024x1024",
  quality = "high",
  apiKey,
}) {
  if (!apiKey) throw new Error("apiKey required");
  if (!prompt) throw new Error("prompt required");
  if (!outputPath) throw new Error("outputPath required");

  // Ensure output dir exists
  mkdirSync(path.dirname(outputPath), { recursive: true });

  let response;
  if (referenceImagePath && existsSync(referenceImagePath)) {
    // Use the EDIT endpoint with image-to-image (style anchor)
    // gpt-image-1 supports multipart upload with an image input for style transfer
    const imageBuffer = readFileSync(referenceImagePath);
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: "image/png" });
    formData.append("image", blob, path.basename(referenceImagePath));
    formData.append("model", "gpt-image-1");
    formData.append("prompt", prompt);
    formData.append("size", dimensions);
    formData.append("quality", quality);
    formData.append("n", "1");

    const res = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI edits API ${res.status}: ${err.slice(0, 400)}`);
    }
    response = await res.json();
  } else {
    // No reference image — use generations endpoint
    const res = await fetch(`${OPENAI_BASE}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: dimensions,
        quality,
        n: 1,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI generations API ${res.status}: ${err.slice(0, 400)}`);
    }
    response = await res.json();
  }

  const data = response.data?.[0];
  if (!data) throw new Error("No image returned from OpenAI");

  // gpt-image-1 returns base64 by default
  if (data.b64_json) {
    writeFileSync(outputPath, Buffer.from(data.b64_json, "base64"));
  } else if (data.url) {
    // Fallback if API returned URL
    const imgRes = await fetch(data.url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    writeFileSync(outputPath, buf);
  } else {
    throw new Error("OpenAI response missing b64_json and url");
  }

  return {
    outputPath,
    revisedPrompt: data.revised_prompt || null,
    usage: response.usage || null,
  };
}

/**
 * Compose the final prompt by injecting style profile rules into the user concept.
 * Style profile is loaded from data/content-factory/style-profiles.json.
 */
export function composePrompt({ styleProfile, conceptText }) {
  const parts = [];
  parts.push(styleProfile.prompt_prefix);
  parts.push("");
  parts.push("CONCEPT (the scene to depict):");
  parts.push(conceptText);
  parts.push("");
  parts.push(`COLOR PALETTE: ${styleProfile.color_palette}`);
  parts.push("");
  parts.push(`COMPOSITION: ${styleProfile.composition}`);
  parts.push("");
  parts.push("FORBIDDEN (do not include any of these in the image):");
  for (const f of styleProfile.forbidden) parts.push(`  - ${f}`);
  parts.push("");
  parts.push(`OUTPUT: One ${styleProfile.dimensions} image, no collage, no text overlay beyond brand wordmarks. Generate the image directly.`);
  return parts.join("\n");
}
