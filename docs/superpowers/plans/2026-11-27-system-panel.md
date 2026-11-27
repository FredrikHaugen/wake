# wake System Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the wake screen in two: the upper half stays the clock screen that exists today, the lower half shows labelled progress bars for CPU, GPU, memory (broken down the way Activity Monitor does it) and temperatures.

**Architecture:** A new pure module turns the text output of macOS tools into a `Stats` value, and a small stateful reader collects one `Stats` from `os`, `vm_stat`, `sysctl`, `ioreg` and `osascript`. A second pure module lays a `Stats` out as bar rows in a box of any size. `frame.ts` stacks the existing clock frame on top of that panel, and `run.ts` samples in the background every 2 s so the 100 ms clock loop never waits on a subprocess.

**Tech Stack:** Node 26 (any ≥ 24) running TypeScript directly, `node:test`, macOS `vm_stat`, `sysctl`, `ioreg`, `osascript` (JavaScript for Automation). No sudo, no new dependencies.

**Spec:** No separate spec. The request, verbatim: "create a complementary part of the wake, screen in the cli, make the upper half of the available space be the current screen but the lower half, make "progressbars" with information about gpu, cpu, temperatures on parts, ram usage, etc. in ram also split them up like this [screenshot] so everything is clearly labeled, make this fit the theme of what already exists today". The screenshot is Activity Monitor's memory box: Physical Memory 32.00 GB, Memory Used 28.39 GB, Cached Files 3.36 GB, Swap Used 8.78 GB, and under Memory Used: App Memory 7.74 GB, Wired Memory 9.76 GB, Compressed 10.00 GB. The interpretations this plan adds are under Global Constraints.

**Checked on this Mac (Apple M5, macOS 27.2, Node 26.13.1) on 2026-11-27:**
- `vm_stat` (7 ms) prints `Mach Virtual Memory Statistics: (page size of 16384 bytes)` then lines like `Pages wired down:                             625249.`. With its numbers, (Anonymous − purgeable), wired, compressor-occupied and (File-backed + purgeable) pages came to 7.61, 9.54, 10.10 and 3.13 GB, matching the screenshot's App, Wired, Compressed and Cached rows taken a little earlier.
- `sysctl -n vm.swapusage` prints `total = 10240.00M  used = 8973.62M  free = 1266.38M  (encrypted)`. Under `LC_ALL=nb_NO.UTF-8` it prints `10913,25M` with a decimal comma, so the commands must run with `LC_ALL=C`.
- `ioreg -r -d 1 -w 0 -c IOAccelerator` (46 ms) prints a `"PerformanceStatistics" = {…,"Device Utilization %"=48,…}` line for the GPU.
- The `TEMPS_SCRIPT` in Task 2, run as `osascript -l JavaScript -e <script>` (230 ms, no sudo, no permission prompt), printed 46 `name<TAB>value` lines such as `PMU tdie8	64.0`, `gas gauge battery	36.3`, `NAND CH0 temp	51.0` and one bogus `PMU tdev1	-22.0`. CPU and GPU share one chip on Apple silicon, so there is no separate CPU and GPU temperature to show.
- `powermetrics` needs sudo, and `ioreg` has no battery or chip temperature on this Mac, which is why temperatures come from the script.
- `script -q <file> <cmd>` still gives the command a 0×0 pseudo-terminal, which wake reads as 80×24.
- `npm test`: 60 tests pass before any change.

## Global Constraints

