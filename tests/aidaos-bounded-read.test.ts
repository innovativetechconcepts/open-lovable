import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { E2BProvider } from "../lib/sandbox/providers/e2b-provider";
import { VercelProvider } from "../lib/sandbox/providers/vercel-provider";

test("Vercel provider caps file output inside the sandbox command", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aidaos-media-read-"));
  const file = join(directory, "large.png");
  writeFileSync(file, Buffer.alloc(8 * 1024 * 1024, 1));
  const provider = new VercelProvider({});
  const commands: { cmd: string; args: string[] }[] = [];
  Object.defineProperty(provider, "sandbox", {
    value: {
      async runCommand(options: { cmd: string; args: string[] }) {
        commands.push(options);
        const stdout = execFileSync(options.cmd, options.args, {
          encoding: "utf8",
          maxBuffer: 1024,
        });
        return { exitCode: 0, stdout: async () => stdout };
      },
    },
  });
  try {
    const bytes = await provider.readFileBytes(file, 16);
    assert.equal(bytes.byteLength, 17);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].cmd, "sh");
    assert.equal(commands[0].args[3], "17");
    assert.equal(commands[0].args[4], file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("E2B provider requests only the bounded byte prefix", async () => {
  const provider = new E2BProvider({});
  let command = "";
  Object.defineProperty(provider, "sandbox", {
    value: {
      async runCode(code: string) {
        command = code;
        return { logs: { stdout: [Buffer.alloc(17, 1).toString("base64")] } };
      },
    },
  });
  const bytes = await provider.readFileBytes("public/assets/large.png", 16);
  assert.equal(bytes.byteLength, 17);
  assert.match(command, /f\.read\(17\)/);
  assert.match(command, /\/home\/user\/app\/public\/assets\/large\.png/);
});
