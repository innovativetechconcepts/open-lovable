import { createHash, randomUUID } from "node:crypto";
import type { SandboxProvider } from "@/lib/sandbox/types";

export const AIDAOS_ADAPTER_VERSION = "aidaos-open-lovable-adapter-v2";
export const AIDAOS_POLICY_VERSION = "aida-generated-page-pilot-v1";
export const AIDAOS_UPSTREAM_COMMIT =
  "69bd93bae7a9c97ef989eb70aabe6797fb3dac89";

const MAX_SOURCE_FILES = 100;
const MAX_SOURCE_FILE_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const INTERNAL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SOURCE_PATH =
  /^src\/[A-Za-z0-9][A-Za-z0-9._/-]{0,178}\.(?:tsx|ts|css|json)$/;
const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css", ".json"];
export class AidaosAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AidaosAdapterError";
  }
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface SourceEnvelope {
  files: SourceFile[];
}

export interface PublishIdentity {
  agencyId: string;
  subAccountId: string;
  projectId: string;
  siteId: string;
  publicId: string;
  releaseId: string;
  artifactId: string;
  jobId: string;
}

export interface PublishBundle {
  version: typeof AIDAOS_ADAPTER_VERSION;
  upstream: {
    repository: "firecrawl/open-lovable";
    commit: typeof AIDAOS_UPSTREAM_COMMIT;
  };
  policyVersion: typeof AIDAOS_POLICY_VERSION;
  identity: PublishIdentity;
  source: SourceEnvelope;
  sourceDigest: string;
}

export interface PublishTarget {
  agencyId: string;
  subAccountId: string;
  projectId: string;
  siteId: string;
  publicId: string;
  title: string;
  description: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedSourcePath(path: string): string {
  const clean = path.replace(/^\.\//, "");
  if (clean === "src/main.jsx" || clean === "src/main.js")
    return "src/main.tsx";
  if (clean === "src/App.jsx" || clean === "src/App.js") return "src/App.tsx";
  if (clean === "src/index.css") return "src/styles.css";
  if (clean.endsWith(".jsx")) return `${clean.slice(0, -4)}.tsx`;
  if (clean.endsWith(".js")) return `${clean.slice(0, -2)}ts`;
  return clean;
}

function normalizeImportExtensions(content: string): string {
  return content
    .replace(/(["'][^"']+)\.jsx(["'])/g, "$1$2")
    .replace(/(["'][^"']+)\.js(["'])/g, "$1$2")
    .replace(/(["'][^"']+)\/index\.css(["'])/g, "$1/styles.css$2")
    .replace(/(["'])\.\/index\.css\1/g, '"./styles.css"');
}

function validateSource(files: SourceFile[]): SourceEnvelope {
  if (files.length === 0 || files.length > MAX_SOURCE_FILES) {
    throw new AidaosAdapterError(
      "invalid_source_files",
      "The generated project has an invalid source file count.",
    );
  }
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    if (
      !SOURCE_PATH.test(file.path) ||
      file.path.includes("\\") ||
      file.path.includes("%") ||
      file.path
        .split("/")
        .some((segment) => segment === "." || segment === "..")
    ) {
      throw new AidaosAdapterError(
        "invalid_source_path",
        `The generated project cannot publish source path ${file.path}.`,
      );
    }
    const folded = file.path.toLowerCase();
    if (seen.has(folded)) {
      throw new AidaosAdapterError(
        "duplicate_source_path",
        `The generated project has a duplicate source path ${file.path}.`,
      );
    }
    seen.add(folded);
    const size = Buffer.byteLength(file.content);
    if (size > MAX_SOURCE_FILE_BYTES) {
      throw new AidaosAdapterError(
        "source_file_too_large",
        `The generated source file ${file.path} is too large.`,
        413,
      );
    }
    total += size;
  }
  if (total > MAX_SOURCE_BYTES) {
    throw new AidaosAdapterError(
      "source_too_large",
      "The generated project source is too large.",
      413,
    );
  }
  for (const required of ["src/main.tsx", "src/App.tsx", "src/styles.css"]) {
    if (!seen.has(required.toLowerCase())) {
      throw new AidaosAdapterError(
        "missing_source_entry",
        `The generated project is missing ${required}.`,
      );
    }
  }
  return {
    files: [...files].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
  };
}

function fixedMainSource(): string {
  return `import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n`;
}

export async function collectSourceEnvelope(
  provider: Pick<SandboxProvider, "listFiles" | "readFile">,
): Promise<SourceEnvelope> {
  const listed = await provider.listFiles();
  const candidates = listed
    .map((path) => path.replace(/^\.\//, ""))
    .filter(
      (path) =>
        path.startsWith("src/") &&
        SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)),
    );
  const files: SourceFile[] = [];
  for (const path of candidates) {
    const normalizedPath = normalizedSourcePath(path);
    if (normalizedPath === "src/main.tsx") continue;
    files.push({
      path: normalizedPath,
      content: normalizeImportExtensions(await provider.readFile(path)),
    });
  }
  files.push({ path: "src/main.tsx", content: fixedMainSource() });
  return validateSource(files);
}

function requireIdentity(identity: PublishIdentity): void {
  for (const [name, value] of Object.entries(identity)) {
    if (!INTERNAL_ID.test(value)) {
      throw new AidaosAdapterError(
        "invalid_publish_identity",
        `The configured ${name} is invalid.`,
        500,
      );
    }
  }
}

export function createPublishIdentity(
  target: Omit<PublishTarget, "title" | "description">,
): PublishIdentity {
  const suffix = randomUUID().replaceAll("-", "");
  const identity = {
    agencyId: target.agencyId,
    subAccountId: target.subAccountId,
    projectId: target.projectId,
    siteId: target.siteId,
    publicId: target.publicId,
    releaseId: `release-${suffix}`,
    artifactId: `artifact-${suffix}`,
    jobId: `job-${suffix}`,
  };
  requireIdentity(identity);
  return identity;
}

/** Capture only source. The publisher owns validation, toolchain and compilation. */
export async function buildPublishBundle(input: {
  provider: Pick<SandboxProvider, "listFiles" | "readFile">;
  target: PublishTarget;
  identity?: PublishIdentity;
}): Promise<PublishBundle> {
  const identity = input.identity ?? createPublishIdentity(input.target);
  requireIdentity(identity);
  const source = await collectSourceEnvelope(input.provider);
  return {
    version: AIDAOS_ADAPTER_VERSION,
    upstream: {
      repository: "firecrawl/open-lovable",
      commit: AIDAOS_UPSTREAM_COMMIT,
    },
    policyVersion: AIDAOS_POLICY_VERSION,
    identity,
    source,
    sourceDigest: sha256(canonicalJson(source)),
  };
}
