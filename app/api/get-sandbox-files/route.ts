import { pilotState } from '@/lib/aidaos/pilot-context';
import { pilotRoute } from '@/lib/aidaos/pilot-route';
import { NextResponse } from 'next/server';
import { parseJavaScriptFile, buildComponentTree } from '@/lib/file-parser';
import { FileManifest, FileInfo, RouteInfo } from '@/types/file-manifest';
// SandboxState type used implicitly through pilotState().activeSandbox

declare global {
  var activeSandbox: any;
}

const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

class SourceReadError extends Error {
  constructor(message: string, public readonly status = 500) {
    super(message);
  }
}

async function handleGET() {
  try {
    if (!pilotState().activeSandbox) {
      return NextResponse.json({
        success: false,
        error: 'No active sandbox'
      }, { status: 404 });
    }

    console.log('[get-sandbox-files] Fetching and analyzing file structure...');
    
    // Get list of all relevant files
    const findResult = await pilotState().activeSandbox.runCommand({
      cmd: 'find',
      args: [
        '.',
        '-name', 'node_modules', '-prune', '-o',
        '-name', '.git', '-prune', '-o',
        '-name', 'dist', '-prune', '-o',
        '-name', 'build', '-prune', '-o',
        '-type', 'f',
        '(',
        '-name', '*.jsx',
        '-o', '-name', '*.js',
        '-o', '-name', '*.tsx',
        '-o', '-name', '*.ts',
        '-o', '-name', '*.css',
        '-o', '-name', '*.json',
        ')',
        '-print'
      ]
    });
    
    if (findResult.exitCode !== 0) {
      throw new Error('Failed to list files');
    }
    
    const fileList = (await findResult.stdout()).split('\n').filter((f: string) => f.trim());
    console.log('[get-sandbox-files] Found', fileList.length, 'files');
    if (fileList.length > MAX_FILES) {
      throw new SourceReadError('The project has too many source files to edit safely.', 413);
    }
    
    // Recover the entire bounded source snapshot on every request. A partial
    // snapshot would make subsequent AI edits overwrite unseen page content.
    const filesContent: Record<string, string> = {};
    let totalBytes = 0;
    
    for (const filePath of fileList) {
      try {
        const statResult = await pilotState().activeSandbox.runCommand({
          cmd: 'stat',
          args: ['-c', '%s', filePath]
        });
        if (statResult.exitCode !== 0) {
          throw new SourceReadError(`Could not inspect ${filePath}.`);
        }
        const fileSize = Number((await statResult.stdout()).trim());
        if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
          throw new SourceReadError(`Invalid size for ${filePath}.`);
        }
        if (fileSize > MAX_FILE_BYTES || totalBytes + fileSize > MAX_SOURCE_BYTES) {
          throw new SourceReadError('The project source exceeds the edit limit.', 413);
        }
        const catResult = await pilotState().activeSandbox.runCommand({
          cmd: 'cat',
          args: [filePath]
        });
        if (catResult.exitCode !== 0) {
          throw new SourceReadError(`Could not read ${filePath}.`);
        }
        const content = await catResult.stdout();
        if (Buffer.byteLength(content) !== fileSize) {
          throw new SourceReadError(`Source changed while reading ${filePath}.`);
        }
        totalBytes += fileSize;
        filesContent[filePath.replace(/^\.\//, '')] = content;
      } catch (error) {
        if (error instanceof SourceReadError) throw error;
        throw new SourceReadError(`Could not recover ${filePath}.`);
      }
    }
    
    // Get directory structure
    const treeResult = await pilotState().activeSandbox.runCommand({
      cmd: 'find',
      args: ['.', '-type', 'd', '-not', '-path', '*/node_modules*', '-not', '-path', '*/.git*']
    });
    
    let structure = '';
    if (treeResult.exitCode === 0) {
      const dirs = (await treeResult.stdout()).split('\n').filter((d: string) => d.trim());
      structure = dirs.slice(0, 50).join('\n'); // Limit to 50 lines
    }
    
    // Build enhanced file manifest
    const fileManifest: FileManifest = {
      files: {},
      routes: [],
      componentTree: {},
      entryPoint: '',
      styleFiles: [],
      timestamp: Date.now(),
    };
    
    // Process each file
    for (const [relativePath, content] of Object.entries(filesContent)) {
      const fullPath = `/${relativePath}`;
      
      // Create base file info
      const fileInfo: FileInfo = {
        content: content,
        type: 'utility',
        path: fullPath,
        relativePath,
        lastModified: Date.now(),
      };
      
      // Parse JavaScript/JSX files
      if (relativePath.match(/\.(jsx?|tsx?)$/)) {
        const parseResult = parseJavaScriptFile(content, fullPath);
        Object.assign(fileInfo, parseResult);
        
        // Identify entry point
        if (relativePath === 'src/main.jsx' || relativePath === 'src/index.jsx') {
          fileManifest.entryPoint = fullPath;
        }
        
        // Identify App.jsx
        if (relativePath === 'src/App.jsx' || relativePath === 'App.jsx') {
          fileManifest.entryPoint = fileManifest.entryPoint || fullPath;
        }
      }
      
      // Track style files
      if (relativePath.endsWith('.css')) {
        fileManifest.styleFiles.push(fullPath);
        fileInfo.type = 'style';
      }
      
      fileManifest.files[fullPath] = fileInfo;
    }
    
    // Build component tree
    fileManifest.componentTree = buildComponentTree(fileManifest.files);
    
    // Extract routes (simplified - looks for Route components or page pattern)
    fileManifest.routes = extractRoutes(fileManifest.files);
    
    // Update global file cache with manifest
    if (pilotState().sandboxState?.fileCache) {
      pilotState().sandboxState.fileCache.manifest = fileManifest;
    }

    return NextResponse.json({
      success: true,
      files: filesContent,
      structure,
      fileCount: Object.keys(filesContent).length,
      manifest: fileManifest,
    });

  } catch (error) {
    console.error('[get-sandbox-files] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: error instanceof SourceReadError ? error.status : 500 });
  }
}

function extractRoutes(files: Record<string, FileInfo>): RouteInfo[] {
  const routes: RouteInfo[] = [];
  
  // Look for React Router usage
  for (const [path, fileInfo] of Object.entries(files)) {
    if (fileInfo.content.includes('<Route') || fileInfo.content.includes('createBrowserRouter')) {
      // Extract route definitions (simplified)
      const routeMatches = fileInfo.content.matchAll(/path=["']([^"']+)["'].*(?:element|component)={([^}]+)}/g);
      
      for (const match of routeMatches) {
        const [, routePath] = match;
        // componentRef available in match but not used currently
        routes.push({
          path: routePath,
          component: path,
        });
      }
    }
    
    // Check for Next.js style pages
    if (fileInfo.relativePath.startsWith('pages/') || fileInfo.relativePath.startsWith('src/pages/')) {
      const routePath = '/' + fileInfo.relativePath
        .replace(/^(src\/)?pages\//, '')
        .replace(/\.(jsx?|tsx?)$/, '')
        .replace(/index$/, '');
        
      routes.push({
        path: routePath,
        component: path,
      });
    }
  }
  
  return routes;
}
export const GET = pilotRoute(handleGET);