- macOS only, Node ≥ 24, no build step, no runtime dependencies, no sudo. Erasable TypeScript only; relative imports end in `.ts`; type-only imports use `import type`.
- Output uses single-width characters only (ASCII, `█▉▊▋▌▍▎▏░▒▓`, `·`, `°`). No line is wider than `columns − 1`, and no frame is taller than the terminal.
- Theme: labels and notes are lowercase; bars are `renderBar` output coloured by the existing `GRADIENT` with a dim `░` track; two-space left margin. Each row's label and value take a `GRADIENT` colour by the row's vertical position, top to bottom, the way the clock's rows do (requested at plan review: "use some colors similar to how the clock is colored so it feels coherent"); indented labels are that colour dimmed; notes are dim. Colour never changes the layout.
- The panel appears only on a TTY, only when the terminal has at least 13 rows and room for the big clock; otherwise the screen is exactly what it is today. Without a TTY wake never runs a stats command.
- Memory labels follow the screenshot: `memory used`, `app memory`, `wired memory`, `compressed`, `cached files`, `swap used`; physical memory is the note `of 32.00 GB` on the `memory used` row. Sizes are binary gigabytes (bytes ÷ 2³⁰) like Activity Monitor.
- `memory used` is app + wired + compressed, so the three indented rows always add up to it.
- Temperature rows are `chip temp`, `battery temp`, `ssd temp`: the hottest sensor of each kind. A reading that is missing leaves its row out; nothing is ever shown as 0 or as a guess.
- Sampling: every 2 s (`STATS_POLL_MS = 2_000`), never two at once, temperatures only on every 5th sample (`TEMPS_EVERY = 5`). Every command has a 5 s timeout and runs with `LC_ALL=C`.
- Work on a branch named `system-panel`. Conventional Commits. `npm test` and `npm run check` pass at the end of every task.

## Review Focus

1. **A Mac without the sensors** (Intel, a VM, a future macOS where the private HID call returns nothing): the GPU and temperature rows are left out and the rest of the panel still shows, with no empty gap where a group would be. → Task 3, "rows without a reading are left out".
2. **A stats command hangs or fails** (osascript blocked by policy, ioreg slow): the clock keeps ticking, the timer ends on time, and only the rows that depend on that command go missing. → Task 2, "a failing command blanks only its own rows"; Task 5, "a reading that never arrives does not hold up the clock" and "a failed reading hides the panel and the run carries on".
3. **wake running without a terminal** (`wake 2h </dev/null >/dev/null &`): it must not spawn `osascript` and friends every 2 s for a panel nobody sees. → Task 5, "without a terminal it never samples".
4. **Small or resized terminals**: at any size the frame fits; below 13 rows or the clock's width the screen is the old one, unchanged. → Task 4 size sweep and fallback tests.
5. **Tool output that does not parse** (a field renamed, a decimal comma, an empty string): the affected value becomes `null`, never `NaN`, since a `NaN` fraction makes `renderBar` return a bar of the wrong width. → Task 1, "parseMemory returns null when a field is missing" and the empty-input assertions.

---

### Task 1: Parse system readings

**Files:**
- Create: `src/stats.ts`
- Test: `test/stats.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type Memory = {
    physical: number; used: number; app: number; wired: number; compressed: number;
    cached: number; swapUsed: number; swapTotal: number; // all bytes
  };
  export type Temps = { chip: number | null; battery: number | null; ssd: number | null }; // °C
  export type Stats = { cpu: number; gpu: number | null; memory: Memory | null; temps: Temps | null }; // cpu, gpu: 0..1
  export type CpuTimes = { busy: number; total: number };
  export function cpuFraction(prev: CpuTimes, next: CpuTimes): number;
  export function parseMemory(vmStat: string, swapUsage: string, physicalBytes: number): Memory | null;
  export function parseGpu(ioregOutput: string): number | null;
  export function parseTemps(output: string): Temps | null;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/stats.test.ts`
Expected: FAIL, cannot find module `../src/stats.ts`.

- [ ] **Step 3: Implement the types and the four functions in `src/stats.ts`**

- `cpuFraction`: (Δbusy ÷ Δtotal) clamped to 0..1; 0 when Δtotal ≤ 0.
- `parseMemory`: page size from `page size of (\d+) bytes`; a page count from the line that starts with the field name followed by `:`. Needs `Pages wired down`, `Pages purgeable`, `File-backed pages`, `Anonymous pages`, `Pages occupied by compressor`; any of them or the page size missing → `null`. `app` = (anonymous − purgeable) pages, floored at 0; `wired` = wired down; `compressed` = occupied by compressor; `cached` = file-backed + purgeable; `used` = app + wired + compressed. Swap from `total = <n><unit>` and `used = <n><unit>` with `<n>` matching `\d+\.\d+|\d+` and unit `K`, `M` or `G` (powers of 1024), `Math.round`ed to bytes; if either does not match, both are 0.
- `parseGpu`: every `"Device Utilization %"=(\d+)` in the text; the maximum ÷ 100, capped at 1; none → `null`.
- `parseTemps`: each line is `name<TAB>number`. Keep readings with 0 < value < 150. Name matching `/tdie/i` → chip, `/battery/i` → battery, `/nand/i` → ssd, anything else ignored. Each kind is the maximum of its readings, or `null`. All three `null` → return `null`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/stats.test.ts && npm run check`
Expected: 7 tests pass, tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/stats.ts test/stats.test.ts
git commit -m "feat: parse cpu, memory, gpu and temperature readings"
```

