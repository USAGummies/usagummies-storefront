import "server-only";

const GITHUB_API = "https://api.github.com";

function githubToken(): string {
  return process.env.GITHUB_PAT || "";
}

function githubRepoOwner(): string {
  return process.env.GITHUB_REPO_OWNER || "USAGummies";
}

function githubRepoName(): string {
  return process.env.GITHUB_REPO_NAME || "usagummies-storefront";
}

export function isGithubPublishConfigured(): boolean {
  return !!githubToken();
}

type GithubContentResponse = {
  sha?: string;
  content?: string;
};

async function githubRequest<T>(
  method: "GET" | "PUT",
  pathname: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = githubToken();
  if (!token) throw new Error("GITHUB_PAT not configured");

  const res = await fetch(`${GITHUB_API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (res.status === 404 && method === "GET") {
    return {} as T;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${method} ${pathname} failed (${res.status}): ${text.slice(0, 260)}`);
  }

  return (await res.json()) as T;
}

async function getFileSha(path: string, branch = "main"): Promise<string | undefined> {
  const owner = githubRepoOwner();
  const repo = githubRepoName();
  const safePath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const payload = await githubRequest<GithubContentResponse>(
    "GET",
    `/repos/${owner}/${repo}/contents/${safePath}?ref=${encodeURIComponent(branch)}`,
  );
  return payload.sha;
}

export async function publishFileToGithub(params: {
  path: string;
  content: string;
  message: string;
  branch?: string;
  committerName?: string;
  committerEmail?: string;
}): Promise<{ commitSha: string; path: string; branch: string }> {
  const owner = githubRepoOwner();
  const repo = githubRepoName();
  const branch = params.branch || "main";
  const safePath = params.path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const existingSha = await getFileSha(params.path, branch);

  const body: Record<string, unknown> = {
    message: params.message,
    content: Buffer.from(params.content, "utf8").toString("base64"),
    branch,
  };

  if (existingSha) body.sha = existingSha;

  if (params.committerName && params.committerEmail) {
    body.committer = {
      name: params.committerName,
      email: params.committerEmail,
    };
  }

  const result = await githubRequest<{
    content?: { path?: string };
    commit?: { sha?: string };
  }>("PUT", `/repos/${owner}/${repo}/contents/${safePath}`, body);

  const commitSha = result.commit?.sha || "";
  if (!commitSha) {
    throw new Error("GitHub publish succeeded but commit sha missing");
  }

  return {
    commitSha,
    path: result.content?.path || params.path,
    branch,
  };
}
