export async function runEmailIntelligence(_input: unknown) {
  return {
    tasks: [],
    summary: { processed: 0, actionsTaken: 0, needsAttention: 0, replyTasks: 0, qboEmailTasks: 0, details: [] },
    postedSummary: false,
  };
}

export async function readEmailIntelligenceSummary() {
  return null;
}
