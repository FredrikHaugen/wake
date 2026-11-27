import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, buildView, type Deps, type Screen } from '../src/run.ts';
import { renderBar } from '../src/draw.ts';
import type { Battery } from '../src/battery.ts';
import { fullStats as STATS } from './helpers.ts';

const START = new Date(2026, 10, 22, 21, 4, 0).getTime();

function harness() {
  let clock = START;
  let requestStop = () => {};
  let statsReads = 0;
  const out: string[] = [];
  const err: string[] = [];
  const events: string[] = [];
  const frames: string[][] = [];
  const deps: Deps = {
    platform: 'darwin',
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    readBattery: async () => ({ percent: 90, onBattery: false }),
    readStats: async () => { statsReads += 1; return STATS; },
    keepAwake: () => {
      events.push('keepAwake');
      return { alive: () => true, stop: () => { events.push('keeper.stop'); } };
    },
    screen: null,
    print: (line) => { out.push(line); },
    printError: (line) => { err.push(line); },
    onStopRequest: (handler) => { requestStop = handler; return () => { events.push('unsubscribe'); }; },
  };
  const screen: Screen = {
    color: false,
    size: () => ({ cols: 60, rows: 1 }),
    enter: () => { events.push('enter'); },
    draw: (lines) => { frames.push(lines); },
    leave: () => { events.push('leave'); },
  };
  const tall: Screen = { ...screen, size: () => ({ cols: 80, rows: 24 }) };
  return {
    deps, screen, tall, out, err, events, frames,
    statsReads: () => statsReads,
    elapsed: () => clock - START,
    advance: (ms: number) => { clock += ms; },
    stop: () => requestStop(),
  };
}

test('help prints usage and does not keep the Mac awake', async () => {
  const h = harness();
  assert.equal(await run(['--help'], h.deps), 0);
  assert.match(h.out[0], /^Usage: wake/);
  assert.deepEqual(h.events, []);
});

test('a bad duration exits 2 with the reason on stderr', async () => {
  const h = harness();
  assert.equal(await run(['3x'], h.deps), 2);
  assert.deepEqual(h.err, ['wake: "3x" is not a duration. Try 30s, 5m, 2h or 1h30m.']);
});

test('refuses to run anywhere but macOS', async () => {
  const h = harness();
  h.deps.platform = 'linux';
  assert.equal(await run([], h.deps), 1);
  assert.deepEqual(h.err, ['wake: needs macOS (it uses caffeinate).']);
  assert.deepEqual(h.events, []);
});

test('refuses to start on a nearly empty battery', async () => {
  const h = harness();
  h.deps.readBattery = async () => ({ percent: 8, onBattery: true });
  assert.equal(await run(['3m'], h.deps), 1);
  assert.deepEqual(h.err, ['wake: battery is at 8%. Plug in to keep this Mac awake.']);
  assert.deepEqual(h.events, []);
});

test('a timer runs to the end and lets the Mac sleep again', async () => {
  const h = harness();
  assert.equal(await run(['3m'], h.deps), 0);
  assert.deepEqual(h.out, [
    'wake: keeping this Mac awake for 3m, until 21:07. Press Ctrl-C to stop.',
    'wake: done after 3m. Your Mac can sleep again.',
  ]);
  assert.equal(h.elapsed(), 180_000);
  assert.deepEqual(h.events, ['keepAwake', 'keeper.stop', 'unsubscribe']);
});

test('without a duration it runs until asked to stop', async () => {
  const h = harness();
  h.deps.wait = async (ms) => { h.advance(ms); if (h.elapsed() >= 5_000) h.stop(); };
  assert.equal(await run([], h.deps), 0);
  assert.deepEqual(h.out, [
    'wake: keeping this Mac awake until you stop it or the battery drops to 10%. Press Ctrl-C to stop.',
    'wake: stopped after 5s. Your Mac can sleep again.',
  ]);
});

test('stops when the battery runs low while unplugged', async () => {
  const h = harness();
  const readings: Battery[] = [{ percent: 90, onBattery: false }];
  h.deps.readBattery = async () => readings.shift() ?? { percent: 9, onBattery: true };
  assert.equal(await run([], h.deps), 0);
  assert.equal(h.out[1], 'wake: battery at 9%, stopped after 30s. Your Mac can sleep again.');
});

