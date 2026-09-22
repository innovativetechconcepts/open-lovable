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

  async readFileBytes(path: string) {
    const value = this.files.get(path);
    if (!value) throw new Error(`missing ${path}`);
    return new Uint8Array(value);
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

test("builds in the sandbox and emits a bounded, provenance-stamped bundle", async () => {
  const provider = new FakeProvider();
  const bundle = await buildPublishBundle({
    provider: provider as never,
    target,
    identity,
  });
  assert.equal(bundle.version, AIDAOS_ADAPTER_VERSION);
  assert.equal(bundle.upstream.commit, AIDAOS_UPSTREAM_COMMIT);
  assert.equal(bundle.identity.releaseId, "release-test");
  assert.match(
    provider.commands[0],
    /^node node_modules\/vite\/bin\/vite\.js build \.aidaos-build /,
  );
  assert.deepEqual(
    bundle.artifact.files.map((file) => file.path),
    ["/assets/app.css", "/assets/app.js", "/index.html"],
  );
  assert.ok(
    bundle.artifact.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)),
  );
  assert.match(bundle.sourceDigest, /^[a-f0-9]{64}$/);
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
