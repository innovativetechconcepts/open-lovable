import { pilotState } from '@/lib/aidaos/pilot-context';
import { pilotRoute } from '@/lib/aidaos/pilot-route';
import { NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
}

async function handleGET() {
  try {
    // Check sandbox manager first, then fall back to global state
    const provider = sandboxManager.getActiveProvider() || pilotState().activeSandboxProvider;
    const sandboxExists = !!provider;

    let sandboxHealthy = false;
    let sandboxInfo = null;

    if (sandboxExists && provider) {
      try {
        // Check if sandbox is healthy by getting its info
        const providerInfo = provider.getSandboxInfo();
        sandboxHealthy = !!providerInfo;
        
        sandboxInfo = {
          sandboxId: providerInfo?.sandboxId || pilotState().sandboxData?.sandboxId,
          url: providerInfo?.url || pilotState().sandboxData?.url,
          filesTracked: pilotState().existingFiles ? Array.from(pilotState().existingFiles) : [],
          lastHealthCheck: new Date().toISOString()
        };
      } catch (error) {
        console.error('[sandbox-status] Health check failed:', error);
        sandboxHealthy = false;
      }
    }
    
    return NextResponse.json({
      success: true,
      active: sandboxExists,
      healthy: sandboxHealthy,
      sandboxData: sandboxInfo,
      message: sandboxHealthy 
        ? 'Sandbox is active and healthy' 
        : sandboxExists 
          ? 'Sandbox exists but is not responding' 
          : 'No active sandbox'
    });
    
  } catch (error) {
    console.error('[sandbox-status] Error:', error);
    return NextResponse.json({ 
      success: false,
      active: false,
      error: (error as Error).message 
    }, { status: 500 });
  }
}
export const GET = pilotRoute(handleGET);
