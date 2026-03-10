const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return key;
}

function normalizeEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid embedding payload");
  }
  return value.map((item) => Number(item));
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  if (!embedding) throw new Error("Missing embedding output");
  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const cleaned = texts
    .map((text) => (typeof text === "string" ? text.trim() : ""))
    .filter(Boolean);
  if (cleaned.length === 0) return [];

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: cleaned.map((text) => text.slice(0, 8000)),
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${errText.slice(0, 220)}`);
  }

  const payload = await res.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  if (!data.length) {
    throw new Error("Embedding API returned no vectors");
  }

  return data
    .sort(
      (a: { index?: number }, b: { index?: number }) =>
        Number(a?.index ?? 0) - Number(b?.index ?? 0),
    )
    .map((row: { embedding?: unknown }) => normalizeEmbedding(row.embedding));
}