---

### Task 2: Read system readings from macOS

**Files:**
- Modify: `src/stats.ts`
- Test: `test/stats.test.ts`

**Interfaces:**
- Consumes: Task 1's types and parsers.
- Produces:
  ```ts
  export const TEMPS_EVERY = 5;
  export const TEMPS_SCRIPT: string;
  export type StatsIo = {
    cpuTimes: () => CpuTimes;
    totalMemory: () => number;
    exec: (file: string, args: string[]) => Promise<string>; // stdout; rejects on failure or timeout
  };
  export function createStatsReader(io: StatsIo): () => Promise<Stats>;
  export function realStatsIo(): StatsIo;
  ```
  The function `createStatsReader` returns never rejects.

- [ ] **Step 1: Write the failing tests** (append to `test/stats.test.ts`; add `createStatsReader`, `realStatsIo`, `TEMPS_SCRIPT`, `type StatsIo` to the import)

```ts
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
  assert.deepEqual([swap.memory?.swapUsed, swap.memory?.swapTotal, swap.memory?.wired], [0, 0, 625249 * 16384]);
});

test('reads this Mac', { skip: process.platform !== 'darwin' }, async () => {
  const stats = await createStatsReader(realStatsIo())();
  assert.ok(stats.cpu >= 0 && stats.cpu <= 1);
  assert.ok(stats.memory !== null && stats.memory.used > 0 && stats.memory.used <= stats.memory.physical);
  assert.ok(stats.gpu === null || (stats.gpu >= 0 && stats.gpu <= 1));
  for (const temp of Object.values(stats.temps ?? {})) assert.ok(temp === null || (temp > 0 && temp < 150));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/stats.test.ts`
Expected: FAIL, `createStatsReader` is not exported.

- [ ] **Step 3: Add `TEMPS_SCRIPT` to `src/stats.ts`, exactly this text**

It calls a private IOKit API through JavaScript for Automation; `osascript` runs `run()` and prints what it returns. Keep it verbatim, it is the version checked on this Mac.

```js
ObjC.import('Foundation');
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
}
```

- [ ] **Step 4: Implement `createStatsReader(io: StatsIo): () => Promise<Stats>` and `realStatsIo(): StatsIo` in `src/stats.ts`**

- `createStatsReader` takes `io.cpuTimes()` once when it is created as the first baseline. Each read starts the four commands from the test together, turns each one's failure into "no output" on its own, and only after all have settled takes `io.cpuTimes()` again for `cpuFraction(previous, now)`, so the first CPU figure covers a few hundred milliseconds instead of none. `osascript` runs on reads 1, 6, 11, … (`TEMPS_EVERY`); the other reads reuse the last temperatures. A failed `osascript` read sets temperatures to `null` until the next one. Failed `sysctl` passes `''` as the swap text; failed `vm_stat` gives `memory: null`.
- `realStatsIo`: `cpuTimes` sums `os.cpus()` (busy = user + nice + sys + irq, total = busy + idle); `totalMemory` is `os.totalmem`; `exec` is promisified `execFile` with `{ timeout: 5_000, env: { ...process.env, LC_ALL: 'C' } }`, resolving to stdout.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/stats.test.ts && npm run check`
Expected: 11 tests pass, tsc prints nothing.

- [ ] **Step 6: Commit**

```bash
git add src/stats.ts test/stats.test.ts
git commit -m "feat: read system stats from vm_stat, sysctl, ioreg and osascript"
```

---

### Task 3: Lay the readings out as a panel of bars

**Files:**
- Create: `src/panel.ts`
- Modify: `src/draw.ts` (gains `colourBar`), `src/frame.ts:17-43` (loses it, imports it), `test/helpers.ts` (gains the `fullStats` fixture)
- Test: `test/panel.test.ts`

**Interfaces:**
- Consumes: `Stats` from `src/stats.ts`; `renderBar`, `dim` from `src/draw.ts`.
- Produces:
  ```ts
  // src/draw.ts — moved unchanged from frame.ts, now exported
  export function colourBar(bar: string, fraction: number | null, color: boolean): string;
  // src/panel.ts
  export type Meter = {
    label: string; fraction: number; value: string; note: string;
    group: 'load' | 'memory' | 'temperature'; rank: number;
  };
  export function formatGb(bytes: number): string;
  export function buildMeters(stats: Stats): Meter[];
  export function renderPanel(stats: Stats, cols: number, rows: number, color: boolean): string[];
  ```
  `renderPanel` returns at most `rows` lines, each at most `cols − 2` wide, or `[]` when the box is too small.

- [ ] **Step 1: Write the failing tests**

Add the fixture that Tasks 3, 4 and 5 share to `test/helpers.ts` (with `import type { Stats } from '../src/stats.ts';`):

```ts
const GB = 2 ** 30;
export const fullStats: Stats = {
  cpu: 0.23,
  gpu: 0.48,
  memory: {
    physical: 32 * GB, used: 27.5 * GB, app: 7.74 * GB, wired: 9.76 * GB, compressed: 10 * GB,
    cached: 3.36 * GB, swapUsed: 8.78 * GB, swapTotal: 10 * GB,
  },
  temps: { chip: 64, battery: 36, ssd: 51 },
};
```

Then `test/panel.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeters, formatGb, renderPanel } from '../src/panel.ts';
import { renderBar, stripAnsi } from '../src/draw.ts';
import type { Stats } from '../src/stats.ts';
import { fullStats as full } from './helpers.ts';

