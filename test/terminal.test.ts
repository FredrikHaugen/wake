import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScreen, isStopKey, type Out } from '../src/terminal.ts';

function fakeOut(columns = 0, rows = 0) {
  const writes: string[] = [];
  let onResize = () => {};
  const out: Out = { columns, rows, write: (chunk) => writes.push(chunk), on: (_event, listener) => { onResize = listener; } };
  return { out, writes, resize: () => onResize() };
}

test('size falls back to 80x24 when the terminal reports 0', () => {
  assert.deepEqual(createScreen(fakeOut().out, {}, {}).size(), { cols: 80, rows: 24 });
  assert.deepEqual(createScreen(fakeOut(120, 40).out, {}, {}).size(), { cols: 120, rows: 40 });
});

test('colour is on unless NO_COLOR is set to something', () => {
  assert.equal(createScreen(fakeOut().out, {}, {}).color, true);
  assert.equal(createScreen(fakeOut().out, {}, { NO_COLOR: '' }).color, true);
  assert.equal(createScreen(fakeOut().out, {}, { NO_COLOR: '1' }).color, false);
});

test('enter and leave use the alternate screen, and leave is safe to repeat', () => {
  const f = fakeOut();
  const screen = createScreen(f.out, {}, {});
  screen.leave();
  screen.enter();
  screen.draw(['a']);
  screen.leave();
  screen.leave();
  assert.deepEqual(f.writes, ['\x1b[?1049h\x1b[?25l', '\x1b[Ha\x1b[K\x1b[J', '\x1b[?25h\x1b[?1049l']);
});

test('draw sends only changed lines, nothing when unchanged, and redraws fully after a resize', () => {
  const f = fakeOut();
  const screen = createScreen(f.out, {}, {});
  screen.enter();
  screen.draw(['a', 'b']);
  screen.draw(['a', 'c']);
  screen.draw(['a', 'c']);
  f.resize();
  screen.draw(['a', 'c']);
  assert.deepEqual(f.writes.slice(2), ['\x1b[2;1Hc\x1b[K', '\x1b[Ha\x1b[K\r\nc\x1b[K\x1b[J']);
});

test('raw mode is switched on with the screen and off again', () => {
  const modes: boolean[] = [];
  const screen = createScreen(fakeOut().out, { isTTY: true, setRawMode: (mode) => modes.push(mode) }, {});
  screen.enter();
  screen.leave();
  assert.deepEqual(modes, [true, false]);
});

test('q and Ctrl-C stop; Ctrl-D, arrows and typing do not', () => {
  for (const key of ['q', 'Q', '\x03', 'a\x03']) assert.equal(isStopKey(key), true, JSON.stringify(key));
  for (const key of ['\x04', 'a', '\x1b[A', '\x1bOQ', 'xq', '']) assert.equal(isStopKey(key), false, JSON.stringify(key));
});
