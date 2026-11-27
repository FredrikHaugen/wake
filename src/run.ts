import { HELP, parseArgs } from './args.ts';
import { LOW_BATTERY_PERCENT, batteryLabel, isBatteryLow, type Battery } from './battery.ts';
import { formatClock, formatEndTime, formatHuman } from './duration.ts';
import { renderDashboard, type View } from './frame.ts';
import type { KeepAwake } from './keep-awake.ts';
import type { Stats } from './stats.ts';

export const TICK_MS = 100;
export const BATTERY_POLL_MS = 30_000;
export const STATS_POLL_MS = 2_000;

export type StopReason = 'done' | 'stopped' | 'battery' | 'lost';

export type Screen = {
  color: boolean;
  size(): { cols: number; rows: number };
  enter(): void;
  draw(lines: string[]): void;
  leave(): void;
};

export type Deps = {
  platform: string;
  now: () => number;
  wait: (ms: number) => Promise<void>;
  readBattery: () => Promise<Battery | null>;
  readStats: () => Promise<Stats>;
  keepAwake: () => KeepAwake;
  screen: Screen | null;
  print: (line: string) => void;
  printError: (line: string) => void;
  onStopRequest: (handler: () => void) => () => void;
};

export function buildView(
  now: number,
  start: number,
  end: number | null,
  tick: number,
  battery: Battery | null,
): View {
  const status = [batteryLabel(battery), 'q to stop'].filter((part) => part !== '').join(' · ');
  if (end === null) {
    return {
      clock: formatClock(Math.floor((now - start) / 1000)),
      caption: 'awake · until you stop it',
      fraction: null,
      tick,
      status,
    };
  }
  const fraction = Math.min(1, Math.max(0, (now - start) / (end - start)));
  return {
    clock: formatClock(Math.ceil(Math.max(0, end - now) / 1000)),
    caption: `left · until ${formatEndTime(end, now)}`,
    fraction,
    tick,
    status,
  };
}

function startMessage(durationMs: number | null, start: number, end: number | null): string {
  if (durationMs === null || end === null) {
    return `wake: keeping this Mac awake until you stop it or the battery drops to ${LOW_BATTERY_PERCENT}%. Press Ctrl-C to stop.`;
  }
  return `wake: keeping this Mac awake for ${formatHuman(durationMs / 1000)}, until ${formatEndTime(end, start)}. Press Ctrl-C to stop.`;
}

export async function run(argv: string[], deps: Deps): Promise<number> {
  const command = parseArgs(argv);
  if (command.kind === 'help') {
    deps.print(HELP);
    return 0;
  }
  if (command.kind === 'error') {
    deps.printError(command.message);
    return 2;
  }
  if (deps.platform !== 'darwin') {
    deps.printError('wake: needs macOS (it uses caffeinate).');
    return 1;
  }

  let battery = await deps.readBattery();
  if (isBatteryLow(battery)) {
    deps.printError(`wake: battery is at ${battery.percent}%. Plug in to keep this Mac awake.`);
    return 1;
  }

  let keeper: KeepAwake;
  try {
    keeper = deps.keepAwake();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.printError(`wake: could not start caffeinate: ${message}`);
    return 1;
  }

  const { durationMs } = command;
  const start = deps.now();
  const end = durationMs === null ? null : start + durationMs;
  let stopRequested = false;
  const screen = deps.screen;
  let unsubscribe: (() => void) | undefined;

  let reason: StopReason;
  try {
    unsubscribe = deps.onStopRequest(() => {
      stopRequested = true;
    });
    if (screen) screen.enter();
    else deps.print(startMessage(durationMs, start, end));

    let tick = 0;
    let lastPoll = start;
    let stats: Stats | null = null;
    let sampling = false;
    let lastSample = -Infinity;
    for (;;) {
      const t = deps.now();
      let found: StopReason | null = null;
      if (stopRequested) found = 'stopped';
      else if (!keeper.alive()) found = 'lost';
      else if (end !== null && t >= end) found = 'done';
      else if (t - lastPoll >= BATTERY_POLL_MS) {
        battery = await deps.readBattery();
        lastPoll = t;
        if (isBatteryLow(battery)) found = 'battery';
      }
      if (found !== null) {
        reason = found;
        break;
      }
      if (screen) {
        // Readings arrive in the background: the loop never waits on one, so a
        // slow or hung command cannot stall the clock. Without a screen none are taken.
        if (!sampling && t - lastSample >= STATS_POLL_MS) {
          sampling = true;
          lastSample = t;
          deps.readStats().then(
            (reading) => { stats = reading; },
            () => { stats = null; },
          ).finally(() => { sampling = false; });
        }
        const { cols, rows } = screen.size();
        screen.draw(renderDashboard(buildView(t, start, end, tick, battery), stats, cols, rows, screen.color));
      }
      tick += 1;
      await deps.wait(TICK_MS);
    }
  } finally {
    keeper.stop();
    unsubscribe?.();
    screen?.leave();
  }

  const elapsed = formatHuman((deps.now() - start) / 1000);
  switch (reason) {
    case 'done':
      deps.print(`wake: done after ${elapsed}. Your Mac can sleep again.`);
      return 0;
    case 'stopped':
      deps.print(`wake: stopped after ${elapsed}. Your Mac can sleep again.`);
      return 0;
    case 'battery':
      deps.print(`wake: battery at ${battery?.percent}%, stopped after ${elapsed}. Your Mac can sleep again.`);
      return 0;
    case 'lost':
      deps.printError(`wake: caffeinate quit unexpectedly after ${elapsed}. Your Mac can sleep again.`);
      return 1;
  }
}