const GB = 2 ** 30;

const row = (label: string, fraction: number, value: string, note = '', labelWidth = 14, barWidth = 37) =>
  '  ' + label.padEnd(labelWidth) + '  ' + renderBar(fraction, barWidth) + '  ' + value.padStart(8) + (note ? '  ' + note : '');

const load = [row('cpu', 0.23, '23%'), row('gpu', 0.48, '48%')];
const memory = [
  row('memory used', 27.5 / 32, '27.50 GB', 'of 32.00 GB'),
  row('  app memory', 7.74 / 32, '7.74 GB'),
  row('  wired memory', 9.76 / 32, '9.76 GB'),
  row('  compressed', 10 / 32, '10.00 GB'),
  row('cached files', 3.36 / 32, '3.36 GB'),
  row('swap used', 8.78 / 10, '8.78 GB', 'of 10.00 GB'),
];
const temperature = [
  row('chip temp', (64 - 20) / 80, '64°C'),
  row('battery temp', (36 - 20) / 80, '36°C'),
  row('ssd temp', (51 - 20) / 80, '51°C'),
];

test('formatGb uses binary gigabytes like Activity Monitor', () => {
  assert.equal(formatGb(34359738368), '32.00 GB');
  assert.equal(formatGb(7.74 * GB), '7.74 GB');
  assert.equal(formatGb(0), '0.00 GB');
  assert.equal(formatGb(128 * GB), '128.0 GB');
});

test('buildMeters labels every reading', () => {
  assert.deepEqual(buildMeters(full).map((m) => [m.label, m.value, m.note]), [
    ['cpu', '23%', ''],
    ['gpu', '48%', ''],
    ['memory used', '27.50 GB', 'of 32.00 GB'],
    ['  app memory', '7.74 GB', ''],
    ['  wired memory', '9.76 GB', ''],
    ['  compressed', '10.00 GB', ''],
    ['cached files', '3.36 GB', ''],
    ['swap used', '8.78 GB', 'of 10.00 GB'],
    ['chip temp', '64°C', ''],
    ['battery temp', '36°C', ''],
    ['ssd temp', '51°C', ''],
  ]);
});

test('an 80x12 box holds every row under one blank line', () => {
  assert.deepEqual(renderPanel(full, 80, 12, false), ['', ...load, ...memory, ...temperature]);
});

test('with two spare rows the groups are separated', () => {
  assert.deepEqual(renderPanel(full, 80, 14, false), ['', ...load, '', ...memory, '', ...temperature]);
});

test('a taller box centres the rows below the first line', () => {
  const lines = renderPanel(full, 80, 20, false);
  assert.equal(lines.length, 17);
  assert.deepEqual(lines.slice(0, 4), ['', '', '', '']);
  assert.equal(lines[4], load[0]);
});

