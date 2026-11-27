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
  const swap = buildMeters({ ...full, memory: { ...full.memory!, swap: { used: 0, total: 0 } } }).find((m) => m.label === 'swap used')!;
  assert.deepEqual([swap.fraction, swap.value, swap.note], [0, '0.00 GB', '']);
});

test('swap that could not be read leaves its row out', () => {
  const labels = buildMeters({ ...full, memory: { ...full.memory!, swap: null } }).map((m) => m.label);
  assert.deepEqual(labels.filter((label) => !label.endsWith('temp')), [
    'cpu', 'gpu', 'memory used', '  app memory', '  wired memory', '  compressed', 'cached files',
  ]);
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
