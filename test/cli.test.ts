import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displaySleepBlockedFor, waitFor } from './helpers.ts';

const BIN = fileURLToPath(new URL('../bin/wake.js', import.meta.url));
const mac = { skip: process.platform !== 'darwin' };

function start(args: string[]) {
  const child = spawn(process.execPath, [BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  return { child, exited, stdout: () => stdout };
}

test('--help prints usage', () => {
  const result = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: wake \[duration\]\n/);
});

test('a bad duration exits 2', () => {
  const result = spawnSync(process.execPath, [BIN, '3x'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, 'wake: "3x" is not a duration. Try 30s, 5m, 2h or 1h30m.\n');
});

test('a 2s timer holds the display awake, then lets go', mac, async () => {
  const w = start(['2s']);
  assert.ok(await waitFor(() => displaySleepBlockedFor(w.child.pid!), 1_500));
  assert.equal(await w.exited, 0);
  const lines = w.stdout().trimEnd().split('\n');
  assert.match(lines[0], /^wake: keeping this Mac awake for 2s, until (\w{3} )?\d\d:\d\d\. Press Ctrl-C to stop\.$/);
  assert.equal(lines[1], 'wake: done after 2s. Your Mac can sleep again.');
  assert.ok(await waitFor(() => !displaySleepBlockedFor(w.child.pid!), 2_000));
});

test('SIGINT stops an open-ended run', mac, async () => {
  const w = start([]);
  assert.ok(await waitFor(() => w.stdout().includes('keeping this Mac awake'), 2_000));
  w.child.kill('SIGINT');
  assert.equal(await w.exited, 0);
  assert.match(w.stdout(), /wake: stopped after \d+s\. Your Mac can sleep again\.\n$/);
  assert.ok(await waitFor(() => !displaySleepBlockedFor(w.child.pid!), 2_000));
});

test('on a terminal it draws on the alternate screen and restores it', mac, () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wake-')), 'pty.out');
  const result = spawnSync('script', ['-q', file, process.execPath, BIN, '2s'], { stdio: 'ignore', timeout: 10_000 });
  assert.equal(result.status, 0);
  const log = readFileSync(file, 'utf8');
  const entered = log.indexOf('\x1b[?1049h');
  const left = log.lastIndexOf('\x1b[?1049l');
  assert.ok(entered >= 0 && left > entered, 'entered and left the alternate screen');
  assert.ok(log.lastIndexOf('\x1b[?25h') > entered, 'cursor shown again');
  assert.ok(log.indexOf('wake: done after 2s.') > left, 'summary printed after leaving');
});
