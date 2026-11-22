import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatClock, formatHuman, formatEndTime } from '../src/duration.ts';

test('parseDuration reads single units', () => {
  assert.equal(parseDuration('30s'), 30_000);
  assert.equal(parseDuration('3m'), 180_000);
  assert.equal(parseDuration('2h'), 7_200_000);
  assert.equal(parseDuration('1d'), 86_400_000);
});

test('parseDuration combines units and accepts decimals, any case and spaces', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('1.5h'), 5_400_000);
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('3M'), 180_000);
  assert.equal(parseDuration(' 1h 30m '), 5_400_000);
});

test('parseDuration rejects anything that is not a positive duration', () => {
  for (const bad of ['', '3', '3x', 'm', '-3m', '0s', '0h0m', '1.5.5h', '.5h', 'h1']) {
    assert.equal(parseDuration(bad), null, bad);
  }
});

test('formatClock shows MM:SS under an hour and H:MM:SS above', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(245), '04:05');
  assert.equal(formatClock(3599), '59:59');
  assert.equal(formatClock(3600), '1:00:00');
  assert.equal(formatClock(43_445), '12:04:05');
  assert.equal(formatClock(360_000), '100:00:00');
  assert.equal(formatClock(-5), '00:00');
});

test('formatHuman drops zero parts', () => {
  assert.equal(formatHuman(0), '0s');
  assert.equal(formatHuman(45), '45s');
  assert.equal(formatHuman(45.9), '45s');
  assert.equal(formatHuman(180), '3m');
  assert.equal(formatHuman(252), '4m 12s');
  assert.equal(formatHuman(3600), '1h');
  assert.equal(formatHuman(4320), '1h 12m');
  assert.equal(formatHuman(90_061), '1d 1h 1m 1s');
});

test('formatEndTime shows the clock time, with a weekday when it is not today', () => {
  const now = new Date(2026, 10, 22, 21, 4, 30).getTime(); // a Sunday
  assert.equal(formatEndTime(now + 3 * 60_000, now), '21:07');
  assert.equal(formatEndTime(new Date(2026, 10, 22, 9, 5).getTime(), now), '09:05');
  assert.equal(formatEndTime(new Date(2026, 10, 23, 9, 15).getTime(), now), 'Mon 09:15');
});
