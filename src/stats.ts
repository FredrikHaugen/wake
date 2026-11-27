/** All sizes in bytes. `used` is app + wired + compressed. */
export type Memory = {
  physical: number;
  used: number;
  app: number;
  wired: number;
  compressed: number;
  cached: number;
  swapUsed: number;
  swapTotal: number;
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
  const swapKnown = swapTotal !== null && swapUsed !== null;
  return {
    physical: physicalBytes,
    used: app + wired * page + compressor * page,
    app,
    wired: wired * page,
    compressed: compressor * page,
    cached: (fileBacked + purgeable) * page,
    swapUsed: swapKnown ? swapUsed : 0,
    swapTotal: swapKnown ? swapTotal : 0,
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
