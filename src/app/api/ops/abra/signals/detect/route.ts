import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { emitSignal } from "@/lib/ops/abra-operational-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runDetection(emit: boolean) {
  const anomalies = await detectAnomalies();
  let emitted = 0;

  if (emit) {
    for (const anomaly of anomalies) {
      const signalId = await emitSignal({
        signal_type: "metric_anomaly",
        source: "anomaly_detection",
        title: anomaly.context,
        detail: `${anomaly.metric}: ${anomaly.current_value} (expected ~${anomaly.expected_value.toFixed(2)}, z=${anomaly.z_score.toFixed(2)})`,
        severity: anomaly.severity,
        department: anomaly.department,
        metadata: anomaly,
      });
      if (signalId) emitted += 1;
    }
  }

  return {
    ok: true,
    anomalies,
    count: anomalies.length,
    emitted,
    generated_at: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDetection(false);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to detect anomalies" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDetection(true);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to emit anomaly signals" },
      { status: 500 },
    );
  }
}
