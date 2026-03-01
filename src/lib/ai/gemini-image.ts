import "server-only";

/**
 * Gemini Nano Banana 2 — Image Generation via Google AI API
 *
 * Model: gemini-3.1-flash-image-preview (Nano Banana 2)
 * Docs:  https://ai.google.dev/gemini-api/docs/image-generation
 *
 * Returns base64 PNG image data from a text prompt.
 */

const MODEL = "gemini-2.0-flash-exp";

function geminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    ""
  ).trim();
}

export function isGeminiConfigured(): boolean {
  return !!geminiApiKey();
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  error?: { message?: string; code?: number };
};

export type GeneratedImage = {
  base64: string;
  mimeType: string;
  text?: string; // any accompanying text from the model
};

/**
 * Generate an image using Gemini Nano Banana 2.
 *
 * @param prompt - Text description of the image to generate
 * @param options - Optional config
 * @returns Generated image as base64 data
 */
export async function generateImage(
  prompt: string,
  options?: {
    /** Override model (default: gemini-2.0-flash-exp) */
    model?: string;
    /** Timeout in ms (default: 60000) */
    timeoutMs?: number;
  },
): Promise<GeneratedImage> {
  const key = geminiApiKey();
  if (!key) {
    throw new Error(
      "Gemini API key not configured. Set GEMINI_API_KEY or GOOGLE_AI_API_KEY.",
    );
  }

  const model = options?.model || MODEL;
  const timeoutMs = options?.timeoutMs || 60_000;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Gemini API failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as GeminiResponse;

    if (json.error) {
      throw new Error(
        `Gemini error: ${json.error.message || JSON.stringify(json.error)}`,
      );
    }

    const parts = json.candidates?.[0]?.content?.parts || [];
    let imageData: GeneratedImage | null = null;
    let textContent = "";

    for (const part of parts) {
      if ("inlineData" in part && part.inlineData?.data) {
        imageData = {
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        };
      }
      if ("text" in part && part.text) {
        textContent += part.text;
      }
    }

    if (!imageData) {
      throw new Error(
        "Gemini response contained no image data. " +
          `Finish reason: ${json.candidates?.[0]?.finishReason || "unknown"}. ` +
          (textContent ? `Model said: ${textContent.slice(0, 200)}` : ""),
      );
    }

    if (textContent) {
      imageData.text = textContent.trim();
    }

    return imageData;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate a social media image for USA Gummies marketing.
 *
 * Wraps generateImage with brand-specific prompt engineering.
 */
export async function generateMarketingImage(
  topic: string,
  style:
    | "product-hero"
    | "lifestyle"
    | "patriotic"
    | "health-wellness"
    | "social-post" = "social-post",
): Promise<GeneratedImage> {
  const styleGuides: Record<string, string> = {
    "product-hero":
      "Professional product photography style. White or light background. " +
      "Show gummy vitamins in a clean, appetizing way. Bright, well-lit, commercial quality.",
    lifestyle:
      "Lifestyle photography. Active, healthy American family or individual. " +
      "Natural lighting, warm tones. Outdoors or modern kitchen setting.",
    patriotic:
      "Patriotic American theme. Red, white, and blue color palette. " +
      "Stars, stripes, or American landscapes. Uplifting and proud tone.",
    "health-wellness":
      "Health and wellness theme. Clean, fresh, natural ingredients visible. " +
      "Green and gold tones. Vitamins, fruit, nature imagery.",
    "social-post":
      "Eye-catching social media graphic. Bold colors, modern design. " +
      "Text-friendly composition with open space for overlay text. Square format.",
  };

  const fullPrompt =
    `Create a high-quality marketing image for USA Gummies, an American-made gummy vitamin brand. ` +
    `Topic: ${topic}. ` +
    `Style: ${styleGuides[style] || styleGuides["social-post"]}. ` +
    `The image should be vibrant, professional, and suitable for social media posting. ` +
    `Do NOT include any text or words in the image itself.`;

  return generateImage(fullPrompt);
}
