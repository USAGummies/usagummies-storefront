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
  name: "search" | "fetch";
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

export function handleWorkspaceMcpRequest(body: JsonRpcRequest): JsonRpcResponse {
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
    return {
      jsonrpc: "2.0",
      id: call.id,
      result: asMcpText(doc),
    };
  }

  return {
    jsonrpc: "2.0",
    id: call.id,
    error: {
      code: -32602,
      message: "Unsupported tool. Only search and fetch are exposed.",
      data: { name: call.name ?? null },
    },
  };
}
