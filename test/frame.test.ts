import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFrame, frameUpdate, type View } from '../src/frame.ts';
import { bigText, renderBar, renderSweep, stripAnsi, visibleWidth } from '../src/draw.ts';

const timed: View = { clock: '03:00', caption: 'left · until 21:07', fraction: 0.42, tick: 0, status: 'plugged in 90% · q to stop' };
const open: View = { clock: '12:34', caption: 'awake · until you stop it', fraction: null, tick: 7, status: 'q to stop' };

test('big layout centres the clock and runs the bar across the terminal', () => {
  const lines = renderFrame(timed, 80, 24, false);
  const big = bigText('03:00');
  assert.equal(lines.length, 17);
  for (let r = 0; r < 5; r++) assert.equal(lines[7 + r], ' '.repeat(23) + big[r]);
  assert.equal(lines[12], '');
  assert.equal(lines[13], ' '.repeat(31) + 'left · until 21:07');
  assert.equal(lines[14], '');
  assert.equal(lines[15], '  ' + renderBar(0.42, 76));
  assert.equal(lines[16], '  42%' + ' '.repeat(47) + 'plugged in 90% · q to stop');
});

test('open-ended big layout shows the sweep and no percentage', () => {
  const lines = renderFrame(open, 80, 24, false);
  assert.equal(lines[15], '  ' + renderSweep(7, 76));
  assert.equal(lines[16], ' '.repeat(69) + 'q to stop');
});

test('compact layout is one line when the terminal is short or narrow', () => {
  assert.deepEqual(renderFrame(timed, 60, 9, false), [' 03:00 ' + renderBar(0.42, 47) + '  42%']);
  assert.deepEqual(renderFrame(timed, 30, 24, false), [' 03:00 ' + renderBar(0.42, 17) + '  42%']);
  assert.deepEqual(renderFrame(open, 40, 5, false), [' 12:34 ' + renderSweep(7, 32)]);
  assert.deepEqual(renderFrame(timed, 6, 1, false), [' 03:0']);
});

test('no frame is wider or taller than the terminal, at any size', () => {
  const long: View = { ...timed, clock: '100:00:00', caption: 'left · until Mon 09:15' };
  for (const view of [timed, open, long]) {
    for (let cols = 1; cols <= 160; cols++) {
      for (let rows = 1; rows <= 40; rows++) {
        const lines = renderFrame(view, cols, rows, true);
        assert.ok(lines.length <= rows, `${cols}x${rows}: ${lines.length} lines`);
        for (const line of lines) {
          assert.ok(visibleWidth(line) <= cols - 1, `${cols}x${rows}: ${JSON.stringify(stripAnsi(line))}`);
        }
      }
    }
  }
});

test('colour never changes the layout', () => {
  for (const [cols, rows] of [[80, 24], [60, 9], [120, 40]]) {
    for (const view of [timed, open]) {
      assert.deepEqual(renderFrame(view, cols, rows, true).map(stripAnsi), renderFrame(view, cols, rows, false));
    }
  }
});

test('frameUpdate redraws everything the first time and when the line count changes', () => {
  assert.equal(frameUpdate(null, ['a', 'b']), '\x1b[Ha\x1b[K\r\nb\x1b[K\x1b[J');
  assert.equal(frameUpdate(['a', 'b'], ['a']), '\x1b[Ha\x1b[K\x1b[J');
});

test('frameUpdate rewrites only the lines that changed', () => {
  assert.equal(frameUpdate(['a', 'b'], ['a', 'b']), '');
  assert.equal(frameUpdate(['a', 'b', 'c'], ['a', 'x', 'y']), '\x1b[2;1Hx\x1b[K\x1b[3;1Hy\x1b[K');
});
