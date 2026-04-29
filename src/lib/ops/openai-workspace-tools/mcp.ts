import {
  connectorSearchDocuments,
  getOpenAIWorkspaceTool,
  type OpenAIWorkspaceTool,
} from "./registry";

export interface ConnectorDocument {
  id: string;
  title: string;
  url: string;
  text: string;
}

export interface ConnectorSearchResult {
  id: string;
  title: string;
  url: string;
}

export interface ConnectorFetchResult extends ConnectorDocument {
  metadata: {
    mode: OpenAIWorkspaceTool["mode"];
    status: OpenAIWorkspaceTool["status"];
    audience: OpenAIWorkspaceTool["audience"];
    readOnly: boolean;
    requiresHumanApproval: boolean;
    approvalSlug?: string;
    backingRoute?: string;
    backingSurface?: string;
    blocker?: string;
    liveRead?: {
      ok: boolean;
      status: number;
      body: unknown;
    } | null;
  };
}

export interface McpContentResponse {
  content: Array<{ type: "text"; text: string }>;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
  name?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcError = NonNullable<JsonRpcResponse["error"]>;

export interface ApprovalToolExecutorInput {
  route: string;
  body: Record<string, unknown>;
}

export type ApprovalToolExecutor = (
  input: ApprovalToolExecutorInput,
) => Promise<{
  ok: boolean;
  status: number;
  body: unknown;
}>;

export interface WorkspaceMcpOptions {
  executeApprovalTool?: ApprovalToolExecutor;
  loadLiveReadModel?: (
    doc: ConnectorFetchResult,
  ) => Promise<{ ok: boolean; status: number; body: unknown } | null>;
}

const APPROVAL_TOOL_ROUTES = {
  request_faire_direct_invite_approval:
    "/api/ops/faire/direct-invites/{id}/request-approval",
  request_faire_follow_up_approval:
    "/api/ops/faire/direct-invites/{id}/follow-up/request-approval",
  request_receipt_review_approval: "/api/ops/docs/receipt/promote-review",
} as const;

export function searchOpenAIWorkspaceDocuments(
  query: string,
  docs: readonly ConnectorDocument[] = connectorSearchDocuments(),
): ConnectorSearchResult[] {
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = docs
    .map((doc, index) => {
      const haystack = `${doc.id}\n${doc.title}\n${doc.url}\n${doc.text}`.toLowerCase();
      const score =
        terms.length === 0
          ? 1
          : terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { doc, index, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.map(({ doc }) => ({
    id: doc.id,
    title: doc.title,
    url: doc.url,
  }));
}

export function fetchOpenAIWorkspaceDocument(
  id: string,
  docs: readonly ConnectorDocument[] = connectorSearchDocuments(),
): ConnectorFetchResult | null {
  const doc = docs.find((candidate) => candidate.id === id);
  const tool = getOpenAIWorkspaceTool(id);
  if (!doc || !tool) return null;

  return {
    ...doc,
    metadata: {
      mode: tool.mode,
      status: tool.status,
      audience: tool.audience,
      readOnly: tool.readOnly,
      requiresHumanApproval: tool.requiresHumanApproval,
      approvalSlug: tool.approvalSlug,
      backingRoute: tool.backingRoute,
      backingSurface: tool.backingSurface,
      blocker: tool.blocker,
    },
  };
}

export function asMcpText(payload: unknown): McpContentResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

export function mcpToolDefinitions(): Array<{
  name:
    | "search"
    | "fetch"
    | "request_faire_direct_invite_approval"
    | "request_faire_follow_up_approval"
    | "request_receipt_review_approval";
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return [
    {
      name: "search",
      description:
        "Search approved USA Gummies ops connector documents. Read-only; never executes actions.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "fetch",
      description:
        "Fetch one approved USA Gummies ops connector document by id. Read-only; never executes actions.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document id returned from search." },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "request_faire_direct_invite_approval",
      description:
        "Open the existing Class B Slack approval for an approved Faire Direct invite. Does not send email.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Faire invite id." },
          requestedBy: {
            type: "string",
            description: "Optional operator label for evidence.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "request_faire_follow_up_approval",
      description:
        "Open the existing Class B Slack approval for a due Faire Direct follow-up. Does not send email.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Faire invite id." },
          requestedBy: {
            type: "string",
            description: "Optional operator label for evidence.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "request_receipt_review_approval",
      description:
        "Open Rene's existing receipt.review.promote approval packet. Does not create QBO bills.",
      inputSchema: {
        type: "object",
        properties: {
          receiptId: { type: "string", description: "Receipt id." },
        },
        required: ["receiptId"],
        additionalProperties: false,
      },
    },
  ];
}

function extractToolCall(body: JsonRpcRequest): {
  id: string | number | null;
  name: string | undefined;
  args: Record<string, unknown>;
} {
  return {
    id: body.id ?? null,
    name: body.params?.name ?? body.name ?? body.tool,
    args: body.params?.arguments ?? body.arguments ?? {},
  };
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function handleApprovalRequestTool(
  name: string,
  args: Record<string, unknown>,
  execute: ApprovalToolExecutor | undefined,
): Promise<McpContentResponse | JsonRpcError> {
  if (!execute) {
    return {
      code: -32010,
      message: "Approval-request tools are not configured on this MCP surface.",
    };
  }

  if (name === "request_faire_direct_invite_approval") {
    const id = stringArg(args, "id");
    if (!id) return { code: -32602, message: "id is required" };
    const requestedBy = stringArg(args, "requestedBy");
    const route = APPROVAL_TOOL_ROUTES.request_faire_direct_invite_approval.replace(
      "{id}",
      encodeURIComponent(id),
    );
    const result = await execute({
      route,
      body: requestedBy ? { requestedBy } : {},
    });
    return asMcpText({ route, ...result });
  }

  if (name === "request_faire_follow_up_approval") {
    const id = stringArg(args, "id");
    if (!id) return { code: -32602, message: "id is required" };
    const requestedBy = stringArg(args, "requestedBy");
    const route = APPROVAL_TOOL_ROUTES.request_faire_follow_up_approval.replace(
      "{id}",
      encodeURIComponent(id),
    );
    const result = await execute({
      route,
      body: requestedBy ? { requestedBy } : {},
    });
    return asMcpText({ route, ...result });
  }

  if (name === "request_receipt_review_approval") {
    const receiptId = stringArg(args, "receiptId");
    if (!receiptId) return { code: -32602, message: "receiptId is required" };
    const route = APPROVAL_TOOL_ROUTES.request_receipt_review_approval;
    const result = await execute({
      route,
      body: { receiptId },
    });
    return asMcpText({ route, ...result });
  }

  return {
    code: -32602,
    message: "Unsupported approval-request tool.",
    data: { name },
  };
}

export async function handleWorkspaceMcpRequest(
  body: JsonRpcRequest,
  options: WorkspaceMcpOptions = {},
): Promise<JsonRpcResponse> {
  const id = body.id ?? null;

  if (body.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "usa-gummies-openai-workspace-tools",
          version: "1.0.0",
        },
      },
    };
  }

  if (body.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: mcpToolDefinitions() },
    };
  }

  if (body.method && body.method !== "tools/call") {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Unsupported MCP method: ${body.method}`,
      },
    };
  }

  const call = extractToolCall(body);

  if (call.name === "search") {
    const query = typeof call.args.query === "string" ? call.args.query : "";
    return {
      jsonrpc: "2.0",
      id: call.id,
      result: asMcpText({
        results: searchOpenAIWorkspaceDocuments(query),
      }),
    };
  }

  if (call.name === "fetch") {
    const docId = typeof call.args.id === "string" ? call.args.id : "";
    const doc = fetchOpenAIWorkspaceDocument(docId);
    if (!doc) {
      return {
        jsonrpc: "2.0",
        id: call.id,
        error: {
          code: -32004,
          message: "Document not found",
          data: { id: docId },
        },
      };
    }
    let enriched = doc;
    if (doc.metadata.mode === "read" && options.loadLiveReadModel) {
      const liveRead = await options.loadLiveReadModel(doc);
      enriched = {
        ...doc,
        text:
          liveRead === null
            ? doc.text
            : `${doc.text}\n\nLive read-model snapshot:\n${JSON.stringify(liveRead)}`,
        metadata: {
          ...doc.metadata,
          liveRead,
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: call.id,
      result: asMcpText(enriched),
    };
  }

  if (
    call.name === "request_faire_direct_invite_approval" ||
    call.name === "request_faire_follow_up_approval" ||
    call.name === "request_receipt_review_approval"
  ) {
    const resultOrError = await handleApprovalRequestTool(
      call.name,
      call.args,
      options.executeApprovalTool,
    );
    if ("code" in resultOrError && "message" in resultOrError) {
      return {
        jsonrpc: "2.0",
        id: call.id,
        error: resultOrError,
      };
    }
    return {
      jsonrpc: "2.0",
      id: call.id,
      result: resultOrError,
    };
  }

  return {
    jsonrpc: "2.0",
    id: call.id,
    error: {
      code: -32602,
      message:
        "Unsupported tool. Only search, fetch, and approval-request tools are exposed.",
      data: { name: call.name ?? null },
    },
  };
}
