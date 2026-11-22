import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBattery, isBatteryLow, batteryLabel, readBattery } from '../src/battery.ts';

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=36569187)\t90%; AC attached; not charging present: true\n";
const UNPLUGGED = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=36569187)\t9%; discharging; 0:21 remaining present: true\n";
const DESKTOP = "Now drawing from 'AC Power'\n";

test('parseBattery reads charge and power source', () => {
  assert.deepEqual(parseBattery(AC), { percent: 90, onBattery: false });
  assert.deepEqual(parseBattery(UNPLUGGED), { percent: 9, onBattery: true });
});

test('parseBattery returns null without a battery or output', () => {
  assert.equal(parseBattery(DESKTOP), null);
  assert.equal(parseBattery(''), null);
});

test('only an unplugged battery at 10% or less is low', () => {
  assert.equal(isBatteryLow({ percent: 10, onBattery: true }), true);
  assert.equal(isBatteryLow({ percent: 11, onBattery: true }), false);
  assert.equal(isBatteryLow({ percent: 5, onBattery: false }), false);
  assert.equal(isBatteryLow(null), false);
});

test('batteryLabel', () => {
  assert.equal(batteryLabel(null), '');
  assert.equal(batteryLabel({ percent: 54, onBattery: true }), 'on battery 54%');
  assert.equal(batteryLabel({ percent: 90, onBattery: false }), 'plugged in 90%');
});

test('readBattery returns a reading or null', { skip: process.platform !== 'darwin' }, async () => {
  const battery = await readBattery();
  if (battery !== null) {
    assert.ok(Number.isInteger(battery.percent) && battery.percent >= 0 && battery.percent <= 100);
  }
});
