import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, HELP } from '../src/args.ts';

test('no arguments means stay awake until stopped', () => {
  assert.deepEqual(parseArgs([]), { kind: 'run', durationMs: null });
});

test('a duration sets a timer, even split over several arguments', () => {
  assert.deepEqual(parseArgs(['3m']), { kind: 'run', durationMs: 180_000 });
  assert.deepEqual(parseArgs(['1h', '30m']), { kind: 'run', durationMs: 5_400_000 });
});

test('help flags win wherever they are', () => {
  for (const argv of [['-h'], ['--help'], ['3m', '--help']]) {
    assert.deepEqual(parseArgs(argv), { kind: 'help' });
  }
});

test('bad input says what is wrong', () => {
  assert.deepEqual(parseArgs(['3x']), { kind: 'error', message: 'wake: "3x" is not a duration. Try 30s, 5m, 2h or 1h30m.' });
  assert.deepEqual(parseArgs(['--forever']), { kind: 'error', message: 'wake: unknown option "--forever". Run wake --help.' });
  assert.deepEqual(parseArgs(['-3m']), { kind: 'error', message: 'wake: unknown option "-3m". Run wake --help.' });
});

test('HELP starts with the usage line', () => {
  assert.match(HELP, /^Usage: wake \[duration\]\n/);
});
