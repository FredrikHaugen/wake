import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type Battery = { percent: number; onBattery: boolean };

export const LOW_BATTERY_PERCENT = 10;

export function parseBattery(pmsetOutput: string): Battery | null {
  const line = pmsetOutput.split('\n').find((l) => l.includes('InternalBattery'));
  const match = line?.match(/(\d+)%/);
  if (!match) return null;
  return { percent: Number(match[1]), onBattery: pmsetOutput.includes("'Battery Power'") };
}

export function isBatteryLow(battery: Battery | null): battery is Battery {
  return battery !== null && battery.onBattery && battery.percent <= LOW_BATTERY_PERCENT;
}

export function batteryLabel(battery: Battery | null): string {
  if (battery === null) return '';
  return `${battery.onBattery ? 'on battery' : 'plugged in'} ${battery.percent}%`;
}

export async function readBattery(): Promise<Battery | null> {
  try {
    const { stdout } = await execFileAsync('pmset', ['-g', 'batt']);
    return parseBattery(stdout);
  } catch {
    return null;
  }
}
