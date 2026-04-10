import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { sandboxPath } from '../../util/input-guard';
import { ExecutorResult, headTail } from './index';

export { executeShell } from '../../../capabilities/files/shell';

function applyOffsetLimit(lines: string[], offset?: number, limit?: number): { lines: string[]; startLine: number } {
  const startLine = offset && offset > 0 ? offset - 1 : 0;
  if (limit && limit > 0) return { lines: lines.slice(startLine, startLine + limit), startLine };
  if (startLine > 0) return { lines: lines.slice(startLine), startLine };
  return { lines, startLine };
}

export async function executeFileRead(
  filePath: string,
  cwd?: string,
  offset?: number,
  limit?: number
): Promise<ExecutorResult> {
  let resolved: string;
  try {
    resolved = sandboxPath(filePath, cwd);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const content = await readFile(resolved, 'utf-8');
    const { lines, startLine } = applyOffsetLimit(content.split('\n'), offset, limit);
    const numbered = lines.map((line, i) => `${String(startLine + i + 1).padStart(6)}\t${line}`);
    return { ok: true, value: headTail(numbered.join('\n'), 8000) };
  } catch (e) {
    return { ok: false, error: `[Error reading ${resolved}: ${e instanceof Error ? e.message : String(e)}]` };
  }
}

export async function executeFileWrite(filePath: string, content: string, cwd?: string): Promise<ExecutorResult> {
  let resolved: string;
  try {
    resolved = sandboxPath(filePath, cwd);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf-8');
    return { ok: true, value: `File written: ${resolved} (${content.length} bytes)` };
  } catch (e) {
    return { ok: false, error: `[Error writing ${resolved}: ${e instanceof Error ? e.message : String(e)}]` };
  }
}

export async function executeFileEdit(
  filePath: string,
  oldStr: string,
  newStr: string,
  cwd?: string
): Promise<ExecutorResult> {
  let resolved: string;
  try {
    resolved = sandboxPath(filePath, cwd);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const content = await readFile(resolved, 'utf-8');
    const count = content.split(oldStr).length - 1;
    if (count === 0) return { ok: false, error: `old_string not found in ${resolved}` };
    if (count > 1) return { ok: false, error: `old_string found ${count} times — must be unique. Add more context.` };
    const updated = content.replace(oldStr, newStr);
    await writeFile(resolved, updated, 'utf-8');
    return { ok: true, value: `File edited: ${resolved} (replaced 1 occurrence)` };
  } catch (e) {
    return { ok: false, error: `[Error editing ${resolved}: ${e instanceof Error ? e.message : String(e)}]` };
  }
}

export async function executeFileList(pattern: string, cwd?: string): Promise<ExecutorResult> {
  if (/[;&|`$()]/.test(pattern)) {
    return { ok: false, error: 'Invalid characters in file pattern' };
  }
  try {
    const resolved = sandboxPath(pattern, cwd);
    const entries = await readdir(resolved, { withFileTypes: true });
    const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return { ok: true, value: names.join('\n') || '(empty)' };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}
