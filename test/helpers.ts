import { execFileSync } from 'node:child_process';
import type { Stats } from '../src/stats.ts';

const GB = 2 ** 30;
export const fullStats: Stats = {
  cpu: 0.23,
  gpu: 0.48,
  memory: {
    physical: 32 * GB, used: 27.5 * GB, app: 7.74 * GB, wired: 9.76 * GB, compressed: 10 * GB,
    cached: 3.36 * GB, swap: { used: 8.78 * GB, total: 10 * GB },
  },
  temps: { chip: 64, battery: 36, ssd: 51 },
};

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