test('runs on a Mac without a battery', async () => {
  const h = harness();
  h.deps.readBattery = async () => null;
  assert.equal(await run(['3s'], h.deps), 0);
  assert.equal(h.out[1], 'wake: done after 3s. Your Mac can sleep again.');
});

test('reports when caffeinate dies', async () => {
  const h = harness();
  h.deps.keepAwake = () => ({ alive: () => h.elapsed() < 2_000, stop: () => {} });
  assert.equal(await run([], h.deps), 1);
  assert.deepEqual(h.err, ['wake: caffeinate quit unexpectedly after 2s. Your Mac can sleep again.']);
});

test('reports when caffeinate cannot start', async () => {
  const h = harness();
  h.deps.keepAwake = () => { throw new Error('spawn EPERM'); };
  assert.equal(await run([], h.deps), 1);
  assert.deepEqual(h.err, ['wake: could not start caffeinate: spawn EPERM']);
});

test('follows the wall clock if the Mac slept anyway', async () => {
  const h = harness();
  let waits = 0;
  h.deps.wait = async (ms) => { waits += 1; h.advance(waits === 3 ? 600_000 : ms); };
  assert.equal(await run(['3m'], h.deps), 0);
  assert.equal(h.out[1], 'wake: done after 10m. Your Mac can sleep again.');
});

test('draws frames on a terminal and restores it afterwards', async () => {
  const h = harness();
  h.deps.screen = h.screen;
  assert.equal(await run(['3m'], h.deps), 0);
  assert.deepEqual(h.frames[0], [' 03:00 ' + renderBar(0, 47) + '   0%']);
  assert.deepEqual(h.out, ['wake: done after 3m. Your Mac can sleep again.']);
  assert.deepEqual(h.events, ['keepAwake', 'enter', 'keeper.stop', 'unsubscribe', 'leave']);
});

test('an error mid-run still stops caffeinate and restores the terminal', async () => {
  const h = harness();
  h.deps.screen = h.screen;
  let reads = 0;
  h.deps.readBattery = async () => { reads += 1; if (reads > 1) throw new Error('boom'); return null; };
  await assert.rejects(run([], h.deps), /boom/);
  assert.deepEqual(h.events.slice(-3), ['keeper.stop', 'unsubscribe', 'leave']);
});

test('a failing terminal setup still stops caffeinate and restores the terminal', async () => {
  const h = harness();
  h.deps.screen = { ...h.screen, enter: () => { h.events.push('enter'); throw new Error('no tty'); } };
  await assert.rejects(run([], h.deps), /no tty/);
  assert.deepEqual(h.events.slice(-3), ['keeper.stop', 'unsubscribe', 'leave']);
});

test('buildView counts down with a timer and up without one', () => {
  assert.deepEqual(buildView(START + 45_500, START, START + 180_000, 3, { percent: 90, onBattery: false }), {
    clock: '02:15', caption: 'left · until 21:07', fraction: 45_500 / 180_000, tick: 3, status: 'plugged in 90% · q to stop',
  });
  assert.deepEqual(buildView(START + 45_500, START, null, 3, null), {
    clock: '00:45', caption: 'awake · until you stop it', fraction: null, tick: 3, status: 'q to stop',
  });
});

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

test('on a terminal too small for the panel it never samples', async () => {
  for (const [cols, rows] of [[80, 12], [80, 5], [30, 40]]) {
    const h = harness();
    h.deps.screen = { ...h.screen, size: () => ({ cols, rows }) };
    assert.equal(await run(['10s'], h.deps), 0);
    assert.equal(h.statsReads(), 0, `${cols}x${rows}`);
  }
});

test('sampling starts once the terminal grows enough for the panel', async () => {
  const h = harness();
  let rows = 12;
  h.deps.screen = { ...h.screen, size: () => ({ cols: 80, rows }) };
  h.deps.wait = async (ms) => { h.advance(ms); if (h.elapsed() >= 3_000) rows = 24; };
  assert.equal(await run(['5s'], h.deps), 0);
  assert.equal(h.statsReads(), 1);
  assert.equal(h.frames.at(-1)!.length, 24);
});
