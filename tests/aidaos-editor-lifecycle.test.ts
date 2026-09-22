import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as getSandboxFiles } from '../app/api/get-sandbox-files/route';
import { POST as createSandbox } from '../app/api/create-ai-sandbox-v2/route';
import { VercelProvider } from '../lib/sandbox/providers/vercel-provider';
import { encodeSession, SESSION_COOKIE } from '../lib/aidaos/pilot-context';

process.env.AIDAOS_OPERATOR_USERNAME = 'operator';
process.env.AIDAOS_OPERATOR_PASSWORD = 'synthetic-operator-secret-at-least-32-characters';
process.env.AIDAOS_SESSION_SECRET = 'synthetic-session-secret-at-least-32-characters';
process.env.AIDAOS_BUILDER_ORIGIN = 'https://builder.invalid';

const authorization = 'Basic ' + Buffer.from(
  `${process.env.AIDAOS_OPERATOR_USERNAME}:${process.env.AIDAOS_OPERATOR_PASSWORD}`,
).toString('base64');
const ownedRequest = (path: string, method: 'GET' | 'POST', oldId?: string) =>
  new NextRequest(`https://builder.invalid${path}`, {
    method,
    headers: {
      authorization,
      origin: 'https://builder.invalid',
      ...(oldId ? { cookie: `${SESSION_COOKIE}=${encodeSession({
        owner: 'operator', sandboxId: oldId, expiresAt: Date.now() + 60_000,
      })}` } : {}),
    },
  });

test('a later request recovers a complete large landing page or fails explicitly', async () => {
  const files = new Map([
    ['src/App.jsx', 'export default function App(){return <main>Elite Assist</main>}\n' + '// page section\n'.repeat(1500)],
    ['src/index.css', 'body { margin: 0 }'],
  ]);
  const originalReconnect = VercelProvider.prototype.reconnect;
  VercelProvider.prototype.reconnect = async function (id: string) {
    const sdk = {
      runCommand: async ({ cmd, args }: { cmd: string; args: string[] }) => ({
        exitCode: 0,
        stdout: async () => cmd === 'find'
          ? (args.includes('-type') && args.includes('d') ? './src' : [...files.keys()].join('\n'))
          : cmd === 'stat' ? String(Buffer.byteLength(files.get(args.at(-1)!) || ''))
          : files.get(args[0]) || '',
      }),
    };
    (this as any).sandbox = sdk;
    (this as any).sandboxInfo = {
      sandboxId: id, url: 'https://sandbox.invalid', provider: 'vercel', createdAt: new Date(),
    };
  };
  try {
    const first = await getSandboxFiles(ownedRequest('/api/get-sandbox-files', 'GET', 'sbx_owned'));
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.files['src/App.jsx'], files.get('src/App.jsx'));
    assert.ok(Buffer.byteLength(firstBody.files['src/App.jsx']) > 20_000);
    assert.equal(firstBody.fileCount, 2);

    files.set('src/App.jsx', 'x'.repeat(256 * 1024 + 1));
    const oversized = await getSandboxFiles(ownedRequest('/api/get-sandbox-files', 'GET', 'sbx_owned'));
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).success, false);
  } finally {
    VercelProvider.prototype.reconnect = originalReconnect;
  }
});

test('session replacement stops the owned VM and cleans up a failed new VM', async () => {
  const originals = {
    reconnect: VercelProvider.prototype.reconnect,
    create: VercelProvider.prototype.createSandbox,
    setup: VercelProvider.prototype.setupViteApp,
    terminate: VercelProvider.prototype.terminate,
  };
  const stopped: string[] = [];
  let created = 0;
  let expired = false;
  let failSetup = false;
  let failStop = false;
  VercelProvider.prototype.reconnect = async function (id: string) {
    if (expired) throw Error('Sandbox expired');
    (this as any).sandboxInfo = {
      sandboxId: id, url: 'https://sandbox.invalid', provider: 'vercel', createdAt: new Date(),
    };
  };
  VercelProvider.prototype.createSandbox = async function () {
    const sandboxId = `sbx_new${++created}`;
    (this as any).sandboxInfo = {
      sandboxId, url: 'https://sandbox.invalid', provider: 'vercel', createdAt: new Date(),
    };
    return this.getSandboxInfo()!;
  };
  VercelProvider.prototype.setupViteApp = async function () {
    if (failSetup) throw Error('Synthetic setup failure');
  };
  VercelProvider.prototype.terminate = async function () {
    const id = this.getSandboxInfo()?.sandboxId;
    if (failStop) throw Error('Synthetic stop failure');
    if (id) stopped.push(id);
  };
  try {
    const replaced = await createSandbox(ownedRequest('/api/create-ai-sandbox-v2', 'POST', 'sbx_old'));
    assert.equal(replaced.status, 200);
    assert.equal((await replaced.json()).sandboxId, 'sbx_new1');
    assert.deepEqual(stopped, ['sbx_old']);
    assert.match(replaced.headers.get('set-cookie') || '', /__Host-aidaos-builder=/);

    stopped.length = 0;
    expired = true;
    const fromExpired = await createSandbox(ownedRequest('/api/create-ai-sandbox-v2', 'POST', 'sbx_expired'));
    assert.equal(fromExpired.status, 200);
    assert.equal((await fromExpired.json()).sandboxId, 'sbx_new2');
    assert.deepEqual(stopped, []);

    expired = false;
    failStop = true;
    const stopFailed = await createSandbox(ownedRequest('/api/create-ai-sandbox-v2', 'POST', 'sbx_old'));
    assert.equal(stopFailed.status, 500);
    assert.equal(created, 2, 'a replacement must not start when the old VM could still run');
    failStop = false;

    failSetup = true;
    const failed = await createSandbox(ownedRequest('/api/create-ai-sandbox-v2', 'POST'));
    assert.equal(failed.status, 500);
    assert.deepEqual(stopped, ['sbx_new3']);
  } finally {
    VercelProvider.prototype.reconnect = originals.reconnect;
    VercelProvider.prototype.createSandbox = originals.create;
    VercelProvider.prototype.setupViteApp = originals.setup;
    VercelProvider.prototype.terminate = originals.terminate;
  }
});