test('a short box keeps the most important rows', () => {
  assert.deepEqual(renderPanel(full, 80, 4, false), [
    '',
    row('cpu', 0.23, '23%', '', 11, 40),
    row('gpu', 0.48, '48%', '', 11, 40),
    row('memory used', 27.5 / 32, '27.50 GB', 'of 32.00 GB', 11, 40),
  ]);
  const kept = (rows: number) => renderPanel(full, 80, rows, false).filter((l) => l !== '').map((l) => l.trim().split('  ')[0]);
  assert.deepEqual(kept(3), ['cpu', 'memory used']);
  assert.deepEqual(kept(7), ['cpu', 'gpu', 'memory used', 'cached files', 'swap used', 'chip temp']);
  assert.deepEqual(renderPanel(full, 80, 2, false), []);
  assert.deepEqual(renderPanel(full, 80, 0, false), []);
});

test('a narrow box drops the notes, then gives up', () => {
  const narrow = renderPanel(full, 50, 12, false);
  assert.equal(narrow[1], '  ' + 'cpu'.padEnd(14) + '  ' + renderBar(0.23, 20) + '  ' + '23%'.padStart(8));
  assert.ok(narrow.every((line) => !line.includes('of 32.00 GB')));
  assert.equal(renderPanel(full, 38, 12, false).length, 12);
  assert.deepEqual(renderPanel(full, 37, 12, false), []);
});

test('rows without a reading are left out', () => {
  const bare: Stats = { cpu: 0.5, gpu: null, memory: null, temps: null };
  assert.deepEqual(renderPanel(bare, 80, 12, false), ['', '', '', '', '', '', '  cpu  ' + renderBar(0.5, 66) + '  50%']);
  const partial: Stats = { ...full, gpu: null, temps: { chip: 64, battery: null, ssd: null } };
  assert.deepEqual(buildMeters(partial).filter((m) => m.group !== 'memory').map((m) => m.label), ['cpu', 'chip temp']);
  assert.deepEqual(renderPanel({ ...full, temps: null }, 80, 12, false), ['', '', ...load, '', ...memory]);
});

test('no swap shows an empty bar and no note', () => {
  const swap = buildMeters({ ...full, memory: { ...full.memory!, swapUsed: 0, swapTotal: 0 } }).find((m) => m.label === 'swap used')!;
  assert.deepEqual([swap.fraction, swap.value, swap.note], [0, '0.00 GB', '']);
});

test('colour never changes the panel layout', () => {
  for (const rows of [4, 12, 14, 20]) {
    assert.deepEqual(renderPanel(full, 80, rows, true).map(stripAnsi), renderPanel(full, 80, rows, false));
  }
});

