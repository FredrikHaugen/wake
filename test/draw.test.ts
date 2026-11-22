import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBar, renderSweep, bigText, paint, dim, stripAnsi, visibleWidth } from '../src/draw.ts';

test('renderBar fills whole cells, then eighths, then track', () => {
  assert.equal(renderBar(0, 10), '░'.repeat(10));
  assert.equal(renderBar(0.5, 10), '█████░░░░░');
  assert.equal(renderBar(0.55, 10), '█████▌░░░░');
  assert.equal(renderBar(0.99, 10), '█████████▉');
  assert.equal(renderBar(1, 10), '█'.repeat(10));
  assert.equal(renderBar(0.25, 8), '██░░░░░░');
});

test('renderBar clamps and handles zero width', () => {
  assert.equal(renderBar(-1, 4), '░░░░');
  assert.equal(renderBar(2, 4), '████');
  assert.equal(renderBar(0.5, 0), '');
});

test('renderSweep moves a comet across and wraps', () => {
  assert.equal(renderSweep(0, 10), '░'.repeat(10));
  assert.equal(renderSweep(5, 10), '▒▓█▓▒░░░░░');
  assert.equal(renderSweep(7, 10), '░░▒▓█▓▒░░░');
  assert.equal(renderSweep(13, 10), '░░░░░░░░▒▓');
  assert.equal(renderSweep(15, 10), '░'.repeat(10));
});

test('bigText draws 5-row glyphs from the font', () => {
  assert.deepEqual(bigText('0'), ['██████', '██  ██', '██  ██', '██  ██', '██████']);
  assert.deepEqual(bigText('1'), ['  ██  ', '████  ', '  ██  ', '  ██  ', '██████']);
  assert.deepEqual(bigText(':'), ['  ', '██', '  ', '██', '  ']);
});

test('bigText separates glyphs with two spaces and keeps rows equal', () => {
  assert.equal(bigText('10')[0], '  ██  ' + '  ' + '██████');
  for (const [text, width] of [['10:00', 34], ['1:00:00', 46]] as const) {
    const rows = bigText(text);
    assert.equal(rows.length, 5);
    for (const row of rows) assert.equal(row.length, width);
  }
});

test('colour helpers add 256-colour codes only when enabled', () => {
  assert.equal(paint('x', 45, true), '\x1b[38;5;45mx\x1b[0m');
  assert.equal(paint('x', 45, false), 'x');
  assert.equal(dim('x', true), '\x1b[2mx\x1b[0m');
  assert.equal(stripAnsi(dim(paint('abc', 45, true), true)), 'abc');
  assert.equal(visibleWidth(paint('abc', 45, true)), 3);
});
