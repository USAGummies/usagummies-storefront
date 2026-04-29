/**
 * Pure helpers for the HubSpot B2B pipeline slice in Sales Command.
 *
 * No I/O. The HubSpot reader supplies already-fetched rows; this module
 * only computes counts, previews, and brief copy. Counts are never
 * invented: malformed numbers are dropped to 0 only for the specific
 * stage row that came from HubSpot.
 */

export type SalesPipelineStageCount = {
  id: string;
  name: string;
  count: number;
};

export type SalesPipelineDealPreview = {
  id: string;
  dealname: string | null;
  lastModifiedAt: string | null;
};

export type SalesPipelineTaskPreview = {
  id: string;
  subject: string | null;
  priority: string | null;
  dueAt: string | null;
};

export type SalesPipelineSummary = {
  stages: SalesPipelineStageCount[];
  openDealCount: number;
  staleSampleShipped: {
    total: number;
    preview: SalesPipelineDealPreview[];
  };
  openCallTasks: {
    total: number;
    preview: SalesPipelineTaskPreview[];
  };
};

const CLOSED_STAGE_NAMES = new Set(["Closed Won", "Closed Lost"]);

export function buildSalesPipelineSummary(input: {
  stages: ReadonlyArray<SalesPipelineStageCount>;
  staleSampleShipped: ReadonlyArray<SalesPipelineDealPreview>;
  openCallTasks: ReadonlyArray<SalesPipelineTaskPreview>;
  previewLimit?: number;
}): SalesPipelineSummary {
  const previewLimit = Math.max(0, input.previewLimit ?? 5);
  const stages = input.stages.map((s) => ({
    id: s.id,
    name: s.name,
    count: Number.isFinite(s.count) && s.count > 0 ? Math.floor(s.count) : 0,
  }));
  const openDealCount = stages
    .filter((s) => !CLOSED_STAGE_NAMES.has(s.name))
    .reduce((sum, s) => sum + s.count, 0);

  return {
    stages,
    openDealCount,
    staleSampleShipped: {
      total: input.staleSampleShipped.length,
      preview: input.staleSampleShipped.slice(0, previewLimit).map((d) => ({ ...d })),
    },
    openCallTasks: {
      total: input.openCallTasks.length,
      preview: input.openCallTasks.slice(0, previewLimit).map((t) => ({ ...t })),
    },
  };
}

export function renderSalesPipelineBriefLine(
  summary: SalesPipelineSummary,
): string {
  const stale = summary.staleSampleShipped.total;
  const calls = summary.openCallTasks.total;
  return `B2B pipeline: ${summary.openDealCount} open deals · ${stale} stale samples · ${calls} call tasks`;
}

