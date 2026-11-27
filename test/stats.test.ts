import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPS_SCRIPT, cpuFraction, createStatsReader, parseGpu, parseMemory, parseTemps, realStatsIo, type StatsIo,
} from '../src/stats.ts';

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
    swap: { used: Math.round(8973.62 * 2 ** 20), total: 10240 * 2 ** 20 },
  });
});

test('parseMemory reads swap in K, M or G', () => {
  const memory = parseMemory(VM_STAT, 'total = 2.00G  used = 512.00K  free = 0.00M', 32 * GB);
  assert.deepEqual(memory?.swap, { used: 512 * 1024, total: 2 * GB });
  assert.deepEqual(parseMemory(VM_STAT, 'total = 0.00M  used = 0.00M  free = 0.00M', 32 * GB)?.swap, { used: 0, total: 0 });
});

test('parseMemory reports swap it cannot read as missing, not as zero', () => {
  for (const unreadable of ['', 'total = 10913,25M  used = 1,00M', 'total = 2.00G']) {
    const memory = parseMemory(VM_STAT, unreadable, 32 * GB);
    assert.equal(memory?.swap, null);
    assert.equal(memory?.wired, 625249 * 16384);
  }
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

const outputs: Record<string, string> = { vm_stat: VM_STAT, sysctl: SWAP, ioreg: IOREG, osascript: TEMPS };

function fakeIo(fail: string[] = []) {
  const calls: string[][] = [];
  let reads = 0;
  const io: StatsIo = {
    cpuTimes: () => { reads += 1; return { busy: 23 * (reads - 1), total: 100 * (reads - 1) }; },
    totalMemory: () => 32 * GB,
    exec: async (file, args) => {
      calls.push([file, ...args]);
      if (fail.includes(file)) throw new Error(`${file} failed`);
      return outputs[file] ?? '';
    },
  };
  return { io, calls, count: (file: string) => calls.filter((call) => call[0] === file).length };
}

test('a reading combines every source', async () => {
  const f = fakeIo();
  const read = createStatsReader(f.io);
  assert.deepEqual(await read(), {
    cpu: 0.23,
    gpu: 0.48,
    memory: parseMemory(VM_STAT, SWAP, 32 * GB),
    temps: { chip: 64, battery: 36.3, ssd: 51 },
  });
  assert.deepEqual(f.calls.toSorted(), [
    ['ioreg', '-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'],
    ['osascript', '-l', 'JavaScript', '-e', TEMPS_SCRIPT],
    ['sysctl', '-n', 'vm.swapusage'],
    ['vm_stat'],
  ]);
});

test('temperatures are read on every fifth reading and reused in between', async () => {
  const f = fakeIo();
  const read = createStatsReader(f.io);
  const readings = [];
  for (let i = 0; i < 6; i++) readings.push(await read());
  assert.equal(f.count('osascript'), 2);
  assert.equal(f.count('vm_stat'), 6);
  assert.deepEqual(readings[3].temps, { chip: 64, battery: 36.3, ssd: 51 });
  assert.equal(readings[3].cpu, 0.23);
});

test('a failing command blanks only its own rows', async () => {
  const sensors = await createStatsReader(fakeIo(['ioreg', 'osascript']).io)();
  assert.equal(sensors.gpu, null);
  assert.equal(sensors.temps, null);
  assert.equal(sensors.memory?.wired, 625249 * 16384);

  const memory = await createStatsReader(fakeIo(['vm_stat']).io)();
  assert.equal(memory.memory, null);
  assert.equal(memory.gpu, 0.48);

  const swap = await createStatsReader(fakeIo(['sysctl']).io)();
  assert.deepEqual([swap.memory?.swap, swap.memory?.wired], [null, 625249 * 16384]);
});

test('reads this Mac', { skip: process.platform !== 'darwin' }, async () => {
  const stats = await createStatsReader(realStatsIo())();
  assert.ok(stats.cpu >= 0 && stats.cpu <= 1);
  assert.ok(stats.memory !== null && stats.memory.used > 0 && stats.memory.used <= stats.memory.physical);
  assert.ok(stats.gpu === null || (stats.gpu >= 0 && stats.gpu <= 1));
  for (const temp of Object.values(stats.temps ?? {})) assert.ok(temp === null || (temp > 0 && temp < 150));
});

test('commands run in the C locale whatever the locale of the user', { skip: process.platform !== 'darwin' }, async (t) => {
  const before = process.env.LC_ALL;
  process.env.LC_ALL = 'nb_NO.UTF-8';
  t.after(() => { if (before === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = before; });
  assert.match(await realStatsIo().exec('sysctl', ['-n', 'vm.swapusage']), /total = \d+\.\d+M/);
});
