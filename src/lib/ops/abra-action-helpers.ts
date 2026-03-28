const MAX_TITLE_LENGTH = 200;

function sanitizeTitle(value: string): string {
  return value.slice(0, MAX_TITLE_LENGTH).trim();
}

function humanizeTaskTitle(value: string): string {
  const normalized = sanitizeTitle(
    value
      .replace(/^please\s+/i, "")
      .replace(/^(?:create|add|make|log)\s+(?:a\s+)?(?:task|todo|to-do|reminder|action item)\s+(?:to|for|about)\s+/i, "")
      .replace(/^(?:remind me|remind ben|remind rene)\s+to\s+/i, "")
      .replace(/^(?:task|todo|reminder)\s*[:-]\s*/i, "")
      .replace(/\s+/g, " "),
  );
  if (!normalized) return "";

  const lower = normalized.toLowerCase();
  const compact =
    lower.startsWith("follow up with ")
      ? `Follow up with ${normalized.slice("follow up with ".length).trim()}`
      : lower.startsWith("send ")
        ? `Send ${normalized.slice("send ".length).trim()}`
        : lower.startsWith("review ")
          ? `Review ${normalized.slice("review ".length).trim()}`
          : lower.startsWith("update ")
            ? `Update ${normalized.slice("update ".length).trim()}`
            : normalized.charAt(0).toUpperCase() + normalized.slice(1);

  return sanitizeTitle(compact.replace(/[.!?]+$/g, ""));
}

export function deriveTaskTitle(params: Record<string, unknown>): string {
  const explicitTitle = humanizeTaskTitle(String(params.title || ""));
  if (explicitTitle) return explicitTitle;

  const descriptionTitle = humanizeTaskTitle(String(params.description || ""));
  if (descriptionTitle) return descriptionTitle;

  const sourceTextTitle = humanizeTaskTitle(
    String(
      params.source_message ||
        params.instruction ||
        params.text ||
        params.body ||
        "",
    ),
  );
  if (sourceTextTitle) return sourceTextTitle;

  return "Follow up";
}

export function extractNotionPageId(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const stripped = raw
    .replace(/^[<(["'`]+/, "")
    .replace(/[>)\]"'`.,;:!?]+$/, "");

  const direct = stripped.replace(/-/g, "");
  if (/^[0-9a-f]{32}$/i.test(direct)) {
    return direct.toLowerCase();
  }

  const urlMatch = stripped.match(/([0-9a-f]{32})(?:[/?#]|$)/i);
  if (urlMatch?.[1]) {
    return urlMatch[1].toLowerCase();
  }

  const hyphenatedMatch = stripped.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (hyphenatedMatch?.[1]) {
    return hyphenatedMatch[1].replace(/-/g, "").toLowerCase();
  }

  return null;
}
