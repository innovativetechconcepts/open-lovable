import { createHash, randomUUID } from "node:crypto";
import type { SandboxProvider } from "@/lib/sandbox/types";

export const AIDAOS_ADAPTER_VERSION = "aidaos-open-lovable-adapter-v1";
export const AIDAOS_POLICY_VERSION = "aida-generated-page-pilot-v1";
export const AIDAOS_UPSTREAM_COMMIT =
  "69bd93bae7a9c97ef989eb70aabe6797fb3dac89";

const MAX_SOURCE_FILES = 100;
const MAX_SOURCE_FILE_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 200;
const MAX_ARTIFACT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const INTERNAL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SOURCE_PATH =
  /^src\/[A-Za-z0-9][A-Za-z0-9._/-]{0,178}\.(?:tsx|ts|css|json)$/;
const ARTIFACT_PATH =
  /^\/assets\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,118}[A-Za-z0-9])?\.(?:js|css|png|jpg|webp|woff2)$/;

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css", ".json"];
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

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

export interface ArtifactFile {
  path: string;
  contentType: string;
  base64: string;
  byteLength: number;
  sha256: string;
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
  templateDigest: string;
  lockfileDigest: string;
  artifact: { files: ArtifactFile[]; byteLength: number };
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
  if (clean === "src/main.jsx" || clean === "src/main.js") return "src/main.tsx";
  if (clean === "src/App.jsx" || clean === "src/App.js") return "src/App.tsx";
  if (clean === "src/index.css") return "src/styles.css";
  if (clean.endsWith(".jsx")) return `${clean.slice(0, -4)}tsx`;
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
      file.path.split("/").some((segment) => segment === "." || segment === "..")
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
  return { files: [...files].sort((left, right) => left.path.localeCompare(right.path)) };
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

function escapeHtmlText(value: string, maxLength: number): string {
  const clean = value.trim().slice(0, maxLength);
  if (!clean) throw new AidaosAdapterError("invalid_page_metadata", "Page metadata is required.");
  return clean
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function trustedHtml(releaseId: string, title: string, description: string): string {
  const root = `/_a/${releaseId}/assets`;
  return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1">\n    <meta name="description" content="${escapeHtmlText(description, 200)}">\n    <title>${escapeHtmlText(title, 120)}</title>\n    <link rel="stylesheet" href="${root}/app.css">\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="${root}/app.js"></script>\n  </body>\n</html>\n`;
}

function viteConfig(): string {
  return `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nimport tailwindcss from "tailwindcss";\nimport autoprefixer from "autoprefixer";\n\nexport default defineConfig({\n  plugins: [react()],\n  css: {\n    postcss: {\n      plugins: [tailwindcss({ content: ["./.aidaos-build/src/**/*.{ts,tsx}"] }), autoprefixer()],\n    },\n  },\n  build: {\n    sourcemap: false,\n    cssCodeSplit: false,\n    rollupOptions: {\n      output: {\n        entryFileNames: "assets/app.js",\n        chunkFileNames: "assets/chunk-[hash].js",\n        assetFileNames: (asset) => asset.name?.endsWith(".css") ? "assets/app.css" : "assets/[name]-[hash][extname]",\n      },\n    },\n  },\n});\n`;
}

function buildIndex(): string {
  return `<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8" /></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n`;
}

function mimeFor(path: string): string {
  const extension = path.slice(path.lastIndexOf("."));
  const mime = MIME_TYPES.get(extension);
  if (!mime) {
    throw new AidaosAdapterError(
      "unsupported_artifact_type",
      `The generated artifact type ${extension || "unknown"} is not supported.`,
    );
  }
  return mime;
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

export function createPublishIdentity(target: Omit<PublishTarget, "title" | "description">): PublishIdentity {
  const suffix = randomUUID().replaceAll("-", "");
  const identity = {
    agencyId: target.agencyId,
    subAccountId: target.subAccountId,
    projectId: target.projectId,
    siteId: target.siteId,
    publicId: target.publicId,
    releaseId: `release_${suffix}`,
    artifactId: `artifact_${suffix}`,
    jobId: `job_${suffix}`,
  };
  requireIdentity(identity);
  return identity;
}

export async function buildPublishBundle(input: {
  provider: Pick<SandboxProvider, "listFiles" | "readFile" | "readFileBytes" | "runCommand" | "writeFile">;
  target: PublishTarget;
  identity?: PublishIdentity;
}): Promise<PublishBundle> {
  const identity = input.identity ?? createPublishIdentity(input.target);
  requireIdentity(identity);
  const source = await collectSourceEnvelope(input.provider);
  const sourceDigest = sha256(canonicalJson(source));
  const buildRoot = ".aidaos-build";
  for (const file of source.files) {
    await input.provider.writeFile(`${buildRoot}/${file.path}`, file.content);
  }
  await input.provider.writeFile(`${buildRoot}/index.html`, buildIndex());
  await input.provider.writeFile(`${buildRoot}/vite.config.ts`, viteConfig());
  const command = [
    "npm",
    "exec",
    "--",
    "vite",
    "build",
    buildRoot,
    "--config",
    `${buildRoot}/vite.config.ts`,
    "--base",
    `/_a/${identity.releaseId}/`,
    "--outDir",
    "dist",
    "--emptyOutDir",
  ].join(" ");
  const built = await input.provider.runCommand(command);
  if (!built.success) {
    throw new AidaosAdapterError(
      "sandbox_build_failed",
      built.stderr.trim() || "The isolated page build failed.",
      422,
    );
  }
  await input.provider.writeFile(
    `${buildRoot}/dist/index.html`,
    trustedHtml(identity.releaseId, input.target.title, input.target.description),
  );
  const listed = await input.provider.listFiles(`${buildRoot}/dist`);
  if (listed.length === 0 || listed.length > MAX_ARTIFACT_FILES) {
    throw new AidaosAdapterError(
      "invalid_artifact_files",
      "The isolated build produced an invalid file count.",
      422,
    );
  }
  let total = 0;
  const files: ArtifactFile[] = [];
  for (const listedPath of listed) {
    const relative = listedPath
      .replace(/^\.\//, "")
      .replace(new RegExp(`^${buildRoot}/dist/`), "");
    const path = `/${relative}`;
    if (path !== "/index.html" && !ARTIFACT_PATH.test(path)) {
      throw new AidaosAdapterError(
        "invalid_artifact_path",
        `The isolated build produced unsupported path ${path}.`,
        422,
      );
    }
    const bytes = await input.provider.readFileBytes(`${buildRoot}/dist/${relative}`);
    if (bytes.byteLength > MAX_ARTIFACT_FILE_BYTES) {
      throw new AidaosAdapterError(
        "artifact_file_too_large",
        `The isolated build output ${path} is too large.`,
        413,
      );
    }
    total += bytes.byteLength;
    if (total > MAX_ARTIFACT_BYTES) {
      throw new AidaosAdapterError(
        "artifact_too_large",
        "The isolated build is too large for the pilot publisher.",
        413,
      );
    }
    files.push({
      path,
      contentType: mimeFor(path),
      base64: Buffer.from(bytes).toString("base64"),
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    version: AIDAOS_ADAPTER_VERSION,
    upstream: {
      repository: "firecrawl/open-lovable",
      commit: AIDAOS_UPSTREAM_COMMIT,
    },
    policyVersion: AIDAOS_POLICY_VERSION,
    identity,
    source,
    sourceDigest,
    templateDigest: sha256(viteConfig() + buildIndex() + AIDAOS_ADAPTER_VERSION),
    lockfileDigest: sha256("open-lovable-fixed-vite-template-v1"),
    artifact: { files, byteLength: total },
  };
}