test('rows run down the clock gradient, with sub-rows dimmed', () => {
  const lines = renderPanel(full, 80, 12, true);
  assert.ok(lines[1].startsWith('  \x1b[38;5;57mcpu'));
  assert.ok(lines[1].endsWith('\x1b[38;5;57m     23%\x1b[0m'));
  assert.ok(lines[4].startsWith('  \x1b[2m\x1b[38;5;63m  app memory'));
  assert.ok(lines[3].endsWith('\x1b[2mof 32.00 GB\x1b[0m'));
  assert.ok(lines[11].startsWith('  \x1b[38;5;87mssd temp'));
  assert.ok(lines[11].endsWith('\x1b[38;5;87m    51°C\x1b[0m'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/panel.test.ts`
Expected: FAIL, cannot find module `../src/panel.ts`.

- [ ] **Step 3: Move `colourBar` from `src/frame.ts` to `src/draw.ts` and export it**

Body unchanged; `frame.ts` imports it. Run `node --test test/frame.test.ts test/draw.test.ts`; expected: all pass as before.

- [ ] **Step 4: Implement `formatGb` and `buildMeters` in `src/panel.ts`**

`formatGb`: bytes ÷ 2³⁰ with 2 decimals below 100, 1 decimal from 100, then ` GB`. `buildMeters` returns the rows that have a reading, in this order:

| label | group | rank | fraction | value | note |
|---|---|---|---|---|---|
| `cpu` | load | 0 | `cpu` | `Math.round(cpu × 100)` + `%` | |
| `gpu` | load | 2 | `gpu` | same as cpu | |
| `memory used` | memory | 1 | used ÷ physical | `formatGb(used)` | `of ` + `formatGb(physical)` |
| `  app memory` | memory | 6 | app ÷ physical | `formatGb(app)` | |
| `  wired memory` | memory | 7 | wired ÷ physical | `formatGb(wired)` | |
| `  compressed` | memory | 8 | compressed ÷ physical | `formatGb(compressed)` | |
| `cached files` | memory | 5 | cached ÷ physical | `formatGb(cached)` | |
| `swap used` | memory | 4 | swapUsed ÷ swapTotal, 0 when swapTotal is 0 | `formatGb(swapUsed)` | `of ` + `formatGb(swapTotal)`, empty when swapTotal is 0 |
| `chip temp` | temperature | 3 | (°C − 20) ÷ 80 | `Math.round(°C)` + `°C` | |
| `battery temp` | temperature | 9 | same | same | |
| `ssd temp` | temperature | 10 | same | same | |

Every fraction is clamped to 0..1. `gpu` is left out when `stats.gpu` is null, the six memory rows when `stats.memory` is null, each temperature row when its reading (or `stats.temps`) is null.

- [ ] **Step 5: Implement `renderPanel(stats: Stats, cols: number, rows: number, color: boolean): string[]` in `src/panel.ts`**

```
budget = rows − 1                       (the first line of the box stays empty)
if budget < 2 → []
shown = buildMeters(stats); if more than budget, keep the budget lowest ranks, still in display order
L, V, N = longest label, value, note among shown
bar = cols − 8 − L − V − (N > 0 ? N + 2 : 0)
if bar < 8: drop all notes (N = 0) and recompute; if still < 8 → []
row = '  ' + label.padEnd(L) + '  ' + BAR + '  ' + value.padStart(V) + (note ? '  ' + note : '')
content = rows of shown; if nothing was dropped and shown + (groups present − 1) ≤ budget,
          put one '' between consecutive groups
return (1 + floor((budget − content.length) / 2)) empty lines, then content
```

With colour: `BAR` is `colourBar(renderBar(fraction, bar), fraction, color)`. Row `i` of the `n` shown rows (gaps not counted) has the colour `GRADIENT[floor(i × GRADIENT.length / n)]`; its padded label and padded value are each `paint`ed with it, a label that starts with a space is additionally wrapped in `dim` (`dim(paint(label))`), and notes go through `dim`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -8 && npm run check`
Expected: `fail 0`, tsc prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/panel.ts src/draw.ts src/frame.ts test/panel.test.ts test/helpers.ts
git commit -m "feat: lay system stats out as a panel of labelled bars"
```

---

### Task 4: Stack the clock above the panel

**Files:**
- Modify: `src/frame.ts`
- Test: `test/frame.test.ts`

**Interfaces:**
- Consumes: `renderPanel` from `src/panel.ts`; `Stats` from `src/stats.ts`; the existing `renderFrame` and `BIG_HEIGHT = 10`.
- Produces:
  ```ts
  export function fitsBig(clock: string, cols: number, rows: number): boolean;
  export function renderDashboard(view: View, stats: Stats | null, cols: number, rows: number, color: boolean): string[];
  ```

- [ ] **Step 1: Write the failing tests** (append to `test/frame.test.ts`; add imports for `renderDashboard` and `fitsBig` from `../src/frame.ts`, `renderPanel` from `../src/panel.ts`, `type Stats` from `../src/stats.ts`, and `fullStats as full` from `./helpers.ts`)

```ts
test('fitsBig needs ten rows and the clock width plus margins', () => {
  assert.equal(fitsBig('03:00', 38, 10), true);
  assert.equal(fitsBig('03:00', 37, 10), false);
  assert.equal(fitsBig('03:00', 80, 9), false);
  assert.equal(fitsBig('1:00:00', 49, 24), false);
});

test('the dashboard gives the clock the upper half and the panel the lower', () => {
  const lines = renderDashboard(timed, full, 80, 24, false);
  assert.equal(lines.length, 24);
  assert.deepEqual(lines.slice(0, 11), renderFrame(timed, 80, 12, false));
  assert.equal(lines[11], '');
  assert.deepEqual(lines.slice(12), renderPanel(full, 80, 12, false));
});

test('under twenty rows the clock keeps its ten and the panel takes the rest', () => {
  const lines = renderDashboard(timed, full, 80, 14, false);
  assert.deepEqual(lines.slice(0, 10), renderFrame(timed, 80, 10, false));
  assert.deepEqual(lines.slice(10), renderPanel(full, 80, 4, false));
  assert.equal(renderDashboard(timed, full, 80, 13, false).length, 13);
});

test('the dashboard is the plain frame when there is no reading or no room', () => {
  assert.deepEqual(renderDashboard(timed, null, 80, 24, false), renderFrame(timed, 80, 24, false));
  assert.deepEqual(renderDashboard(timed, full, 80, 12, false), renderFrame(timed, 80, 12, false));
  assert.deepEqual(renderDashboard(timed, full, 30, 24, false), renderFrame(timed, 30, 24, false));
  assert.deepEqual(renderDashboard(open, full, 37, 24, false), renderFrame(open, 37, 24, false));
});

test('no dashboard is wider or taller than the terminal, at any size', () => {
  const long: View = { ...timed, clock: '100:00:00', caption: 'left · until Mon 09:15' };
  const bare: Stats = { cpu: 1, gpu: null, memory: null, temps: null };
  for (const view of [timed, open, long]) {
    for (const stats of [full, bare]) {
      for (let cols = 1; cols <= 160; cols++) {
        for (let rows = 1; rows <= 40; rows++) {
          const lines = renderDashboard(view, stats, cols, rows, true);
          assert.ok(lines.length <= rows, `${cols}x${rows}: ${lines.length} lines`);
          for (const line of lines) {
            assert.ok(visibleWidth(line) <= cols - 1, `${cols}x${rows}: ${JSON.stringify(stripAnsi(line))}`);
          }
        }
      }
    }
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/frame.test.ts`
Expected: FAIL, `renderDashboard` is not exported.

- [ ] **Step 3: Implement `fitsBig` and `renderDashboard` in `src/frame.ts`**

`fitsBig` is the condition `renderFrame` already uses (`rows >= BIG_HEIGHT && cols >= bigText(clock)[0].length + 4`); `renderFrame` calls it. `renderDashboard`:

```
if stats is null → renderFrame(view, cols, rows, color)
top = max(floor(rows / 2), BIG_HEIGHT)
if !fitsBig(view.clock, cols, top) → renderFrame(view, cols, rows, color)
panel = renderPanel(stats, cols, rows − top, color)
if panel is empty → renderFrame(view, cols, rows, color)
return renderFrame(view, cols, top, color) padded with '' to exactly top lines, then panel
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/frame.test.ts && npm run check`
Expected: 12 tests pass, tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/frame.ts test/frame.test.ts
git commit -m "feat: stack the clock above the system panel"
```

---

### Task 5: Sample in the background and draw the dashboard

**Files:**
- Modify: `src/run.ts`, `src/terminal.ts:68-76`, `README.md`
- Test: `test/run.test.ts`, `test/cli.test.ts:53-63`

**Interfaces:**
- Consumes: `renderDashboard` from `src/frame.ts`; `createStatsReader`, `realStatsIo`, `type Stats` from `src/stats.ts`.
- Produces: `export const STATS_POLL_MS = 2_000;` and a new required field on `Deps`: `readStats: () => Promise<Stats>`.

- [ ] **Step 1: Write the failing tests** (in `test/run.test.ts`)

Import `fullStats as STATS` from `./helpers.ts`. Add to the harness: a counter `statsReads`, the default `readStats: async () => { statsReads += 1; return STATS; }` in `deps`, a `tall: Screen` that is `screen` with `size: () => ({ cols: 80, rows: 24 })`, and `statsReads: () => statsReads` in the returned object. Then:

```ts
test('shows the system panel once the first reading arrives', async () => {
  const h = harness();
  h.deps.screen = h.tall;
  assert.equal(await run(['3s'], h.deps), 0);
  assert.equal(h.frames[0].length, 17);
  assert.equal(h.frames.at(-1)!.length, 24);
  assert.ok(h.frames.at(-1)!.some((line) => line.startsWith('  memory used')));
});

test('samples every two seconds', async () => {
  const h = harness();
  h.deps.screen = h.tall;
  assert.equal(await run(['10s'], h.deps), 0);
  assert.equal(h.statsReads(), 5);
});

test('without a terminal it never samples', async () => {
  const h = harness();
  assert.equal(await run(['10s'], h.deps), 0);
  assert.equal(h.statsReads(), 0);
});

test('a reading that never arrives does not hold up the clock', async () => {
  const h = harness();
  h.deps.screen = h.tall;
  let reads = 0;
  h.deps.readStats = () => { reads += 1; return new Promise(() => {}); };
  assert.equal(await run(['3s'], h.deps), 0);
  assert.equal(h.elapsed(), 3_000);
  assert.equal(reads, 1);
  assert.ok(h.frames.every((frame) => frame.length === 17));
});

test('a failed reading hides the panel and the run carries on', async () => {
  const h = harness();
  h.deps.screen = h.tall;
  let reads = 0;
  h.deps.readStats = async () => { reads += 1; if (reads > 1) throw new Error('boom'); return STATS; };
  assert.equal(await run(['5s'], h.deps), 0);
  assert.ok(h.frames.some((frame) => frame.length === 24));
  assert.equal(h.frames.at(-1)!.length, 17);
  assert.deepEqual(h.err, []);
});
```

In `test/cli.test.ts`, add to "on a terminal it draws on the alternate screen and restores it", after the `entered`/`left` assertion:

```ts
  assert.ok(log.includes('memory used'), 'system panel drawn');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/run.test.ts`
Expected: four of the five new tests fail on their assertions (such as `17 !== 24` and `0 !== 5`). Node strips types without checking them, so the missing `Deps` field is not what fails. "without a terminal it never samples" already passes and must keep passing.

- [ ] **Step 3: Sample in the run loop in `src/run.ts`**

Add `readStats` to `Deps` and `STATS_POLL_MS`. Inside the loop's `if (screen)` block, before drawing: when no read is in flight and `t − lastSample >= STATS_POLL_MS` (the first tick always qualifies), mark one in flight, set `lastSample = t`, and call `deps.readStats()` without awaiting it. When it resolves, store the `Stats`; when it rejects, store `null`; either way clear the in-flight mark. Draw with `renderDashboard(buildView(...), stats, cols, rows, screen.color)` in place of `renderFrame`. The loop itself never awaits a reading.

- [ ] **Step 4: Wire the real reader in `src/terminal.ts`**

In `realDeps()`: `readStats: createStatsReader(realStatsIo())`.

- [ ] **Step 5: Run everything**

Run: `npm test 2>&1 | tail -8 && npm run check`
Expected: `fail 0`, tsc prints nothing. The pty test now also finds `memory used`; it relies on the first reading arriving within its 2 s run (about 0.3 s on this Mac).

- [ ] **Step 6: Look at it**

Run: `node bin/wake.js 20s` in a terminal of at least 80×24, and once more after shrinking the window below 13 rows.
Expected: clock in the upper half; below it `cpu`, `gpu`, the six memory rows and the temperature rows with gradient bars, values changing every 2 s; under 13 rows only the clock, as before; `q` restores the terminal.

- [ ] **Step 7: Document it in `README.md`**

Change the tagline to "Keep this Mac awake, with a countdown and a system panel that fill the terminal." Add a section `## System panel` after `## Usage` saying, in the README's existing plain style: on a terminal with 13 rows or more the lower half shows CPU, GPU, memory and temperature bars, refreshed every 2 seconds; memory is split like Activity Monitor (memory used = app + wired + compressed, plus cached files and swap); nothing needs sudo: CPU from Node, memory from `vm_stat` and `sysctl vm.swapusage`, GPU from `ioreg`, temperatures from a private IOKit call through `osascript` every 10 seconds; temperatures are for Apple silicon (the chip, the battery, the SSD) and rows a Mac cannot report are left out; in the background or piped, wake reads none of this.

- [ ] **Step 8: Commit**

```bash
git add src/run.ts src/terminal.ts test/run.test.ts test/cli.test.ts README.md
git commit -m "feat: show a live system panel under the clock"
```

---

## Amendments after the final review (2026-11-27)

- `Memory` carries `swap: { used: number; total: number } | null` in place of `swapUsed` and `swapTotal`. Swap text that cannot be read gives `swap: null` and the `swap used` row is left out; Task 1 Step 3's "both are 0" showed an invented `0.00 GB`, against this plan's own "nothing is ever shown as 0 or as a guess".
- `src/frame.ts` exports `hasPanelRoom(clock, cols, rows)`. `renderDashboard` uses it, and the run loop samples only while it is true, so a terminal too small for the panel runs no stats commands.
