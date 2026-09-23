import { pilotState } from '@/lib/aidaos/pilot-context';
import { pilotRoute } from '@/lib/aidaos/pilot-route';
import { NextResponse } from 'next/server';

declare global {
  var activeSandbox: any;
}

async function handlePOST() {
  try {
    if (!pilotState().activeSandbox) {
      return NextResponse.json({ 
        success: false, 
        error: 'No active sandbox' 
      }, { status: 400 });
    }
    
    console.log('[create-zip] Creating project zip...');
    
    // Create zip file in sandbox using standard commands
    const zipResult = await pilotState().activeSandbox.runCommand({
      cmd: 'bash',
      args: ['-c', `zip -r /tmp/project.zip . -x "node_modules/*" ".git/*" ".next/*" "dist/*" "build/*" "*.log"`]
    });
    
    if (zipResult.exitCode !== 0) {
      const error = await zipResult.stderr();
      throw new Error(`Failed to create zip: ${error}`);
    }
    
    const sizeResult = await pilotState().activeSandbox.runCommand({
      cmd: 'bash',
      args: ['-c', `ls -la /tmp/project.zip | awk '{print $5}'`]
    });
    
    const fileSize = await sizeResult.stdout();
    console.log(`[create-zip] Created project.zip (${fileSize.trim()} bytes)`);
    
    // Read the zip file and convert to base64
    const readResult = await pilotState().activeSandbox.runCommand({
      cmd: 'base64',
      args: ['/tmp/project.zip']
    });
    
    if (readResult.exitCode !== 0) {
      const error = await readResult.stderr();
      throw new Error(`Failed to read zip file: ${error}`);
    }
    
    const base64Content = (await readResult.stdout()).trim();
    
    // Create a data URL for download
    const dataUrl = `data:application/zip;base64,${base64Content}`;
    
    return NextResponse.json({
      success: true,
      dataUrl,
      fileName: 'vercel-sandbox-project.zip',
      message: 'Zip file created successfully'
    });
    
  } catch (error) {
    console.error('[create-zip] Error:', error);
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
