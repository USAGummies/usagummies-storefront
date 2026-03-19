import { sendMorningBrief } from "@/lib/ops/abra-morning-brief";

export type MorningBriefSweepResult = {
  sent: boolean;
  sentAt: string;
};

export async function runMorningBrief(): Promise<MorningBriefSweepResult> {
  await sendMorningBrief();
  return {
    sent: true,
    sentAt: new Date().toISOString(),
  };
}
