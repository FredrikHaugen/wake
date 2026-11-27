import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpuFraction, parseGpu, parseMemory, parseTemps } from '../src/stats.ts';

const GB = 2 ** 30;
const VM_STAT = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                                    53692.',
  'Pages active:                                 351773.',
  'Pages wired down:                             625249.',
  'Pages purgeable:                                6095.',
  '"Translation faults":                     5254059746.',
  'File-backed pages:                            199066.',
  'Anonymous pages:                              505008.',
  'Pages stored in compressor:                  1275275.',
  'Pages occupied by compressor:                 661763.',
  '',
].join('\n');
const SWAP = 'total = 10240.00M  used = 8973.62M  free = 1266.38M  (encrypted)\n';
const IOREG = '      "PerformanceStatistics" = {"Tiler Utilization %"=39,"Renderer Utilization %"=45,"Device Utilization %"=48,"In use system memory"=7188742144}\n';
const TEMPS = 'gas gauge battery\t36.0\nPMU tdie1\t60.2\nPMU tdie8\t64.0\nPMU tdev1\t-22.0\nNAND CH0 temp\t51.0\nPMU tcal\t51.8\ngas gauge battery\t36.3\n';

test('cpuFraction is the busy share of the time between two samples', () => {
  assert.equal(cpuFraction({ busy: 100, total: 1000 }, { busy: 123, total: 1100 }), 0.23);
  assert.equal(cpuFraction({ busy: 5, total: 10 }, { busy: 5, total: 10 }), 0);
  assert.equal(cpuFraction({ busy: 0, total: 0 }, { busy: 20, total: 10 }), 1);
});

test('parseMemory splits memory the way Activity Monitor does', () => {
  const app = (505008 - 6095) * 16384;
  const wired = 625249 * 16384;
  const compressed = 661763 * 16384;
  assert.deepEqual(parseMemory(VM_STAT, SWAP, 32 * GB), {
    physical: 32 * GB,
    used: app + wired + compressed,
    app,
    wired,
    compressed,
    cached: (199066 + 6095) * 16384,
    swapUsed: Math.round(8973.62 * 2 ** 20),
    swapTotal: 10240 * 2 ** 20,
  });
});

test('parseMemory reads swap in K, M or G and treats unreadable swap as none', () => {
  assert.equal(parseMemory(VM_STAT, 'total = 2.00G  used = 512.00K  free = 0.00M', 32 * GB)?.swapTotal, 2 * GB);
  assert.equal(parseMemory(VM_STAT, 'total = 2.00G  used = 512.00K  free = 0.00M', 32 * GB)?.swapUsed, 512 * 1024);
  const noSwap = parseMemory(VM_STAT, 'total = 10913,25M  used = 1,00M', 32 * GB);
  assert.deepEqual([noSwap?.swapUsed, noSwap?.swapTotal], [0, 0]);
});

test('parseMemory returns null when a field is missing', () => {
  assert.equal(parseMemory('', SWAP, 32 * GB), null);
  assert.equal(parseMemory(VM_STAT.replace('Pages purgeable', 'Pages renamed'), SWAP, 32 * GB), null);
  assert.equal(parseMemory(VM_STAT.replace('(page size of 16384 bytes)', ''), SWAP, 32 * GB), null);
});

test('parseGpu takes the busiest accelerator', () => {
  assert.equal(parseGpu(IOREG), 0.48);
  assert.equal(parseGpu(IOREG + IOREG.replace('=48', '=71')), 0.71);
  assert.equal(parseGpu(IOREG.replace('=48', '=250')), 1);
  assert.equal(parseGpu('no accelerators here'), null);
  assert.equal(parseGpu(''), null);
});

test('parseTemps keeps the hottest plausible sensor of each kind', () => {
  assert.deepEqual(parseTemps(TEMPS), { chip: 64, battery: 36.3, ssd: 51 });
  assert.deepEqual(parseTemps('PMU tdie1\t60.2\n'), { chip: 60.2, battery: null, ssd: null });
});

test('parseTemps returns null when nothing usable was read', () => {
  assert.equal(parseTemps(''), null);
  assert.equal(parseTemps('PMU tdev1\t-22.0\nPMU tdie1\t0.0\nPMU tdie2\t150.0\nPMU tdie3\tnan\n'), null);
});
