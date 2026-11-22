import { spawn } from 'node:child_process';

export type KeepAwake = { alive(): boolean; stop(): void };

export function caffeinateArgs(pid: number): string[] {
  return ['-d', '-i', '-m', '-s', '-u', '-w', String(pid)];
}

export function startKeepAwake(): KeepAwake {
  const child = spawn('caffeinate', caffeinateArgs(process.pid), { stdio: 'ignore' });
  let running = true;
  child.on('error', () => {
    running = false;
  });
  child.on('exit', () => {
    running = false;
  });
  return {
    alive: () => running,
    stop: () => {
      if (running) child.kill('SIGTERM');
    },
  };
}
