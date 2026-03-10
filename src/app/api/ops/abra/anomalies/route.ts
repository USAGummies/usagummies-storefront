import { NextResponse } from "next/server";
import { isAuthorized, isCronAuthorized } from "@/lib/ops/abra-auth";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { emitSignal } from "@/lib/ops/abra-operational-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const anomalies = await detectAnomalies();
    return NextResponse.json({
      anomalies,
      count: anomalies.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to detect anomalies" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const anomalies = await detectAnomalies();
    for (const anomaly of anomalies) {
      void emitSignal({
        signal_type: "metric_anomaly",
        source: "anomaly_detection",
        title: anomaly.context,
        detail: `${anomaly.metric}: ${anomaly.current_value} (expected ~${anomaly.expected_value.toFixed(2)}, z=${anomaly.z_score.toFixed(2)})`,
        severity: anomaly.severity,
        department: anomaly.department,
        metadata: anomaly,
      });
    }

    return NextResponse.json({
      ok: true,
      emitted: anomalies.length,
      anomalies,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to emit anomaly signals" },
      { status: 500 },
    );
  }
}
