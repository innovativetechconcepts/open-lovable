import assert from "node:assert/strict";
import test from "node:test";
import {
  AidaosAdapterError,
  AIDAOS_ADAPTER_VERSION,
  AIDAOS_UPSTREAM_COMMIT,
  buildPublishBundle,
  collectSourceEnvelope,
  createPublishIdentity,
  type PublishIdentity,
  type PublishTarget,
} from "../lib/aidaos/publishing-adapter";

const target: PublishTarget = {
  agencyId: "PilotAgencyA",
  subAccountId: "PilotTenantA",
  projectId: "open-lovable-pilot",
  siteId: "open-lovable-site",
  publicId: "open-lovable-pilot",
  title: "Generated with aidaOS",
  description: "An isolated generated page.",
};

const identity: PublishIdentity = {
  agencyId: target.agencyId,
  subAccountId: target.subAccountId,
  projectId: target.projectId,
  siteId: target.siteId,
  publicId: target.publicId,
  releaseId: "release-test",
  artifactId: "artifact-test",
  jobId: "job-test",
};

class FakeProvider {
  files = new Map<string, Uint8Array>([
    ["package-lock.json", Buffer.from('{"lockfileVersion":3}')],
    [
      "src/main.jsx",
      Buffer.from(
        "import ReactDOM from 'react-dom/client'; import App from './App.jsx'; import './index.css';",
      ),
    ],
    [
      "src/App.jsx",
      Buffer.from(
        "export default function App(){return <main><h1>Safe page</h1></main>}",
      ),
    ],
    ["src/index.css", Buffer.from("@tailwind utilities; body { margin: 0; }")],
  ]);
  commands: string[] = [];
  readLimits: { path: string; maxBytes: number }[] = [];

  async listFiles(directory?: string) {
    if (
      directory?.endsWith("/.aidaos-build/dist") ||
      directory === ".aidaos-build/dist"
    ) {
      return ["index.html", "assets/app.js", "assets/app.css"];
    }
    return [...this.files.keys()];
  }

  async readFile(path: string) {
    const value = this.files.get(path);
    if (!value) throw new Error(`missing ${path}`);
    return Buffer.from(value).toString("utf8");
  }

  async readFileBytes(path: string, maxBytes: number) {
    const value = this.files.get(path);
    if (!value) throw new Error(`missing ${path}`);
    this.readLimits.push({ path, maxBytes });
    return new Uint8Array(value.slice(0, maxBytes + 1));
  }

  async writeFile(path: string, content: string) {
    this.files.set(path, Buffer.from(content));
  }

  async runCommand(command: string) {
    this.commands.push(command);
    this.files.set(
      ".aidaos-build/dist/assets/app.js",
      Buffer.from("document.body.dataset.ready='true';"),
    );
    this.files.set(
      ".aidaos-build/dist/assets/app.css",
      Buffer.from("body{margin:0}"),
    );
    return { stdout: "built", stderr: "", exitCode: 0, success: true };
  }
}

test("normalizes the Open Lovable template into the fixed source envelope", async () => {
  const provider = new FakeProvider();
  const source = await collectSourceEnvelope(provider as never);
  assert.deepEqual(
    source.files.map((file) => file.path),
    ["src/App.tsx", "src/main.tsx", "src/styles.css"],
  );
  assert.match(source.files[0].content, /Safe page/);
  assert.match(source.files[1].content, /createRoot/);
});

test("carries bounded local media without reading editable build output", async () => {
  const provider = new FakeProvider();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  provider.files.set("public/assets/hero.png", png);
  const source = await collectSourceEnvelope(provider as never);
  assert.deepEqual(source.media, [
    { path: "public/assets/hero.png", contentBase64: png.toString("base64") },
  ]);
  assert.deepEqual(provider.readLimits, [
    { path: "public/assets/hero.png", maxBytes: 1536 * 1024 },
  ]);
  const bundle = await buildPublishBundle({
    provider: provider as never,
    target,
    identity,
  });
  assert.match(bundle.sourceDigest, /^[a-f0-9]{64}$/);
  provider.files.set("public/assets/hero.svg", Buffer.from("<svg/>"));
  await assert.rejects(
    collectSourceEnvelope(provider as never),
    (error: unknown) =>
      error instanceof AidaosAdapterError &&
      error.code === "invalid_source_media",
  );
});

