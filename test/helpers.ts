import { execFileSync } from 'node:child_process';

export function displaySleepBlockedFor(pid: number): boolean {
  const lines = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' }).split('\n');
  const behalf = new RegExp(`on behalf of Process ID ${pid}\\b`);
  return lines.some((line, i) => line.includes('PreventUserIdleDisplaySleep') && behalf.test(lines[i + 1] ?? ''));
}

export async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let result = check();
  while (!result && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    result = check();
  }
  return result;
}
