import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { caffeinateArgs, startKeepAwake } from '../src/keep-awake.ts';
import { displaySleepBlockedFor, waitFor } from './helpers.ts';

const mac = { skip: process.platform !== 'darwin' };

test('caffeinate gets the display, idle, disk, system and user flags, tied to our pid', () => {
  assert.deepEqual(caffeinateArgs(4242), ['-d', '-i', '-m', '-s', '-u', '-w', '4242']);
});

test('startKeepAwake blocks display sleep until stopped', mac, async () => {
  const keeper = startKeepAwake();
  assert.ok(await waitFor(() => displaySleepBlockedFor(process.pid), 2_000));
  assert.equal(keeper.alive(), true);
  keeper.stop();
  assert.ok(await waitFor(() => !keeper.alive() && !displaySleepBlockedFor(process.pid), 2_000));
});

test('caffeinate exits when wake is killed with SIGKILL', mac, async () => {
  const module = new URL('../src/keep-awake.ts', import.meta.url).href;
  const child = spawn(process.execPath, [
    '--input-type=module', '-e',
    `import { startKeepAwake } from ${JSON.stringify(module)}; startKeepAwake(); setInterval(() => {}, 1000);`,
  ], { stdio: 'ignore' });
  assert.ok(await waitFor(() => displaySleepBlockedFor(child.pid!), 3_000));
  child.kill('SIGKILL');
  assert.ok(await waitFor(() => !displaySleepBlockedFor(child.pid!), 3_000));
});
