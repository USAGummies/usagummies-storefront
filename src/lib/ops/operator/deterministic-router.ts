export type RoutedMessage =
  | { intent: "meeting_lookup"; action: "query_meeting_context" }
  | { intent: "meeting_correction"; action: "acknowledge_meeting_correction" }
  | { intent: "unknown"; action: "route_to_manual_review" };

export function routeMessage(
  message: string,
  _actor: string,
  _context?: { history?: Array<{ role: string; content: string }> },
): RoutedMessage {
  const text = message.toLowerCase();
  const mentionsMeeting = /\b(meeting|call|scheduled|schedule)\b/.test(text);
  if (mentionsMeeting && /\b(was|wrong|how is|isn't|is not|correct)\b/.test(text)) {
    return { intent: "meeting_correction", action: "acknowledge_meeting_correction" };
  }
  if (mentionsMeeting) {
    return { intent: "meeting_lookup", action: "query_meeting_context" };
  }
  return { intent: "unknown", action: "route_to_manual_review" };
}
