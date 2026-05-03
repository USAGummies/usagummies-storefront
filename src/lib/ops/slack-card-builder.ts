/**
 * Slack Block Kit primitives — shared across every "X today" /
 * dashboard / status card.
 *
 * Build 9 per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4.
 *
 * Each helper returns a single Block Kit block. Cards compose them
 * top-down; consumers never hand-assemble Block Kit raw shapes,
 * which prevents the subtle drift between cards (one uses
 * `type: "context"`, another forgets `emoji: true` in the header,
 * etc.).
 *
 * The doctrine pinned by this module:
 *   - Every card opens with a header w/ posture chip.
 *   - Stats are rendered as a 6-field section (or as many fields as
 *     the section accepts).
 *   - The brief block is the "what this means" sentence — at most
 *     1-2 lines.
 *   - The context block is the only place generated-time + degraded
 *     info appears.
 *   - The actions block links out to dashboard URLs (read-only) — it
 *     never includes destructive buttons.
 *
 * Pure helpers — no I/O, no env reads, no string injection.
 */

// ---------------------------------------------------------------------------
// Posture
// ---------------------------------------------------------------------------

export type Posture = "green" | "yellow" | "red" | "unknown";

const POSTURE_LABELS: Record<Posture, string> = {
  green: "🟢 clean",
  yellow: "🟡 work waiting",
  red: "🔴 attention",
  unknown: "⚪️ partial",
};

const POSTURE_ICONS: Record<Posture, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
  unknown: "⚪️",
};

export function postureLabel(p: Posture): string {
  return POSTURE_LABELS[p];
}

export function postureIcon(p: Posture): string {
  return POSTURE_ICONS[p];
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

export function headerBlock(args: {
  /** Card title without posture chip — "Email queue" / "Finance today". */
  title: string;
  emoji?: string;
  /** Posture chip appended to the title — omit for static-info cards. */
  posture?: Posture;
}): unknown {
  const text = args.posture
    ? `${args.emoji ? args.emoji + " " : ""}${args.title} — ${postureLabel(args.posture)}`
    : `${args.emoji ? args.emoji + " " : ""}${args.title}`;
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}

export interface StatField {
  /** Label (rendered bold). */
  label: string;
  /** Value text (renders below the label). */
  value: string | number;
}

/**
 * 6-field stats block. Pass up to 10 fields; Slack renders them in
 * a 2-column grid. Use the field shape `*Label*\nValue`.
 */
export function statsBlock(fields: ReadonlyArray<StatField>): unknown {
  return {
    type: "section",
    fields: fields.map((f) => ({
      type: "mrkdwn",
      text: `*${f.label}*\n${f.value}`,
    })),
  };
}

/** Free-form mrkdwn section. The "what this means" sentence. */
export function briefBlock(text: string): unknown {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
}

/** Section with a header line + a list of bullet rows. */
export function listSectionBlock(args: {
  title: string;
  /** Each row is a single mrkdwn line. The builder prefixes "• ". */
  rows: ReadonlyArray<string>;
}): unknown {
  const body = args.rows.map((r) => `• ${r}`).join("\n");
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${args.title}*\n${body}`,
    },
  };
}

export function dividerBlock(): unknown {
  return { type: "divider" };
}

/**
 * Context block — generation time + degraded-source warnings.
 * Always cite the read-only-ness of the card so operators never
 * mistake a status post for a destructive action card.
 */
export function contextBlock(args: {
  generatedAt: string;
  /** One-line read-only assertion. Required. */
  readOnlyNote: string;
  /** Optional degraded-source list. */
  degraded?: ReadonlyArray<string>;
}): unknown {
  const lines: string[] = [
    `Generated ${formatShortTime(args.generatedAt)} · ${args.readOnlyNote}`,
  ];
  if (args.degraded && args.degraded.length > 0) {
    lines.push(`:warning: Degraded: ${args.degraded.join(" · ")}`);
  }
  return {
    type: "context",
    elements: lines.map((t) => ({ type: "mrkdwn", text: t })),
  };
}

export interface ActionLink {
  text: string;
  url: string;
  actionId: string;
}

/**
 * Actions block — link buttons only. The doctrine forbids destructive
 * action buttons (approve / reject / send) in status cards; those
 * live on dedicated approval cards.
 */
export function actionsBlock(links: ReadonlyArray<ActionLink>): unknown {
  return {
    type: "actions",
    elements: links.map((l) => ({
      type: "button",
      text: { type: "plain_text", text: l.text, emoji: true },
      url: l.url,
      action_id: l.actionId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Truncation helpers
// ---------------------------------------------------------------------------

const DEFAULT_TRUNCATE = 80;

/**
 * Truncate a free-form string to a max length (default 80 chars) +
 * append a single-char ellipsis. Used for sender / subject /
 * deal-title columns inside list sections.
 */
export function truncate(s: string, max: number = DEFAULT_TRUNCATE): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Format an ISO timestamp to "HH:MMZ" — concise for context blocks. */
export function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(11, 16) + "Z";
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Card composer
// ---------------------------------------------------------------------------

export interface PostureCardSpec {
  /** Title shown in the header. */
  title: string;
  /** Header emoji (e.g. "💵" / "🚚"). */
  emoji: string;
  /** Top-line text returned alongside blocks (Slack's `text` fallback). */
  topLine: string;
  /** Posture chip. Defaults to "unknown" when omitted. */
  posture?: Posture;
  /** 6-field stats grid (or fewer). */
  stats: ReadonlyArray<StatField>;
  /** "What this means" sentence. */
  brief: string;
  /** Optional list sections (top rows / blockers / etc.). */
  sections?: ReadonlyArray<{
    title: string;
    rows: ReadonlyArray<string>;
  }>;
  /** Generation timestamp + degraded list for the context block. */
  generatedAt: string;
  /** One-line read-only assertion. */
  readOnlyNote: string;
  degraded?: ReadonlyArray<string>;
  /** Action links — read-only deep-links only. */
  actions: ReadonlyArray<ActionLink>;
}

export interface BuiltCard {
  text: string;
  blocks: unknown[];
}

/**
 * Compose a posture card from a typed spec. The composer enforces:
 *   - Header → stats → brief → optional list sections → context → actions
 *   - At most 4 list sections (Slack truncates very long messages)
 *   - Required read-only note in context block
 */
export function buildPostureCard(spec: PostureCardSpec): BuiltCard {
  const blocks: unknown[] = [];
  blocks.push(
    headerBlock({
      title: spec.title,
      emoji: spec.emoji,
      posture: spec.posture ?? "unknown",
    }),
  );
  blocks.push(statsBlock(spec.stats));
  blocks.push(briefBlock(spec.brief));
  if (spec.sections) {
    const cap = Math.min(4, spec.sections.length);
    for (let i = 0; i < cap; i++) {
      blocks.push(dividerBlock());
      blocks.push(listSectionBlock(spec.sections[i]));
    }
  }
  blocks.push(
    contextBlock({
      generatedAt: spec.generatedAt,
      readOnlyNote: spec.readOnlyNote,
      degraded: spec.degraded,
    }),
  );
  if (spec.actions.length > 0) {
    blocks.push(actionsBlock(spec.actions));
  }
  return { text: spec.topLine, blocks };
}
