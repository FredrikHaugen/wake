import { execFile } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type Swap = { used: number; total: number };

/** All sizes in bytes. `used` is app + wired + compressed. `swap` is null when it could not be read. */
export type Memory = {
  physical: number;
  used: number;
  app: number;
  wired: number;
  compressed: number;
  cached: number;
  swap: Swap | null;
};

/** Degrees Celsius; null where this Mac reports no such sensor. */
export type Temps = { chip: number | null; battery: number | null; ssd: number | null };

/** `cpu` and `gpu` are fractions from 0 to 1. */
export type Stats = { cpu: number; gpu: number | null; memory: Memory | null; temps: Temps | null };

export type CpuTimes = { busy: number; total: number };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function cpuFraction(prev: CpuTimes, next: CpuTimes): number {
  const total = next.total - prev.total;
  return total > 0 ? clamp01((next.busy - prev.busy) / total) : 0;
}

function pageCount(vmStat: string, field: string): number | null {
  const line = vmStat.split('\n').find((l) => l.startsWith(`${field}:`));
  const match = line?.match(/(\d+)\.?\s*$/);
  return match ? Number(match[1]) : null;
}

const SWAP_UNIT: Record<string, number> = { K: 2 ** 10, M: 2 ** 20, G: 2 ** 30 };

function swapBytes(swapUsage: string, field: string): number | null {
  const match = swapUsage.match(new RegExp(`${field} = (\\d+\\.\\d+|\\d+)([KMG])`));
  return match ? Math.round(Number(match[1]) * SWAP_UNIT[match[2]]) : null;
}

/** Splits memory the way Activity Monitor does, from `vm_stat` and `sysctl -n vm.swapusage` output. */
export function parseMemory(vmStat: string, swapUsage: string, physicalBytes: number): Memory | null {
  const pageSize = vmStat.match(/page size of (\d+) bytes/);
  const wired = pageCount(vmStat, 'Pages wired down');
  const purgeable = pageCount(vmStat, 'Pages purgeable');
  const fileBacked = pageCount(vmStat, 'File-backed pages');
  const anonymous = pageCount(vmStat, 'Anonymous pages');
  const compressor = pageCount(vmStat, 'Pages occupied by compressor');
  if (!pageSize || wired === null || purgeable === null || fileBacked === null || anonymous === null || compressor === null) {
    return null;
  }
  const page = Number(pageSize[1]);
  const app = Math.max(0, anonymous - purgeable) * page;
  const swapTotal = swapBytes(swapUsage, 'total');
  const swapUsed = swapBytes(swapUsage, 'used');
  return {
    physical: physicalBytes,
    used: app + wired * page + compressor * page,
    app,
    wired: wired * page,
    compressed: compressor * page,
    cached: (fileBacked + purgeable) * page,
    swap: swapTotal !== null && swapUsed !== null ? { used: swapUsed, total: swapTotal } : null,
  };
}

/** Busiest accelerator in `ioreg -r -d 1 -w 0 -c IOAccelerator` output. */
export function parseGpu(ioregOutput: string): number | null {
  const percents = [...ioregOutput.matchAll(/"Device Utilization %"=(\d+)/g)].map((match) => Number(match[1]));
  return percents.length > 0 ? clamp01(Math.max(...percents) / 100) : null;
}

const hottest = (readings: number[]): number | null => (readings.length > 0 ? Math.max(...readings) : null);

/** Hottest plausible sensor of each kind from `name<TAB>celsius` lines. */
export function parseTemps(output: string): Temps | null {
  const chip: number[] = [];
  const battery: number[] = [];
  const ssd: number[] = [];
  for (const line of output.split('\n')) {
    const [name, value] = line.split('\t');
    const celsius = Number(value);
    if (!(celsius > 0 && celsius < 150)) continue;
    if (/tdie/i.test(name)) chip.push(celsius);
    else if (/battery/i.test(name)) battery.push(celsius);
    else if (/nand/i.test(name)) ssd.push(celsius);
  }
  const temps: Temps = { chip: hottest(chip), battery: hottest(battery), ssd: hottest(ssd) };
  return temps.chip === null && temps.battery === null && temps.ssd === null ? null : temps;
}

