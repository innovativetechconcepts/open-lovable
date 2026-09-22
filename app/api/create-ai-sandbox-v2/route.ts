import { pilotState } from '@/lib/aidaos/pilot-context';
import { pilotRoute } from '@/lib/aidaos/pilot-route';
import { NextResponse } from 'next/server';
import { SandboxFactory } from '@/lib/sandbox/factory';
import { VercelProvider } from '@/lib/sandbox/providers/vercel-provider';
import type { SandboxProvider } from '@/lib/sandbox/types';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

function sandboxAlreadyExpired(error: unknown): boolean {
  const value = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    message?: string;
  };
  return value?.status === 404 || value?.status === 410 ||
    value?.statusCode === 404 || value?.statusCode === 410 ||
    value?.response?.status === 404 || value?.response?.status === 410 ||
    /sandbox (?:expired|not found)/i.test(value?.message || '');
}

async function handlePOST() {
  const state = pilotState();
  let replacement: SandboxProvider | null = null;
  try {
    // The signed session is the only authority for an existing sandbox ID.
    // This route skips the normal reconnect because an expired VM must not
    // prevent the operator from creating a replacement.
    if (state.session) {
      const previous = new VercelProvider({});
      try {
        await previous.reconnect(state.session.sandboxId);
        await previous.terminate();
      } catch (error) {
        if (!sandboxAlreadyExpired(error)) throw error;
      }
      state.session = null;
    }

    state.existingFiles = new Set<string>();
    replacement = SandboxFactory.create('vercel');
    const sandboxInfo = await replacement.createSandbox();
    await replacement.setupViteApp();
    sandboxManager.registerSandbox(sandboxInfo.sandboxId, replacement);

    state.sandboxData = sandboxInfo;
    state.sandboxState = {
      fileCache: {
        files: {},
        lastSync: Date.now(),
        sandboxId: sandboxInfo.sandboxId,
      },
      sandbox: replacement,
      sandboxData: sandboxInfo,
    };

    return NextResponse.json({
      success: true,
      sandboxId: sandboxInfo.sandboxId,
      url: sandboxInfo.url,
      provider: sandboxInfo.provider,
      message: 'Sandbox created and Vite React app initialized',
    });
  } catch (error) {
    if (replacement) {
      try {
        await replacement.terminate();
      } catch (stopError) {
        console.error('[create-ai-sandbox-v2] Failed to stop replacement:', stopError);
      }
    }
    console.error('[create-ai-sandbox-v2] Error:', error);
    return NextResponse.json(
      { error: 'Could not create a builder session. Please try again.' },
      { status: 500 },
    );
  }
}

export const POST = pilotRoute(handlePOST);
