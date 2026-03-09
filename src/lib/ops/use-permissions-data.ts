"use client";

import { useCallback, useEffect, useState } from "react";

export type PermissionApproval = {
  id: string;
  requesting_agent_id: string;
  action_type: string;
  target_entity_type: string | null;
  target_entity_id: string | null;
  summary: string;
  supporting_data: string | null;
  confidence: "high" | "medium" | "low" | null;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  permission_tier: number | null;
  status: string;
  requested_at: string;
  approval_trigger: string | null;
  action_proposed: string | null;
  confidence_level: number | null;
  risk_assessment: string | null;
  agent_name: string;
  agent_department: string | null;
};

type ApprovalsResponse = {
  approvals: PermissionApproval[];
  totalPending: number;
  generatedAt: string;
};

export function usePermissionsData() {
  const [data, setData] = useState<ApprovalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/approvals", { cache: "no-store" });
      const payload = (await res.json()) as Partial<ApprovalsResponse> & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      setData({
        approvals: payload.approvals || [],
        totalPending: payload.totalPending || 0,
        generatedAt: payload.generatedAt || new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load permission queue");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const processApproval = useCallback(
    async (input: {
      approvalId: string;
      decision: "approved" | "denied" | "modified";
      reasoning?: string;
      modificationNotes?: string;
    }) => {
      const res = await fetch("/api/ops/approvals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }

      await refresh();
      return payload;
    },
    [refresh],
  );

  return {
    data,
    loading,
    error,
    refresh,
    processApproval,
  };
}
