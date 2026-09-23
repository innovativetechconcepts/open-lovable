import { pilotState } from '@/lib/aidaos/pilot-context';
import { pilotRoute } from '@/lib/aidaos/pilot-route';
import { NextResponse } from 'next/server';

declare global {
  var viteErrorsCache: { errors: any[], timestamp: number } | null;
}

async function handlePOST() {
  try {
    // Clear the cache
    pilotState().viteErrors = [];
    
    console.log('[clear-vite-errors-cache] Cache cleared');
    
    return NextResponse.json({
      success: true,
      message: 'Vite errors cache cleared'
    });
    
  } catch (error) {
    console.error('[clear-vite-errors-cache] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: (error as Error).message 
    }, { status: 500 });
  }
}
export const POST = pilotRoute(handlePOST);
