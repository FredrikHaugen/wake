import { parseDuration } from './duration.ts';

export type Command =
  | { kind: 'help' }
  | { kind: 'run'; durationMs: number | null }
  | { kind: 'error'; message: string };

export const HELP = `Usage: wake [duration]

Keep this Mac awake: no sleep, no screen saver, no auto-lock.

  wake          until you stop it
  wake 30s      for 30 seconds
  wake 3m       for 3 minutes
  wake 2h       for 2 hours
  wake 1h30m    units combine: s, m, h, d

Press q or Ctrl-C to stop. Unplugged, wake also stops when the
battery drops to 10%.`;

export function parseArgs(argv: string[]): Command {
  if (argv.includes('-h') || argv.includes('--help')) return { kind: 'help' };

  const option = argv.find((arg) => arg.startsWith('-'));
  if (option !== undefined) {
    return { kind: 'error', message: `wake: unknown option "${option}". Run wake --help.` };
  }

  if (argv.length === 0) return { kind: 'run', durationMs: null };

  const text = argv.join(' ');
  const durationMs = parseDuration(text);
  if (durationMs === null) {
    return { kind: 'error', message: `wake: "${text}" is not a duration. Try 30s, 5m, 2h or 1h30m.` };
  }
  return { kind: 'run', durationMs };
}
