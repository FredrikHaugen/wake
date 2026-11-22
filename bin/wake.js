#!/usr/bin/env node
import { run } from '../src/run.ts';
import { realDeps } from '../src/terminal.ts';

try {
  // process.exit is safe here: summaries go out through writeSync, so nothing is pending.
  process.exit(await run(process.argv.slice(2), realDeps()));
} catch (error) {
  process.stderr.write(`wake: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