test("captures an explicit bounded page-route manifest", async () => {
  const provider = new FakeProvider();
  provider.files.set("aidaos-pages.json", Buffer.from('["sales","checkout"]'));
  const source = await collectSourceEnvelope(provider as never);
  assert.deepEqual(source.pages, ["checkout", "sales"]);
  assert.deepEqual(provider.readLimits, [
    { path: "aidaos-pages.json", maxBytes: 1024 },
  ]);
  provider.files.set("aidaos-pages.json", Buffer.from('["sales","../admin"]'));
  await assert.rejects(
    collectSourceEnvelope(provider as never),
    (error: unknown) =>
      error instanceof AidaosAdapterError &&
      error.code === "invalid_source_pages",
  );
  provider.files.set(
    "aidaos-pages.json",
    Buffer.from('["sales"]' + " ".repeat(2048)),
  );
  await assert.rejects(
    collectSourceEnvelope(provider as never),
    (error: unknown) =>
      error instanceof AidaosAdapterError &&
      error.code === "invalid_source_pages",
  );
});

test("limits each media read to the remaining aggregate allowance", async () => {
  const provider = new FakeProvider();
  provider.files.set("public/assets/large.png", Buffer.alloc(8 * 1024 * 1024));
  await assert.rejects(
    collectSourceEnvelope(provider as never),
    (error: unknown) =>
      error instanceof AidaosAdapterError &&
      error.code === "source_media_too_large",
  );
  assert.deepEqual(provider.readLimits, [
    { path: "public/assets/large.png", maxBytes: 1536 * 1024 },
  ]);

  const second = new FakeProvider();
  second.files.set("public/assets/first.png", Buffer.alloc(1024 * 1024));
  second.files.set("public/assets/second.png", Buffer.alloc(1024 * 1024));
  await assert.rejects(
    collectSourceEnvelope(second as never),
    (error: unknown) =>
      error instanceof AidaosAdapterError &&
      error.code === "source_media_too_large",
  );
  assert.deepEqual(second.readLimits, [
    { path: "public/assets/first.png", maxBytes: 1536 * 1024 },
    { path: "public/assets/second.png", maxBytes: 512 * 1024 },
  ]);
});

test("captures source only, ignoring an editable toolchain and forged output", async () => {
  const provider = new FakeProvider();
  provider.files.set(
    "node_modules/vite/bin/vite.js",
    Buffer.from("malicious compiler"),
  );
  const bundle = await buildPublishBundle({
    provider: provider as never,
    target,
    identity,
  });
  assert.equal(bundle.version, AIDAOS_ADAPTER_VERSION);
  assert.equal(bundle.upstream.commit, AIDAOS_UPSTREAM_COMMIT);
  assert.equal(bundle.identity.releaseId, "release-test");
  assert.equal(provider.commands.length, 0);
  assert.equal("artifact" in bundle, false);
  assert.equal("templateDigest" in bundle, false);
  assert.equal("lockfileDigest" in bundle, false);
  assert.match(bundle.sourceDigest, /^[a-f0-9]{64}$/);
});

test("nested JSX retains its dot and canonical path order is ASCII", async () => {
  const provider = new FakeProvider();
  provider.files.set(
    "src/components/Card.jsx",
    Buffer.from("export default function Card(){return null}"),
  );
  provider.files.set(
    "src/ZCard.tsx",
    Buffer.from("export default function ZCard(){return null}"),
  );
  const source = await collectSourceEnvelope(provider as never);
  assert.deepEqual(
    source.files.map((f) => f.path),
    [
      "src/App.tsx",
      "src/ZCard.tsx",
      "src/components/Card.tsx",
      "src/main.tsx",
      "src/styles.css",
    ],
  );
});

test("creates opaque release identities without copying page metadata", () => {
  const created = createPublishIdentity(target);
  assert.deepEqual(Object.keys(created).sort(), [
    "agencyId",
    "artifactId",
    "jobId",
    "projectId",
    "publicId",
    "releaseId",
    "siteId",
    "subAccountId",
  ]);
  assert.match(created.releaseId, /^release-[a-f0-9]{32}$/);
});

test("refuses duplicate normalized paths before executing a build", async () => {
  const provider = new FakeProvider();
  provider.files.set(
    "src/App.tsx",
    Buffer.from("export default function App(){return null}"),
  );
  await assert.rejects(
    collectSourceEnvelope(provider as never),
    (error: unknown) =>
      error instanceof AidaosAdapterError &&
      error.code === "duplicate_source_path",
  );
  assert.equal(provider.commands.length, 0);
});
