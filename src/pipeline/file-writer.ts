import * as fs from 'fs';
import * as path from 'path';
import { GeneratedFile } from './prompts';

/**
 * Writes generated files under workspaceRoot. Refuses to write outside
 * the workspace (no path traversal via "..").
 */
export function writeFiles(workspaceRoot: string, files: GeneratedFile[]): string[] {
  const written: string[] = [];
  for (const file of files) {
    const normalized = path.normalize(file.path).replace(/^([/\\])+/, '');
    if (normalized.split(path.sep).includes('..')) {
      throw new Error(`Refusing to write outside workspace: ${file.path}`);
    }
    const fullPath = path.join(workspaceRoot, normalized);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, 'utf8');
    written.push(fullPath);
  }
  return written;
}
