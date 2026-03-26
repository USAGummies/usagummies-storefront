export type FourDDecision = "do" | "delegate" | "defer" | "delete";

export function classifyNotification(notification: {
  type: string;
  content: string;
  priority: "critical" | "high" | "medium" | "low";
  target: string;
  changed: boolean;
}): FourDDecision {
  if (!notification.changed) return "delete";
  if (notification.type === "sweep_scan" && notification.priority !== "critical") return "delete";
  if (notification.type === "health_check" && /passed|ok|healthy/i.test(notification.content)) return "delete";

  if (notification.type === "qbo_categorize" && notification.priority === "low") return "do";

  if (notification.target === "rene" || notification.target === "ben") return "delegate";

  if (notification.priority === "low" || notification.priority === "medium") return "defer";

  return "do";
}