/** The slow temperature read runs on every fifth reading; the others reuse its result. */
export const TEMPS_EVERY = 5;

// JavaScript for Automation, run by osascript, which prints what run() returns:
// one `name<TAB>celsius` line per HID temperature sensor. The IOHID calls are a
// private API, so a Mac where they stop working simply reports no temperatures.
export const TEMPS_SCRIPT = String.raw`ObjC.import('Foundation');
ObjC.import('IOKit');
ObjC.bindFunction('IOHIDEventSystemClientCreate', ['id', ['void *']]);
ObjC.bindFunction('IOHIDEventSystemClientSetMatching', ['int', ['id', 'id']]);
ObjC.bindFunction('IOHIDEventSystemClientCopyServices', ['id', ['id']]);
ObjC.bindFunction('IOHIDServiceClientCopyProperty', ['id', ['id', 'id']]);
ObjC.bindFunction('IOHIDServiceClientCopyEvent', ['id', ['id', 'long long', 'int', 'long long']]);
ObjC.bindFunction('IOHIDEventGetFloatValue', ['double', ['id', 'int']]);
function run() {
  const client = $.IOHIDEventSystemClientCreate(null);
  $.IOHIDEventSystemClientSetMatching(client, $({ PrimaryUsagePage: 0xff00, PrimaryUsage: 5 }));
  const services = $.IOHIDEventSystemClientCopyServices(client);
  const out = [];
  const n = services.count;
  for (let i = 0; i < n; i++) {
    const s = services.objectAtIndex(i);
    const name = ObjC.unwrap($.IOHIDServiceClientCopyProperty(s, $('Product')));
    const ev = $.IOHIDServiceClientCopyEvent(s, 15, 0, 0);
    if (ev.isNil && ev.isNil()) continue;
    const t = $.IOHIDEventGetFloatValue(ev, 15 << 16);
    out.push(name + '\t' + t.toFixed(1));
  }
  return out.join('\n');
}`;

export type StatsIo = {
  cpuTimes: () => CpuTimes;
  totalMemory: () => number;
  /** Resolves to stdout; rejects when the command fails or times out. */
  exec: (file: string, args: string[]) => Promise<string>;
};

/** Returns a reader that never rejects: whatever cannot be read comes back as null. */
export function createStatsReader(io: StatsIo): () => Promise<Stats> {
  let previous = io.cpuTimes();
  let reads = 0;
  let temps: Temps | null = null;

  async function output(file: string, args: string[]): Promise<string | null> {
    try {
      return await io.exec(file, args);
    } catch {
      return null;
    }
  }

  return async () => {
    const refreshTemps = reads % TEMPS_EVERY === 0;
    reads += 1;
    const [vmStat, swap, ioreg, sensors] = await Promise.all([
      output('vm_stat', []),
      output('sysctl', ['-n', 'vm.swapusage']),
      output('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']),
      refreshTemps ? output('osascript', ['-l', 'JavaScript', '-e', TEMPS_SCRIPT]) : null,
    ]);
    if (refreshTemps) temps = sensors === null ? null : parseTemps(sensors);
    // Measured after the commands settle, so even the first reading covers a real stretch of time.
    const now = io.cpuTimes();
    const cpu = cpuFraction(previous, now);
    previous = now;
    return {
      cpu,
      gpu: ioreg === null ? null : parseGpu(ioreg),
      memory: vmStat === null ? null : parseMemory(vmStat, swap ?? '', io.totalMemory()),
      temps,
    };
  };
}

export function realStatsIo(): StatsIo {
  return {
    cpuTimes() {
      let busy = 0;
      let idle = 0;
      for (const { times } of cpus()) {
        busy += times.user + times.nice + times.sys + times.irq;
        idle += times.idle;
      }
      return { busy, total: busy + idle };
    },
    totalMemory: totalmem,
    async exec(file, args) {
      // LC_ALL=C: sysctl prints a decimal comma under some locales.
      const { stdout } = await execFileAsync(file, args, { timeout: 5_000, env: { ...process.env, LC_ALL: 'C' } });
      return stdout;
    },
  };
}
