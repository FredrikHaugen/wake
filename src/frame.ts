import { GRADIENT, bigText, dim, paint, renderBar, renderSweep } from './draw.ts';

export type View = {
  clock: string;
  caption: string;
  fraction: number | null;
  tick: number;
  status: string;
};

const BIG_HEIGHT = 10;

function percent(fraction: number): string {
  return Math.floor(fraction * 100) + '%';
}

// Colours a bar or sweep by runs of cells: filled cells take their gradient
// colour, the comet takes the last one, and the `░` track is dimmed.
function colourBar(bar: string, fraction: number | null, color: boolean): string {
  if (!color) return bar;
  const cells = [...bar];
  let out = '';
  let run = '';
  let runKey: number | null = null;
  const flush = () => {
    if (run === '') return;
    out += runKey === null ? dim(run, true) : paint(run, runKey, true);
    run = '';
  };
  cells.forEach((cell, i) => {
    const key =
      cell === '░'
        ? null
        : fraction === null
          ? GRADIENT[GRADIENT.length - 1]
          : GRADIENT[Math.floor((i * GRADIENT.length) / cells.length)];
    if (key !== runKey) flush();
    runKey = key;
    run += cell;
  });
  flush();
  return out;
}

function makeBar(view: View, width: number, color: boolean): string {
  const bar = view.fraction === null ? renderSweep(view.tick, width) : renderBar(view.fraction, width);
  return colourBar(bar, view.fraction, color);
}

function bigFrame(view: View, big: string[], cols: number, rows: number, color: boolean): string[] {
  const lines: string[] = Array.from({ length: Math.floor((rows - BIG_HEIGHT) / 2) }, () => '');
  const indent = ' '.repeat(Math.floor((cols - big[0].length) / 2));
  big.forEach((row, r) => lines.push(indent + paint(row, GRADIENT[r], color)));
  lines.push('');
  const caption = view.caption.slice(0, cols - 1);
  lines.push(' '.repeat(Math.floor((cols - caption.length) / 2)) + dim(caption, color));
  lines.push('');
  lines.push('  ' + makeBar(view, cols - 4, color));
  const left = view.fraction === null ? '' : '  ' + percent(view.fraction);
  if (left.length + 1 + view.status.length <= cols - 2) {
    const gap = ' '.repeat(cols - 2 - left.length - view.status.length);
    lines.push(left + gap + dim(view.status, color));
  } else {
    lines.push(left);
  }
  return lines;
}

function compactFrame(view: View, cols: number, color: boolean): string[] {
  const pct = view.fraction === null ? '' : ' ' + percent(view.fraction).padStart(4);
  const barWidth = cols - 3 - view.clock.length - pct.length;
  if (barWidth >= 1) {
    return [' ' + view.clock + ' ' + makeBar(view, barWidth, color) + pct];
  }
  return [(' ' + view.clock).slice(0, Math.max(0, cols - 1))];
}

export function renderFrame(view: View, cols: number, rows: number, color: boolean): string[] {
  const big = bigText(view.clock);
  if (rows >= BIG_HEIGHT && cols >= big[0].length + 4) return bigFrame(view, big, cols, rows, color);
  return compactFrame(view, cols, color);
}

export function frameUpdate(prev: string[] | null, next: string[]): string {
  if (prev === null || prev.length !== next.length) {
    return '\x1b[H' + next.map((line) => line + '\x1b[K').join('\r\n') + '\x1b[J';
  }
  let out = '';
  next.forEach((line, i) => {
    if (line !== prev[i]) out += `\x1b[${i + 1};1H` + line + '\x1b[K';
  });
  return out;
}
