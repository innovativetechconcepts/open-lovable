import { pilotState } from '@/lib/aidaos/pilot-context';
import { pilotRoute } from '@/lib/aidaos/pilot-route';
import { NextResponse } from 'next/server';

declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
}

async function handlePOST() {
  try {
    console.log('[kill-sandbox] Stopping active sandbox...');

    let sandboxKilled = false;

    // Stop existing sandbox if any
    if (pilotState().activeSandboxProvider) {
      try {
        await pilotState().activeSandboxProvider?.terminate();
        sandboxKilled = true;
        console.log('[kill-sandbox] Sandbox stopped successfully');
      } catch (e) {
        console.error('[kill-sandbox] Failed to stop sandbox:', e);
      }
      pilotState().activeSandboxProvider = null;
      pilotState().sandboxData = null;
    }
    
    // Clear existing files tracking
    if (pilotState().existingFiles) {
      pilotState().existingFiles.clear();
    }
    
    return NextResponse.json({
      success: true,
      sandboxKilled,
      message: 'Sandbox cleaned up successfully'
    });
    
  } catch (error) {
    console.error('[kill-sandbox] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message 
      }, 
      { status: 500 }
    );
  }
}
export const POST = pilotRoute(handlePOST);
