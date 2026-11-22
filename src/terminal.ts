import { writeSync } from 'node:fs';
import { readBattery } from './battery.ts';
import { frameUpdate } from './frame.ts';
import { startKeepAwake } from './keep-awake.ts';
import type { Deps, Screen } from './run.ts';

export type Out = {
  columns?: number;
  rows?: number;
  write(chunk: string): unknown;
  on(event: 'resize', listener: () => void): unknown;
};

export type In = { isTTY?: boolean; setRawMode?(mode: boolean): unknown };

export function createScreen(out: Out, input: In, env: Record<string, string | undefined>): Screen {
  let previous: string[] | null = null;
  let entered = false;
  let raw = false;

  out.on('resize', () => { previous = null; });

  function leave(): void {
    if (!entered) return;
    entered = false;
    out.write('\x1b[?25h\x1b[?1049l');
    if (raw) {
      raw = false;
      input.setRawMode?.(false);
    }
    previous = null;
  }

  return {
    color: !env.NO_COLOR,
    size: () => ({ cols: out.columns || 80, rows: out.rows || 24 }),
    enter() {
      // Counts as entered once the sequence is written, so a failed raw mode still gets restored.
      entered = true;
      out.write('\x1b[?1049h\x1b[?25l');
      if (input.isTTY) {
        input.setRawMode?.(true);
        raw = true;
      }
      process.once('exit', leave);
    },
    draw(lines) {
      const update = frameUpdate(previous, lines);
      if (update !== '') out.write(update);
      previous = lines;
    },
    leave,
  };
}

export function isStopKey(chunk: string): boolean {
  return chunk.includes('\x03') || chunk === 'q' || chunk === 'Q';
}

function writeLine(fd: number, line: string): void {
  try {
    writeSync(fd, `${line}\n`);
  } catch {
    // The terminal may be gone after SIGHUP.
  }
}

export function realDeps(): Deps {
  return {
    platform: process.platform,
    now: Date.now,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readBattery,
    keepAwake: startKeepAwake,
    screen: process.stdout.isTTY ? createScreen(process.stdout, process.stdin, process.env) : null,
    print: (line) => writeLine(1, line),
    printError: (line) => writeLine(2, line),
    onStopRequest(handler) {
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
      for (const signal of signals) process.on(signal, handler);
      const onData = (chunk: string) => { if (isStopKey(chunk)) handler(); };
      if (process.stdin.isTTY) {
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', onData);
        process.stdin.resume();
      }
      return () => {
        for (const signal of signals) process.off(signal, handler);
        process.stdin.off('data', onData);
        if (process.stdin.isTTY) process.stdin.pause();
      };
    },
  };
}
